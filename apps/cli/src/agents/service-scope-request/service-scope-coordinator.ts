import { randomUUID } from 'node:crypto';
import {
  AgentRequestServiceScopePayloadDecisionEnum,
  AgentRequestServiceScopePayloadResponseTypeEnum,
  ExtendedUIFieldType,
  MessageStatus,
  MessageType,
  SystemMessageDataTypeEnum,
  type AgentRequestServiceScopePayload,
  type AgentSessionServiceScopeRequest,
  type SystemMessageData,
  type GrantAgentSessionServicesDto,
} from '../../shared/api/generated/api';
import type { KeyPairStore } from '../../credentials/keypair';
import type { RepoMappingStore } from '../../repo/index';
import type { RunStore } from '../../run-store/run-store';
import type { MessagePoster } from '../../run/message-poster';
import type { ServerLogger } from '../../server/logger';
import type { SubmissionToolAuth } from '../submission-tools/submission-tool-auth';
import {
  resolveRunWorkspace,
  resolveServiceBindingsForIds,
  type ResolvedRunWorkspace,
} from '../run-scope';
import type { AgenticSession } from '../../session/types';
import type { ResolvedServiceBinding } from '../../shared/agent-bridge-contract/contract';
import type { RunServiceScope, ServiceScopeRequestEntry } from '../../run/run-service-scope';
import type {
  RequestAgentSessionServiceScopeArgs,
  ServiceScopeDecisionInput,
  ServiceScopeRequestResult,
} from './service-scope-types';
import { ProjectServiceNameResolver } from './project-service-name-resolver';
export type ServiceScopeDecisionResult =
  | { outcome: 'delivered'; callbackType: 'service_scope_decision' }
  | { outcome: 'dropped'; reason: string }
  | { outcome: 'failed'; reason: string };
interface ServiceScopeCoordinatorDependencies {
  runStore: RunStore;
  repoStore: RepoMappingStore;
  poster: MessagePoster;
  auth: SubmissionToolAuth;
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  keyPairStore: KeyPairStore;
  logger: ServerLogger;
  serviceScope: RunServiceScope;
  runId: string;
  organizationId: string;
  projectId: string;
  conversationId: string;
  provider: AgentSessionServiceScopeRequest['agentType'];
  session(): AgenticSession;
  taskMonitorId(): string | null;
  /** The handler that owns a new request: the running turn's handler, or the persisted one. */
  currentAgentId(): string | null;
  canAutoResolveTaskMonitorScopeRequest(): boolean;
  applyApprovedServiceScope(input: {
    services: ResolvedServiceBinding[];
    launchServiceId: string;
    workspace: ResolvedRunWorkspace;
  }): Promise<void>;
}
const uniqueInOrder = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};
const serviceScopePayload = (request: AgentSessionServiceScopeRequest) => ({
  responseType: AgentRequestServiceScopePayloadResponseTypeEnum.AgentRequestServiceScopeV1,
  serviceScopeRequest: request,
});
const serviceScopeElement = (
  request: AgentSessionServiceScopeRequest,
): NonNullable<SystemMessageData['uiElements']>[number] => ({
  id: `agent-request-service-scope:${request.id}`,
  type: ExtendedUIFieldType.AgentRequestServiceScope,
  label: 'Additional Service access',
  payload: serviceScopePayload(request),
});
const responseText = (additionalServiceNames: readonly string[]): string =>
  `The coding session needs access to additional project Services: ${additionalServiceNames.join(', ')}. User review is required before repository changes continue.`;
const serviceScopeMessageData = (
  request: AgentSessionServiceScopeRequest,
  additionalServiceNames: readonly string[],
): SystemMessageData => ({
  type: SystemMessageDataTypeEnum.Questions,
  title: 'Additional Service access',
  response: responseText(additionalServiceNames),
  detectedIntent: 'agent_request_service_scope',
  intentConfidence: 1,
  ragEnabled: false,
  uiElements: [serviceScopeElement(request)],
  triggerNotification: true,
});
export class AgentSessionServiceScopeCoordinator {
  private readonly serviceNameResolver: ProjectServiceNameResolver;

