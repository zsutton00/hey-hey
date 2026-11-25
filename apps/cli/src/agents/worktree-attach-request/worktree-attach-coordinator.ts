import { randomUUID } from 'node:crypto';
import {
  AgentRequestWorktreeAttachPayloadResponseTypeEnum,
  AgentSessionServicePlaceKind,
  ExtendedUIFieldType,
  MessageStatus,
  MessageType,
  SystemMessageDataTypeEnum,
  type AgentRequestWorktreeAttachPayload,
  type AgentSessionServiceLocation,
  type AgentSessionWorktreeAttachRequest,
  type SystemMessageData,
} from '@hey-hey/contracts/api/models';
import { readWorktreeInventory, type WorktreeInventory } from '../../git/worktree';
import { toServiceId, type RepoMappingStore } from '../../repo/index';
import type { MessagePoster } from '../../run/message-poster';
import type { RunServiceScope } from '../../run/run-service-scope';
import { activeServicePlace } from '../../run/service-active-place';
import type { ServerLogger } from '../../server/logger';
import type { AgenticSession } from '../../session/types';
import { toOpenApiProjectId } from '../../shared/api/identifierAdapters';

export interface RequestWorktreeAttachArgs {
  serviceId: string;
  branch: string;
  reason: string;
}

export type WorktreeAttachRequestResult =
  | { status: 'requested'; request: AgentSessionWorktreeAttachRequest }
  | { status: 'already_requested'; request: AgentSessionWorktreeAttachRequest }
  | { status: 'already_attached'; branch: string; worktreePath: string }
  | { status: 'refused'; reason: string };

interface WorktreeAttachCoordinatorDependencies {
  repoStore: RepoMappingStore;
  poster: MessagePoster;
  logger: ServerLogger;
  serviceScope: RunServiceScope;
  runId: string;
  organizationId: string;
  projectId: string;
  conversationId: string;
  provider(): AgentSessionWorktreeAttachRequest['agentType'];
  session(): AgenticSession;
  /** The handler that owns a new request: the running turn's handler, or the persisted one. */
  currentAgentId(): string | null;
}

const refused = (reason: string): WorktreeAttachRequestResult => ({ status: 'refused', reason });

const worktreeAttachMessageData = (
  request: AgentSessionWorktreeAttachRequest,
): SystemMessageData => {
  const title = 'Worktree request';
  const payload = {
    responseType: AgentRequestWorktreeAttachPayloadResponseTypeEnum.AgentRequestWorktreeAttachV1,
    worktreeAttachRequest: request,
  } satisfies AgentRequestWorktreeAttachPayload;

  return {
    type: SystemMessageDataTypeEnum.Questions,
    title,
    response: `The agent wants to work in the worktree for branch ${request.branch} at ${request.worktreePath}. User review is required before repository changes continue.`,
    detectedIntent: 'agent_request_worktree_attach',
    intentConfidence: 1,
    ragEnabled: false,
    uiElements: [
      {
        id: `agent-request-worktree-attach:${request.id}`,
        type: ExtendedUIFieldType.AgentRequestWorktreeAttach,
        label: title,
        payload,
      },
    ],
    triggerNotification: true,
  };
};

/**
 * Turns an agent's wish to work in another worktree of an in-scope Service into
 * a reviewable request and pauses the Run on it. It changes nothing about where
 * the Run may edit: only an approval does that.
 */
export class WorktreeAttachCoordinator {
  /** Requests are admitted one at a time, so a repeat sent before the first is recorded posts nothing. */
  private admissions: Promise<unknown> = Promise.resolve();

  public constructor(private readonly dependencies: WorktreeAttachCoordinatorDependencies) {}

  public request(args: RequestWorktreeAttachArgs): Promise<WorktreeAttachRequestResult> {
    const result = this.admissions.then(() => this.admit(args));
    this.admissions = result.catch(() => undefined);
    return result;
  }

