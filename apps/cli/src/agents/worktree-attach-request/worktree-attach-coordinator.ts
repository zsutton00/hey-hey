import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import {
  AgentRequestWorktreeAttachPayloadDecisionEnum,
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
import {
  getBranchWorktreeState,
  readWorktreeInventory,
  type WorktreeInventory,
} from '../../git/worktree';
import { isNodeError } from '../../credentials/file-crypto';
import { toServiceId, type RepoMappingStore } from '../../repo/index';
import type { RunStore } from '../../run-store/run-store';
import type { MessagePoster } from '../../run/message-poster';
import type { RunServiceScope, WorktreeAttachRequestEntry } from '../../run/run-service-scope';
import { activeServicePlace } from '../../run/service-active-place';
import type { ApprovedPlaceChange, PlaceChangeResult } from '../../run/service-place-reporter';
import type { ServerLogger } from '../../server/logger';
import type { AgenticSession } from '../../session/types';
import type { LocalWorktreeState } from '../../shared/agent-bridge-contract/contract';
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

export interface WorktreeAttachDecisionInput {
  requestId: string;
  sessionId: string;
  agentType: AgentSessionWorktreeAttachRequest['agentType'];
  decision: 'approve' | 'deny';
  reason: string | null;
  idempotencyToken: string;
}

export type WorktreeAttachDecisionResult =
  | { outcome: 'delivered'; callbackType: 'worktree_attach_decision' }
  | { outcome: 'dropped'; reason: string }
  | { outcome: 'failed'; reason: string };

interface WorktreeAttachCoordinatorDependencies {
  runStore: RunStore;
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
  /** Records the approved place on the platform through the place-change operation. */
  changePlace(change: ApprovedPlaceChange): Promise<PlaceChangeResult>;
  /** Moves the Run's editable folder for the Service into the recorded worktree. */
  applyApprovedWorktreeAttach(input: {
    serviceId: string;
    worktree: LocalWorktreeState;
  }): Promise<void>;
  hasProviderSession(): boolean;
  /** Ends the provider session so the next Turn starts a replacement from the saved checkpoint. */
  startFreshProviderSession(): Promise<void>;
}

const delivered: WorktreeAttachDecisionResult = {
  outcome: 'delivered',
  callbackType: 'worktree_attach_decision',
};

const refused = (reason: string): WorktreeAttachRequestResult => ({ status: 'refused', reason });

/** What a request's card shows once it is decided. */
interface CardOutcome {
  decision: 'approve' | 'deny';
  decidedAt: string;
  failureReason?: string;
}

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
  /** Answers to one request are handled one at a time. */
  private readonly decisionQueues = new Map<string, Promise<unknown>>();
  /** How each request was settled, so a later opposite answer is never reported as delivered. */
  private readonly settledDecisions = new Map<string, 'approve' | 'deny'>();
  /**
   * Requests whose move the platform already recorded, so a retry after a local failure finishes
   * the move instead of asking again. `previousFolder` is read before anything changes, because a
   * failed local step may already have pointed the Run at the new worktree.
   */
  private readonly platformMoves = new Map<string, { decidedAt: string; previousFolder: string }>();
  /** Settled requests whose card could not be updated; a repeat of the same answer retries it. */
  private readonly unrecordedCards = new Map<
    string,
    { pending: WorktreeAttachRequestEntry; outcome: CardOutcome }
  >();

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

  /** The person's answer from the Worktree request card. */
  public decide(input: WorktreeAttachDecisionInput): Promise<WorktreeAttachDecisionResult> {
    const previous = this.decisionQueues.get(input.requestId) ?? Promise.resolve();
    const next = previous.then(
      () => this.decideNow(input),
      () => this.decideNow(input),
    );
    const tail = next.catch(() => undefined);
    this.decisionQueues.set(input.requestId, tail);
    void tail.then(() => {
      if (this.decisionQueues.get(input.requestId) === tail) {
        this.decisionQueues.delete(input.requestId);
      }
    });
    return next;
  }

  private async decideNow(
    input: WorktreeAttachDecisionInput,
  ): Promise<WorktreeAttachDecisionResult> {
    const { logger, runId, serviceScope } = this.dependencies;
    const pending = serviceScope.getWorktreeAttachRequest(input.requestId);
    const logFields = { runId, requestId: input.requestId, decision: input.decision };
    if (!pending) {
      return this.settledResult(input);
    }

    const { request } = pending;
    if (
      request.sessionId !== input.sessionId ||
      request.agentType !== input.agentType ||
      request.idempotencyToken !== input.idempotencyToken
    ) {
      logger.warn('local.worktree_attach.decision.context_mismatch', logFields);
      return { outcome: 'dropped', reason: 'worktree_attach_decision_context_mismatch' };
    }
    if (await this.dependencies.runStore.hasIdempotencyToken(runId, input.idempotencyToken)) {
      return delivered;
    }

    if (input.decision === 'deny') {
      return this.deny(pending, input.reason);
    }
    return this.approve(pending);
  }

  private async settledResult(
    input: WorktreeAttachDecisionInput,
  ): Promise<WorktreeAttachDecisionResult> {
    const settled = this.settledDecisions.get(input.requestId);
    if (settled === undefined) {
      return this.dependencies.serviceScope.isWorktreeAttachRequestSettled(input.requestId)
        ? delivered
        : { outcome: 'dropped', reason: 'worktree_attach_request_not_found' };
    }
    if (settled === input.decision) {
      return this.repairCard(input.requestId);
    }

    this.dependencies.logger.warn('local.worktree_attach.decision.already_decided', {
      runId: this.dependencies.runId,
      requestId: input.requestId,
      answered: input.decision,
      settled,
    });
    return { outcome: 'dropped', reason: 'worktree_attach_request_already_decided' };
  }

  /** Retries a card update that failed when its request settled; otherwise nothing is left to do. */
  private async repairCard(requestId: string): Promise<WorktreeAttachDecisionResult> {
    const unrecorded = this.unrecordedCards.get(requestId);
    if (!unrecorded) {
      return delivered;
    }

    const { logger, runId } = this.dependencies;
    try {
      await this.recordDecision(unrecorded.pending, unrecorded.outcome);
    } catch (error) {
      logger.error('local.worktree_attach.decision.card_repair_failed', {
        runId,
        requestId,
        error,
      });
      return { outcome: 'failed', reason: cardFailureReason(error) };
    }
    this.unrecordedCards.delete(requestId);
    logger.info('local.worktree_attach.decision.card_repaired', { runId, requestId });
    return delivered;
  }

  private async deny(
    pending: WorktreeAttachRequestEntry,
    reason: string | null,
  ): Promise<WorktreeAttachDecisionResult> {
    const { logger, runId } = this.dependencies;
    const { request } = pending;
    if (this.platformMoves.has(request.id)) {
      // The platform already records the new place and cannot be asked to undo it here.
      const refusal =
        'The new place is already recorded on the platform and cannot be denied; approve to finish moving to it.';
      logger.warn('local.worktree_attach.denial.refused_after_platform_change', {
        runId,
        requestId: request.id,
      });
      return { outcome: 'failed', reason: refusal };
    }

    const reasonText = reason?.trim() ? ` Their reason: ${reason.trim()}` : '';
    const cardFailure = await this.finish(pending, {
      decision: 'deny',
      decidedAt: new Date().toISOString(),
      agentNotice: `The user denied attaching the worktree for branch ${request.branch} at ${request.worktreePath}.${reasonText} ${this.unchangedPlaceSentence(request)}`,
    });
    logger.info('local.worktree_attach.request.denied', { runId, requestId: request.id });
    return cardFailure ? { outcome: 'failed', reason: cardFailure } : delivered;
  }

  private async approve(
    pending: WorktreeAttachRequestEntry,
  ): Promise<WorktreeAttachDecisionResult> {
    const { logger, runId, serviceScope } = this.dependencies;
    const { request } = pending;
    const logFields = { runId, requestId: request.id, serviceId: request.serviceId };

    if (!serviceScope.hasServiceScopeContinuation()) {
      logger.warn('local.worktree_attach.approval.continuation_missing', logFields);
      return this.fail(pending, 'The paused work this request belongs to is no longer available.');
    }

    if (!this.platformMoves.has(request.id)) {
      const previousFolder = this.currentFolder(this.dependencies.session(), request.serviceId);
      const problem = await this.findWorktreeProblem(request);
      if (problem) {
        logger.info('local.worktree_attach.approval.worktree_rejected', { ...logFields, problem });
        return this.fail(pending, problem);
      }

      // The platform accepts the change only against a card that already shows this approval.
      const decidedAt = new Date().toISOString();
      try {
        await this.recordDecision(pending, { decision: 'approve', decidedAt });
      } catch (error) {
        logger.error('local.worktree_attach.approval.decision_record_failed', {
          ...logFields,
          error,
        });
        return this.fail(pending, `The approval could not be recorded: ${messageOf(error)}`);
      }

      let change: PlaceChangeResult;
      try {
        change = await this.dependencies.changePlace({
          requestId: request.id,
          serviceId: request.serviceId,
          branch: request.branch,
          worktreePath: request.worktreePath,
        });
      } catch (error) {
        logger.warn('local.worktree_attach.approval.place_change_failed', { ...logFields, error });
        return this.fail(pending, messageOf(error), decidedAt);
      }
      if (change.status === 'not_moved') {
        const where = change.recordedPlace
          ? describeRecordedPlace(change.recordedPlace)
          : 'a place the platform did not report';
        return this.fail(
          pending,
          `The platform did not move this Service to the worktree: it records the Service in ${where}, because this request was already delivered or a later attach was applied.`,
          decidedAt,
        );
      }
      this.platformMoves.set(request.id, { decidedAt, previousFolder });
    }

    const { decidedAt, previousFolder } = this.platformMoves.get(request.id)!;
    const changesWorkingFolder =
      this.dependencies.session().launchServiceId === request.serviceId &&
      path.resolve(previousFolder) !== path.resolve(request.worktreePath);
    try {
      const repoPath = await this.dependencies.repoStore.resolvePathForService(
        toServiceId(request.serviceId),
      );
      await this.dependencies.applyApprovedWorktreeAttach({
        serviceId: request.serviceId,
        worktree: { worktreePath: request.worktreePath, branch: request.branch, repoPath },
      });
      // No provider is known to resume its conversation from a different working folder, so a
      // replacement session continues from the saved checkpoint and the visible conversation.
      if (changesWorkingFolder && this.dependencies.hasProviderSession()) {
        logger.info('local.worktree_attach.approval.provider_session_replaced', {
          ...logFields,
          previousFolder,
          worktreePath: request.worktreePath,
        });
        await this.dependencies.startFreshProviderSession();
      }
    } catch (error) {
      // The platform already records the move; the request stays pending so a retry finishes it.
      logger.error('local.worktree_attach.approval.local_apply_failed_after_platform_change', {
        ...logFields,
        error,
      });
      return { outcome: 'failed', reason: messageOf(error) };
    }

    const notice = `The worktree attach was approved. Service ${request.serviceId} now works in the worktree ${request.worktreePath} on branch ${request.branch}; make its changes there. It previously worked in ${previousFolder}. Nothing was moved or copied between the two folders: uncommitted changes in ${previousFolder} stay there and are not in the new worktree.`;
    await this.finish(pending, {
      decision: 'approve',
      decidedAt,
      continuation: notice,
      cardRecorded: true,
    });
    logger.info('local.worktree_attach.request.approved', {
      ...logFields,
      previousFolder,
      worktreePath: request.worktreePath,
      branch: request.branch,
      providerSessionReplaced: changesWorkingFolder,
    });
    return delivered;
  }

  /**
   * Re-reads the Service's registered worktrees: the worktree must still be registered for its
   * repository with the requested branch, that branch must not be the main folder's, and the
   * folder must exist. Returns the reason it cannot be attached, or null.
   */
  private async findWorktreeProblem(
    request: AgentSessionWorktreeAttachRequest,
  ): Promise<string | null> {
    const { branch, worktreePath } = request;
    let repositoryPath: string;
    let inventory: WorktreeInventory;
    try {
      repositoryPath = await this.dependencies.repoStore.resolvePathForService(
        toServiceId(request.serviceId),
      );
      inventory = await readWorktreeInventory(repositoryPath);
    } catch (error) {
      this.dependencies.logger.warn('local.worktree_attach.approval.inventory_read_failed', {
        runId: this.dependencies.runId,
        requestId: request.id,
        error,
      });
      return `The worktrees of this Service could not be listed: ${messageOf(error)}`;
    }

    if (inventory.mainFolder.branch === branch) {
      return `Branch ${branch} is checked out in the main folder of this Service, and attaching never moves to the main folder.`;
    }
    const registered = inventory.linkedWorktrees.find(
      (worktree) => path.resolve(worktree.worktreePath) === path.resolve(worktreePath),
    );
    if (!registered) {
      return `${worktreePath} is no longer a worktree of this Service's repository.`;
    }
    if (registered.branch !== branch) {
      return `${worktreePath} now has ${registered.branch ? `branch ${registered.branch}` : 'a detached checkout'}, not branch ${branch}.`;
    }
    const folderProblem = await findFolderProblem(worktreePath);
    if (folderProblem) {
      return folderProblem;
    }
    const branchState = await getBranchWorktreeState(repositoryPath, branch);
    if (!branchState.branchExists) {
      return `Branch ${branch} no longer exists in this Service's repository.`;
    }
    return null;
  }

  /** A failed approval: nothing changes, the card says why, and the agent is told. */
  private async fail(
    pending: WorktreeAttachRequestEntry,
    failureReason: string,
    decidedAt = new Date().toISOString(),
  ): Promise<WorktreeAttachDecisionResult> {
    const { request } = pending;
    const cardFailure = await this.finish(pending, {
      decision: 'approve',
      decidedAt,
      failureReason,
      agentNotice: `Attaching the worktree for branch ${request.branch} at ${request.worktreePath} failed: ${failureReason} ${this.unchangedPlaceSentence(request)}`,
    });
    this.dependencies.logger.info('local.worktree_attach.approval.failed_settled', {
      runId: this.dependencies.runId,
      requestId: request.id,
      failureReason,
    });
    return {
      outcome: 'failed',
      reason: cardFailure ? `${failureReason} ${cardFailure}` : failureReason,
    };
  }

  /**
   * Settles the request. An approval resumes the paused work with `continuation` told to the
   * agent; a denial or failure abandons it and leaves `agentNotice` for the agent's next Turn.
   * The request settles even when its card cannot be updated, so the agent is never held on a
   * card write; the card is kept for repair and the reason is returned for the person's answer.
   */
  private async finish(
    pending: WorktreeAttachRequestEntry,
    outcome: CardOutcome & {
      cardRecorded?: boolean;
      continuation?: string;
      agentNotice?: string;
    },
  ): Promise<string | null> {
    const { logger, runId, serviceScope } = this.dependencies;
    const { request } = pending;
    let cardFailure: string | null = null;
    if (!outcome.cardRecorded) {
      try {
        await this.recordDecision(pending, outcome);
      } catch (error) {
        logger.error('local.worktree_attach.decision.card_update_failed', {
          runId,
          requestId: request.id,
          decision: outcome.decision,
          error,
        });
        cardFailure = cardFailureReason(error);
        this.unrecordedCards.set(request.id, {
          pending,
          outcome: {
            decision: outcome.decision,
            decidedAt: outcome.decidedAt,
            ...(outcome.failureReason ? { failureReason: outcome.failureReason } : {}),
          },
        });
      }
    }

    serviceScope.settleWorktreeAttachRequest(request.id);
    this.settledDecisions.set(request.id, outcome.decision);
    this.platformMoves.delete(request.id);
    const resumes = outcome.continuation !== undefined;
    try {
      await this.dependencies.runStore.persistIdempotencyToken(runId, request.idempotencyToken);
    } finally {
      serviceScope.settleServiceScopeApprovalWait(request.id, resumes ? 'starting' : 'idle');
      if (resumes) {
        await serviceScope.resumeAfterServiceScopeApproval(outcome.continuation);
      } else {
        await serviceScope.clearServiceScopeContinuation();
        if (outcome.agentNotice) {
          serviceScope.queueAgentNotice(outcome.agentNotice);
        }
      }
    }
    return cardFailure;
  }

  /** Writes the decision onto the request's card and waits until the platform stored it. */
  private async recordDecision(
    pending: WorktreeAttachRequestEntry,
    outcome: CardOutcome,
  ): Promise<void> {
    const { request, messageId } = pending;
    const data = pending.data ?? worktreeAttachMessageData(request);
    const uiElements = data.uiElements?.map((element) => {
      if (element.type !== ExtendedUIFieldType.AgentRequestWorktreeAttach) {
        return element;
      }
      const payload = {
        responseType:
          AgentRequestWorktreeAttachPayloadResponseTypeEnum.AgentRequestWorktreeAttachV1,
        worktreeAttachRequest: request,
        decision:
          outcome.decision === 'approve'
            ? AgentRequestWorktreeAttachPayloadDecisionEnum.Approve
            : AgentRequestWorktreeAttachPayloadDecisionEnum.Deny,
        decidedAt: outcome.decidedAt,
        ...(outcome.failureReason ? { failureReason: outcome.failureReason } : {}),
      } satisfies AgentRequestWorktreeAttachPayload;
      return { ...element, payload };
    });

    await this.dependencies.poster.completeConfirmed(
      this.dependencies.organizationId,
      this.dependencies.projectId,
      messageId,
      { status: MessageStatus.Completed, data: { ...data, ...(uiElements ? { uiElements } : {}) } },
    );
  }

  /** The folder the Service's edits go to now. */
  private currentFolder(session: AgenticSession, serviceId: string): string {
    const place = activeServicePlace(session, serviceId);
    if (place.kind === AgentSessionServicePlaceKind.Worktree) {
      return place.worktreePath;
    }
    return session.services.find((service) => service.id === serviceId)?.path ?? serviceId;
  }

  private unchangedPlaceSentence(request: AgentSessionWorktreeAttachRequest): string {
    const folder = this.currentFolder(this.dependencies.session(), request.serviceId);
    return `Nothing changed: Service ${request.serviceId} still works in ${folder}.`;
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const cardFailureReason = (error: unknown): string =>
  `The decision took effect, but the request card could not be updated: ${messageOf(error)} Answer again to update it.`;

const describeRecordedPlace = (place: {
  kind: string;
  branch: string | null;
  worktreePath?: string | undefined;
}): string =>
  place.kind === AgentSessionServicePlaceKind.Worktree && place.worktreePath
    ? `the worktree ${place.worktreePath} on branch ${place.branch ?? 'unknown'}`
    : `its main folder${place.branch ? ` on branch ${place.branch}` : ''}`;

/** Why the folder cannot be worked in, or null when it is a readable directory. */
const findFolderProblem = async (folder: string): Promise<string | null> => {
  try {
    return (await stat(folder)).isDirectory() ? null : `${folder} is not a folder.`;
  } catch (error) {
    return isNodeError(error) && error.code === 'ENOENT'
      ? `${folder} no longer exists.`
      : `${folder} could not be read: ${messageOf(error)}`;
  }
};