  public constructor(private readonly dependencies: ServiceScopeCoordinatorDependencies) {
    this.serviceNameResolver = new ProjectServiceNameResolver(dependencies);
  }
  public async request(
    args: RequestAgentSessionServiceScopeArgs,
  ): Promise<ServiceScopeRequestResult> {
    const deps = this.dependencies;
    const scope = deps.serviceScope;
    const agentId = deps.currentAgentId();
    if (!agentId) throw new Error('Cannot request Service scope without an active coding handler.');
    const currentServiceIds = deps.session().services.map((service) => service.id);
    const requestedServiceIds = uniqueInOrder([...currentServiceIds, ...args.serviceIds]);
    if (requestedServiceIds.every((serviceId) => currentServiceIds.includes(serviceId))) {
      this.dependencies.logger.debug('local.service_scope.request.already_in_scope', {
        runId: deps.runId,
        serviceIds: currentServiceIds,
      });
      return { status: 'already_in_scope', serviceIds: currentServiceIds };
    }
    const existing = scope.findPendingServiceScopeRequest(
      currentServiceIds,
      requestedServiceIds,
      args.reason,
    );
    if (existing) {
      this.dependencies.logger.debug('local.service_scope.request.already_pending', {
        runId: deps.runId,
        requestId: existing.id,
      });
      return { status: 'already_requested', request: existing };
    }
    const request: AgentSessionServiceScopeRequest = {
      id: randomUUID(),
      runId: deps.runId,
      sessionId: deps.session().agentic_session_id,
      agentId,
      agentType: deps.provider,
      timestamp: new Date().toISOString(),
      idempotencyToken: randomUUID(),
      currentServiceIds,
      requestedServiceIds,
      reason: args.reason,
    };
    const additionalServiceIds = requestedServiceIds.filter(
      (serviceId) => !currentServiceIds.includes(serviceId),
    );
    const additionalServiceNames = await this.serviceNameResolver.resolve({
      runId: deps.runId,
      organizationId: deps.organizationId,
      projectId: deps.projectId,
      serviceIds: additionalServiceIds,
    });
    const data = serviceScopeMessageData(request, additionalServiceNames);
    const messageId = await this.dependencies.poster.createOutOfBand({
      organizationId: deps.organizationId,
      projectId: deps.projectId,
      conversationId: deps.conversationId,
      dto: {
        type: MessageType.System,
        status: MessageStatus.Open,
        projectId: deps.projectId,
        data,
      },
      stamp: null,
    });
    scope.recordServiceScopeRequest(request, messageId, data);
    const autoResolve = deps.canAutoResolveTaskMonitorScopeRequest();
    await scope.pauseForServiceScopeRequest(request.id, autoResolve ? 'automatic' : 'human');
    this.dependencies.logger.info('local.service_scope.request.created', {
      runId: deps.runId,
      requestId: request.id,
      currentServiceIds,
      requestedServiceIds,
      autoResolve,
    });
    if (autoResolve) {
      this.dependencies.logger.info('local.service_scope.request.auto_approval_started', {
        runId: deps.runId,
        requestId: request.id,
        taskMonitorId: deps.taskMonitorId(),
      });
      const result = await this.decide({
        requestId: request.id,
        sessionId: request.sessionId,
        agentType: request.agentType,
        decision: 'approve',
        reason: 'Approved by the Task Monitor session authorization.',
        idempotencyToken: request.idempotencyToken,
      });
      if (result.outcome !== 'delivered') {
        this.dependencies.logger.warn('local.service_scope.request.auto_approval_failed', {
          runId: deps.runId,
          requestId: request.id,
          outcome: result.outcome,
          reason: result.reason,
        });
      }
    }
    return { status: 'requested', request };
  }
  public async decide(input: ServiceScopeDecisionInput): Promise<ServiceScopeDecisionResult> {
    const deps = this.dependencies;
    const scope = deps.serviceScope;
    const pending = scope.getServiceScopeRequest(input.requestId);
    if (!pending)
      return scope.isServiceScopeRequestSettled(input.requestId)
        ? { outcome: 'delivered', callbackType: 'service_scope_decision' }
        : { outcome: 'dropped', reason: 'service_scope_request_not_found' };
    if (
      pending.request.sessionId !== input.sessionId ||
      pending.request.agentType !== input.agentType ||
      pending.request.idempotencyToken !== input.idempotencyToken
    )
      return { outcome: 'dropped', reason: 'service_scope_decision_context_mismatch' };
    if (await this.dependencies.runStore.hasIdempotencyToken(deps.runId, input.idempotencyToken))
      return { outcome: 'delivered', callbackType: 'service_scope_decision' };
    if (input.decision === 'deny') {
      await this.settle(pending.request, pending.messageId, pending.data, input.decision);
      try {
        await this.dependencies.runStore.persistIdempotencyToken(
          deps.runId,
          input.idempotencyToken,
        );
      } finally {
        scope.settleServiceScopeApprovalWait(pending.request.id, 'idle');
        await scope.clearServiceScopeContinuation();
      }
      this.dependencies.logger.info('local.service_scope.request.denied', {
        runId: deps.runId,
        requestId: input.requestId,
      });
      return { outcome: 'delivered', callbackType: 'service_scope_decision' };
    }
    const priorServiceIds = deps.session().services.map((service) => service.id);
    const serviceIds = uniqueInOrder([...priorServiceIds, ...pending.request.requestedServiceIds]);
    const launchServiceId = deps.session().launchServiceId;
    if (!launchServiceId || !serviceIds.includes(launchServiceId)) {
      this.dependencies.logger.warn('local.service_scope.approval.launch_service_missing', {
        runId: deps.runId,
        requestId: input.requestId,
        launchServiceId,
      });
      await this.settleFailedApproval(pending, input);
      return {
        outcome: 'failed',
        reason: 'Approved Service scope does not contain launch Service.',
      };
    }
    if (!scope.hasServiceScopeContinuation()) {
      const reason = 'Approved Service scope continuation is unavailable.';
      this.dependencies.logger.warn('local.service_scope.approval.continuation_missing', {
        runId: deps.runId,
        requestId: input.requestId,
      });
      await this.settleFailedApproval(pending, input);
      return { outcome: 'failed', reason };
    }
    const bindings = await resolveServiceBindingsForIds({
      serviceIds,
      repoStore: this.dependencies.repoStore,
      logger: this.dependencies.logger,
    });
    if (!bindings.ok) {
      this.dependencies.logger.warn('local.service_scope.approval.service_resolution_failed', {
        runId: deps.runId,
        requestId: input.requestId,
        reason: bindings.message,
      });
      await this.settleFailedApproval(pending, input);
      return { outcome: 'failed', reason: bindings.message };
    }
    const workspace = await resolveRunWorkspace({
      session: { ...deps.session(), services: bindings.services, launchServiceId },
      repoStore: this.dependencies.repoStore,
      logger: this.dependencies.logger,
    });
    if (!workspace.ok) {
      this.dependencies.logger.warn('local.service_scope.approval.workspace_resolution_failed', {
        runId: deps.runId,
        requestId: input.requestId,
        reason: workspace.message,
      });
      await this.settleFailedApproval(pending, input);
      return { outcome: 'failed', reason: workspace.message };
    }
    let machineId: string | null;
    try {
      machineId = await this.dependencies.keyPairStore.loadCurrentMachineId();
    } catch (error) {
      this.dependencies.logger.error('local.service_scope.approval.machine_binding_read_failed', {
        runId: deps.runId,
        requestId: input.requestId,
        error,
      });
      await this.settleFailedApproval(pending, input);
      return { outcome: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
    if (!machineId) {
      const reason = 'Approved Service scope requires a verified machine binding.';
      this.dependencies.logger.warn('local.service_scope.approval.machine_binding_missing', {
        runId: deps.runId,
        requestId: input.requestId,
      });
      await this.settleFailedApproval(pending, input);
      return { outcome: 'failed', reason };
    }
    const existingServiceIds = new Set(deps.session().services.map((service) => service.id));
    const additionalServiceIds = serviceIds.filter(
      (serviceId) => !existingServiceIds.has(serviceId),
    );
    let platformGrantPersisted = additionalServiceIds.length === 0;
    try {
      if (additionalServiceIds.length > 0) {
        await this.updatePlatformSession(machineId, additionalServiceIds, launchServiceId);
        platformGrantPersisted = true;
      }
      await deps.applyApprovedServiceScope({
        services: bindings.services,
        launchServiceId,
        workspace,
      });
    } catch (error) {
      if (!platformGrantPersisted) {
        await this.settleFailedApproval(pending, input);
      } else {
        this.dependencies.logger.error(
          'local.service_scope.local_apply_failed_after_platform_grant',
          {
            runId: deps.runId,
            requestId: input.requestId,
            additionalServiceIds,
            error,
          },
        );
      }
      return { outcome: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
    await this.settle(pending.request, pending.messageId, pending.data, input.decision);
    try {
      await this.dependencies.runStore.persistIdempotencyToken(
        deps.runId,
        pending.request.idempotencyToken,
      );
    } finally {
      scope.settleServiceScopeApprovalWait(pending.request.id, 'starting');
      await scope.resumeAfterServiceScopeApproval();
    }
    this.dependencies.logger.info('local.service_scope.request.approved', {
      runId: deps.runId,
      requestId: input.requestId,
      serviceIds,
      launchServiceId,
    });
    return { outcome: 'delivered', callbackType: 'service_scope_decision' };
  }
  private async settleFailedApproval(
    pending: ServiceScopeRequestEntry,
    input: ServiceScopeDecisionInput,
  ): Promise<void> {
    const deps = this.dependencies;
    const scope = deps.serviceScope;
    await scope.clearServiceScopeContinuation();
    await this.settle(pending.request, pending.messageId, pending.data, input.decision);
    try {
      await this.dependencies.runStore.persistIdempotencyToken(
        deps.runId,
        pending.request.idempotencyToken,
      );
    } finally {
      scope.settleServiceScopeApprovalWait(pending.request.id, 'idle');
    }
    this.dependencies.logger.info('local.service_scope.approval.failed_settled', {
      runId: deps.runId,
      requestId: pending.request.id,
    });
  }
  private async updatePlatformSession(
    machineId: string,
    serviceIds: readonly string[],
    launchServiceId: string,
  ): Promise<void> {
    const deps = this.dependencies;
    const accessToken = await this.dependencies.auth.getAccessToken();
    const url = `${this.dependencies.apiBaseUrl.replace(/\/$/u, '')}/organizations/${encodeURIComponent(deps.organizationId)}/projects/${encodeURIComponent(deps.projectId)}/agent-sessions/${encodeURIComponent(deps.session().agentic_session_id)}/service-grants`;
    const update = {
      machineId,
      serviceIds: [...serviceIds],
      launchServiceId,
    } satisfies GrantAgentSessionServicesDto;
    const response = await this.dependencies.fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    });
    if (!response.ok) {
      const responseDetail = (await response.text()).trim().replace(/\s+/gu, ' ').slice(0, 500);
      throw new Error(
        `AgentSession Service grant failed with status ${String(response.status)}${responseDetail ? `: ${responseDetail}` : '.'}`,
      );
    }
  }
  private async settle(
    request: AgentSessionServiceScopeRequest,
    messageId: string,
    data: SystemMessageData | null,
    decision: 'approve' | 'deny',
  ): Promise<void> {
    const deps = this.dependencies;
    const decidedAt = new Date().toISOString();
    const updatedData = this.withDecision(
      data ?? serviceScopeMessageData(request, ['the requested Services']),
      decision,
      decidedAt,
    );
    await this.dependencies.poster.complete(
      deps.organizationId,
      deps.projectId,
      messageId,
      { status: MessageStatus.Completed, data: updatedData },
      null,
    );
    deps.serviceScope.settleServiceScopeRequest(request.id);
  }
  private withDecision(
    data: SystemMessageData,
    decision: 'approve' | 'deny',
    decidedAt: string,
  ): SystemMessageData {
    const uiElements = data.uiElements?.map((element) => {
      if (
        element.type !== ExtendedUIFieldType.AgentRequestServiceScope ||
        !element.payload ||
        !('responseType' in element.payload) ||
        element.payload.responseType !==
          AgentRequestServiceScopePayloadResponseTypeEnum.AgentRequestServiceScopeV1
      )
        return element;
      const payload: AgentRequestServiceScopePayload = {
        ...element.payload,
        decision:
          decision === 'approve'
            ? AgentRequestServiceScopePayloadDecisionEnum.Approve
            : AgentRequestServiceScopePayloadDecisionEnum.Deny,
        decidedAt,
      };
      return { ...element, payload };
    });
    return { ...data, ...(uiElements ? { uiElements } : {}) };
  }
}