  private async admit(args: RequestWorktreeAttachArgs): Promise<WorktreeAttachRequestResult> {
    const { logger, runId, serviceScope } = this.dependencies;
    const session = this.dependencies.session();
    const agentId = this.dependencies.currentAgentId();
    if (!agentId) {
      throw new Error('Cannot request a worktree attach without an active agent handler.');
    }
    const { serviceId, branch, reason } = args;
    const logFields = { runId, serviceId, branch };

    if (!session.services.some((service) => service.id === serviceId)) {
      logger.info('local.worktree_attach.request.refused_not_in_session', logFields);
      return refused(
        `Service ${serviceId} is not in this session. Attaching a worktree never adds a repository; request the Service with request_agent_session_service_scope.`,
      );
    }

    const attached = session.worktreeState?.[serviceId];
    if (attached?.branch === branch) {
      logger.debug('local.worktree_attach.request.already_attached', logFields);
      return { status: 'already_attached', branch, worktreePath: attached.worktreePath };
    }

    const pending = serviceScope.findPendingWorktreeAttachRequest(serviceId, branch, reason);
    if (pending) {
      logger.debug('local.worktree_attach.request.already_pending', {
        ...logFields,
        requestId: pending.id,
      });
      return { status: 'already_requested', request: pending };
    }

    let inventory: WorktreeInventory;
    try {
      const repositoryPath = await this.dependencies.repoStore.resolvePathForService(
        toServiceId(serviceId),
      );
      inventory = await readWorktreeInventory(repositoryPath);
    } catch (error) {
      logger.warn('local.worktree_attach.request.inventory_read_failed', { ...logFields, error });
      return refused(
        `The worktrees of this Service could not be listed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const target = inventory.linkedWorktrees.find((worktree) => worktree.branch === branch);
    if (!target) {
      const inMainFolder = inventory.mainFolder.branch === branch;
      logger.info('local.worktree_attach.request.no_registered_worktree', {
        ...logFields,
        inMainFolder,
      });
      return refused(
        `No registered worktree for branch ${branch} in this Service's repository.${
          inMainFolder
            ? ' That branch is checked out in the main folder, and attaching never moves to the main folder.'
            : ' Attaching never creates a worktree.'
        }`,
      );
    }

    // Only one request can own the Run's pause, so a second card could never be waited on.
    if (
      serviceScope.hasPendingServiceScopeRequest() ||
      serviceScope.hasPendingWorktreeAttachRequest()
    ) {
      logger.info('local.worktree_attach.request.refused_other_review_pending', logFields);
      return refused(
        'Another request in this session is already awaiting user review. Pause until the user decides.',
      );
    }

    const place = activeServicePlace(session, serviceId);
    const currentPlace: AgentSessionServiceLocation =
      place.kind === AgentSessionServicePlaceKind.Worktree
        ? place
        : {
            kind: place.kind,
            branch: place.branch === undefined ? inventory.mainFolder.branch : place.branch,
          };
    const request = {
      id: randomUUID(),
      runId,
      sessionId: session.agentic_session_id,
      agentId,
      agentType: this.dependencies.provider(),
      timestamp: new Date().toISOString(),
      idempotencyToken: randomUUID(),
      serviceId,
      currentPlace,
      branch,
      worktreePath: target.worktreePath,
      reason,
      planBranch: session.contextMetadata.launchPlanId ? (session.worktree?.branch ?? null) : null,
    } satisfies AgentSessionWorktreeAttachRequest;
    const requestFields = { ...logFields, requestId: request.id };
    logger.debug('local.worktree_attach.request.created', {
      ...requestFields,
      worktreePath: request.worktreePath,
      currentPlace,
      planBranch: request.planBranch,
    });

    const data = worktreeAttachMessageData(request);
    const messageId = await this.dependencies.poster.createOutOfBand({
      organizationId: this.dependencies.organizationId,
      projectId: this.dependencies.projectId,
      conversationId: this.dependencies.conversationId,
      dto: {
        type: MessageType.System,
        status: MessageStatus.Open,
        projectId: toOpenApiProjectId(this.dependencies.projectId),
        data,
      },
      stamp: null,
    });
    logger.info('local.worktree_attach.request.posted', { ...requestFields, messageId });
    serviceScope.recordWorktreeAttachRequest(request, messageId, data);
    await serviceScope.pauseForWorktreeAttachRequest(request.id);
    return { status: 'requested', request };
  }
}
