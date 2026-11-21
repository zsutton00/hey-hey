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
  type ServicePlaceChoice,
  type SystemMessageData,
  type GrantAgentSessionServicesDto,
} from '@hey-hey/contracts/api/models';
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
import type { TaskMonitorServiceScopeAdmission } from '../../server/task-monitor-service-scope-admission';
import { ProjectServiceNameResolver } from './project-service-name-resolver';
import { toOpenApiProjectId } from '../../shared/api/identifierAdapters';
type ServiceScopeDecider = 'monitor' | 'person';
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
  agentSessionId(): string;
  /** Where a monitored Run's request is sent to the Task Monitor; null until the monitor runtime is up. */
  taskMonitorAdmission(): TaskMonitorServiceScopeAdmission | null;
  applyApprovedServiceScope(input: {
    services: ResolvedServiceBinding[];
    launchServiceId: string;
    workspace: ResolvedRunWorkspace;
    servicePlaceChoices: ServicePlaceChoice[];
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
  `This conversation needs access to project Services: ${additionalServiceNames.join(', ')}. User review is required before repository changes continue.`;
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
  /** Settlement of one request never overlaps another answer to the same request. */
  private readonly settlementQueues = new Map<string, Promise<unknown>>();
  /** Who settled each request and how, so a later opposite answer is never reported as delivered. */
  private readonly settledBy = new Map<
    string,
    { decider: ServiceScopeDecider; decision: 'approve' | 'deny' }
  >();
  /** Requests whose platform grant succeeded, so a retry reconciles it instead of granting again. */
  private readonly platformGrantedRequestIds = new Set<string>();

  public constructor(private readonly dependencies: ServiceScopeCoordinatorDependencies) {
    this.serviceNameResolver = new ProjectServiceNameResolver(dependencies);
  }
  public async request(
    args: RequestAgentSessionServiceScopeArgs,
  ): Promise<ServiceScopeRequestResult> {
    const deps = this.dependencies;
    const scope = deps.serviceScope;
    const agentId = deps.currentAgentId();
    if (!agentId) throw new Error('Cannot request Service scope without an active agent handler.');
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
    const additionalServiceIds = requestedServiceIds.filter(
      (serviceId) => !currentServiceIds.includes(serviceId),
    );
    const proposedPlaces = this.proposePlaces(additionalServiceIds);
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
      proposedPlaces,
    };
    this.dependencies.logger.debug('local.service_scope.request.places_proposed', {
      runId: deps.runId,
      requestId: request.id,
      proposedPlaces,
    });
    const additionalServiceNames = await this.serviceNameResolver.resolve({
      runId: deps.runId,
      organizationId: deps.organizationId,
      projectId: toOpenApiProjectId(deps.projectId),
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
        projectId: toOpenApiProjectId(deps.projectId),
        data,
      },
      stamp: null,
    });
    scope.recordServiceScopeRequest(request, messageId, data);
    const monitored = deps.taskMonitorId() !== null;
    await scope.pauseForServiceScopeRequest(request.id, monitored ? 'automatic' : 'human');
    this.dependencies.logger.info('local.service_scope.request.created', {
      runId: deps.runId,
      requestId: request.id,
      currentServiceIds,
      requestedServiceIds,
      monitored,
    });
    if (monitored) {
      await this.admitToTaskMonitor(request, additionalServiceNames);
    }
    return { status: 'requested', request };
  }
  /**
   * A monitored Run's request goes to the Task Monitor, which approves, denies or hands it to the
   * person. Anything that keeps the monitor from receiving it hands it to the person instead, with
   * the cause logged, so the Run never waits on a decision nobody was asked to make.
   */
  private async admitToTaskMonitor(
    request: AgentSessionServiceScopeRequest,
    additionalServiceNames: readonly string[],
  ): Promise<void> {
    const deps = this.dependencies;
    const taskMonitorId = deps.taskMonitorId();
    const admission = deps.taskMonitorAdmission();
    if (taskMonitorId === null || admission === null) {
      this.handToHuman(request.id, 'The Task Monitor is not available to decide this request.');
      return;
    }

    try {
      const result = await admission.admit({
        taskMonitorId,
        runId: deps.runId,
        agentSessionId: deps.agentSessionId(),
        request,
        additionalServiceNames,
      });
      if (result.status === 'admitted') {
        deps.logger.info('local.service_scope.request.sent_to_task_monitor', {
          runId: deps.runId,
          requestId: request.id,
          taskMonitorId,
        });
        return;
      }
      deps.logger.warn('local.service_scope.request.task_monitor_rejected', {
        runId: deps.runId,
        requestId: request.id,
        taskMonitorId,
        code: result.code,
        reason: result.reason,
      });
      this.handToHuman(
        request.id,
        `The Task Monitor could not take this request: ${result.reason}`,
      );
    } catch (error) {
      deps.logger.error('local.service_scope.request.task_monitor_admission_failed', {
        runId: deps.runId,
        requestId: request.id,
        taskMonitorId,
        error,
      });
      this.handToHuman(request.id, 'The Task Monitor could not be reached for this request.');
    }
  }

  /** The person decides from here: the Run waits for their approval, not for the monitor. */
  public handToHuman(requestId: string, reason: string): void {
    const deps = this.dependencies;
    const moved = deps.serviceScope.handAutomaticRequestToHuman(requestId);
    deps.logger.info('local.service_scope.request.handed_to_human', {
      runId: deps.runId,
      requestId,
      reason,
      moved,
    });
  }

  /** Applies the Task Monitor's decision with the request's own session, agent and idempotency token. */
  public decideByMonitor(input: {
    requestId: string;
    decision: 'approve' | 'deny';
    reason: string | null;
  }): Promise<ServiceScopeDecisionResult> {
    return this.serialized(input.requestId, async () => {
      const pending = this.dependencies.serviceScope.getServiceScopeRequest(input.requestId);
      if (!pending) {
        return this.settledResult(input.requestId, 'monitor', input.decision);
      }

      return this.decideAs('monitor', {
        requestId: input.requestId,
        sessionId: pending.request.sessionId,
        agentType: pending.request.agentType,
        decision: input.decision,
        reason: input.reason,
        idempotencyToken: pending.request.idempotencyToken,
      });
    });
  }

  /** A person's answer from the Additional Service access card. */
  public decide(input: ServiceScopeDecisionInput): Promise<ServiceScopeDecisionResult> {
    return this.serialized(input.requestId, () => this.decideAs('person', input));
  }

  private async serialized<T>(requestId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.settlementQueues.get(requestId) ?? Promise.resolve();
    const next = previous.then(work, work);
    const tail = next.catch(() => undefined);
    this.settlementQueues.set(requestId, tail);
    try {
      return await next;
    } finally {
      if (this.settlementQueues.get(requestId) === tail) {
        this.settlementQueues.delete(requestId);
      }
    }
  }

  /** An answer for a request that is no longer pending: delivered only if it is the answer that settled it. */
  private settledResult(
    requestId: string,
    decider: ServiceScopeDecider,
    decision: 'approve' | 'deny',
  ): ServiceScopeDecisionResult {
    const settled = this.settledBy.get(requestId);
    if (!settled) {
      return this.dependencies.serviceScope.isServiceScopeRequestSettled(requestId)
        ? { outcome: 'delivered', callbackType: 'service_scope_decision' }
        : { outcome: 'dropped', reason: 'service_scope_request_not_found' };
    }
    if (settled.decider === decider && settled.decision === decision) {
      return { outcome: 'delivered', callbackType: 'service_scope_decision' };
    }
    this.dependencies.logger.warn('local.service_scope.decision.superseded_by_settled_answer', {
      runId: this.dependencies.runId,
      requestId,
      answeredBy: decider,
      answered: decision,
      settledBy: settled.decider,
      settled: settled.decision,
    });

    return { outcome: 'dropped', reason: 'service_scope_request_already_decided' };
  }

  /**
   * A request raised in this process carries its owner in memory. One restored after a restart
   * lost that marker, so the Task Monitor machine's durable record decides it, and the Run and the
   * monitor agree. When the machine cannot be read the person owns it, as when the monitor is
   * unavailable at request time.
   */
  private async decisionOwner(requestId: string): Promise<ServiceScopeDecider> {
    const deps = this.dependencies;
    const scope = deps.serviceScope;
    const taskMonitorId = deps.taskMonitorId();
    if (!scope.isRestoredServiceScopeRequest(requestId) || taskMonitorId === null) {
      return scope.serviceScopeDecisionOwner(requestId);
    }

    const admission = deps.taskMonitorAdmission();
    if (admission === null) {
      deps.logger.warn('local.service_scope.decision.restored_owner_unavailable', {
        runId: deps.runId,
        requestId,
        taskMonitorId,
        owner: 'person',
        cause: 'The Task Monitor runtime is not available to report who holds this request.',
      });
      return 'person';
    }
    try {
      const monitorHolds = await admission.monitorHoldsRequest({
        taskMonitorId,
        runId: deps.runId,
        requestId,
      });
      const owner = monitorHolds ? 'monitor' : 'person';
      deps.logger.info('local.service_scope.decision.restored_owner_resolved', {
        runId: deps.runId,
        requestId,
        taskMonitorId,
        owner,
      });
      return owner;
    } catch (error) {
      deps.logger.error('local.service_scope.decision.restored_owner_read_failed', {
        runId: deps.runId,
        requestId,
        taskMonitorId,
        owner: 'person',
        error,
      });
      return 'person';
    }
  }

  private async decideAs(
    decider: ServiceScopeDecider,
    input: ServiceScopeDecisionInput,
  ): Promise<ServiceScopeDecisionResult> {
    const deps = this.dependencies;
    const scope = deps.serviceScope;
    const pending = scope.getServiceScopeRequest(input.requestId);
    if (!pending) {
      return this.settledResult(input.requestId, decider, input.decision);
    }
    const owner = await this.decisionOwner(input.requestId);
    if (owner !== decider) {
      deps.logger.warn('local.service_scope.decision.wrong_owner', {
        runId: deps.runId,
        requestId: input.requestId,
        answeredBy: decider,
        owner,
      });

      return { outcome: 'dropped', reason: `service_scope_request_owned_by_${owner}` };
    }
    if (
      pending.request.sessionId !== input.sessionId ||
      pending.request.agentType !== input.agentType ||
      pending.request.idempotencyToken !== input.idempotencyToken
    )
      return { outcome: 'dropped', reason: 'service_scope_decision_context_mismatch' };
    if (await this.dependencies.runStore.hasIdempotencyToken(deps.runId, input.idempotencyToken))
      return { outcome: 'delivered', callbackType: 'service_scope_decision' };
    if (input.decision === 'deny' && this.platformGrantedRequestIds.has(pending.request.id)) {
      // The platform already holds the grant and cannot be asked to revoke it here, so a denial
      // would record a decision the session's access contradicts. Only finishing the grant is open.
      const reason =
        'Access was already granted on the platform and cannot be denied; approve to finish applying it.';
      deps.logger.warn('local.service_scope.denial.refused_after_platform_grant', {
        runId: deps.runId,
        requestId: input.requestId,
        answeredBy: decider,
      });

      return { outcome: 'failed', reason };
    }
    const placeProblem = this.findPlaceChoiceProblem(pending.request, input);
    if (placeProblem) {
      this.dependencies.logger.warn('local.service_scope.decision.place_choice_rejected', {
        runId: deps.runId,
        requestId: input.requestId,
        decision: input.decision,
        serviceId: placeProblem.serviceId,
        reason: placeProblem.reason,
      });
      return { outcome: 'dropped', reason: 'service_scope_decision_place_choice_rejected' };
    }
    if (input.decision === 'deny') {
      await this.settle(pending, input.decision, decider);
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
    // Keep an existing anchor; otherwise promote the first Service in the ordered union,
    // matching how typed Service mentions admit a launch anchor.
    const launchServiceId = deps.session().launchServiceId ?? serviceIds[0] ?? null;
    if (!launchServiceId || !serviceIds.includes(launchServiceId)) {
      this.dependencies.logger.warn('local.service_scope.approval.launch_service_missing', {
        runId: deps.runId,
        requestId: input.requestId,
        launchServiceId,
      });
      await this.settleFailedApproval(pending, input, decider);
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
      await this.settleFailedApproval(pending, input, decider);
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
      await this.settleFailedApproval(pending, input, decider);
      return { outcome: 'failed', reason: bindings.message };
    }
    const { choices: servicePlaceChoices, unresolvedServiceIds } = this.mergePlaceChoices(
      pending.request,
      input,
    );
    if (unresolvedServiceIds.length > 0) {
      const reason = `No place was chosen or proposed for ${unresolvedServiceIds.join(', ')}: its launch worktree branch is unknown, so choose where it should work.`;
      this.dependencies.logger.warn('local.service_scope.approval.place_unresolved', {
        runId: deps.runId,
        requestId: input.requestId,
        unresolvedServiceIds,
      });
      await this.settleFailedApproval(pending, input, decider, reason);
      return { outcome: 'failed', reason };
    }
    let workspace: Awaited<ReturnType<typeof resolveRunWorkspace>>;
    try {
      workspace = await resolveRunWorkspace({
        session: {
          ...deps.session(),
          services: bindings.services,
          launchServiceId,
          ...(servicePlaceChoices.length > 0 ? { servicePlaceChoices } : {}),
        },
        repoStore: this.dependencies.repoStore,
        logger: this.dependencies.logger,
      });
    } catch (error) {
      // Opening a chosen worktree throws (missing branch, collision, git failure):
      // the approval fails with that reason and nothing is granted.
      const reason = error instanceof Error ? error.message : String(error);
      this.dependencies.logger.warn('local.service_scope.approval.place_open_failed', {
        runId: deps.runId,
        requestId: input.requestId,
        servicePlaceChoices,
        error,
      });
      await this.settleFailedApproval(pending, input, decider, reason);
      return { outcome: 'failed', reason };
    }
    if (!workspace.ok) {
      this.dependencies.logger.warn('local.service_scope.approval.workspace_resolution_failed', {
        runId: deps.runId,
        requestId: input.requestId,
        reason: workspace.message,
        servicePlaceChoices,
      });
      await this.settleFailedApproval(pending, input, decider);
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
      await this.settleFailedApproval(pending, input, decider);
      return { outcome: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
    if (!machineId) {
      const reason = 'Approved Service scope requires a verified machine binding.';
      this.dependencies.logger.warn('local.service_scope.approval.machine_binding_missing', {
        runId: deps.runId,
        requestId: input.requestId,
      });
      await this.settleFailedApproval(pending, input, decider);
      return { outcome: 'failed', reason };
    }
    const existingServiceIds = new Set(deps.session().services.map((service) => service.id));
    const additionalServiceIds = serviceIds.filter(
      (serviceId) => !existingServiceIds.has(serviceId),
    );
    // A retry after a local failure finds the platform grant already made and does not repeat it.
    let platformGrantPersisted =
      additionalServiceIds.length === 0 || this.platformGrantedRequestIds.has(pending.request.id);
    try {
      if (!platformGrantPersisted) {
        await this.updatePlatformSession(machineId, additionalServiceIds, launchServiceId);
        platformGrantPersisted = true;
        this.platformGrantedRequestIds.add(pending.request.id);
      }
      await deps.applyApprovedServiceScope({
        services: bindings.services,
        launchServiceId,
        workspace,
        servicePlaceChoices,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (!platformGrantPersisted) {
        await this.settleFailedApproval(pending, input, decider);
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
        scope.handAutomaticRequestToHuman(pending.request.id);
      }
      return { outcome: 'failed', reason };
    }
    await this.settle(pending, input.decision, decider);
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
      servicePlaceChoices,
    });
    return { outcome: 'delivered', callbackType: 'service_scope_decision' };
  }
  /**
   * Where a newly requested Service would work, matching how the session launched.
   * A session that did not launch in a worktree proposes the main folder. A worktree
   * session proposes a worktree branch, never the main folder: a Service whose branch
   * cannot be determined is left out, and approving it without a choice fails.
   */
  private proposePlaces(serviceIds: readonly string[]): ServicePlaceChoice[] {
    const session = this.dependencies.session();
    if (!this.launchedInWorktree()) {
      return serviceIds.map((serviceId) => ({ serviceId, kind: 'MAIN_FOLDER' }));
    }
    const places: ServicePlaceChoice[] = [];
    for (const serviceId of serviceIds) {
      const branch = this.launchBranchFor(serviceId);
      if (branch) {
        places.push({ serviceId, kind: 'WORKTREE', branch, newBranch: false });
        continue;
      }
      this.dependencies.logger.debug('local.service_scope.request.place_not_proposed', {
        runId: this.dependencies.runId,
        serviceId,
        reason: 'worktree-launched session has no single known launch branch for this Service',
        launchChoices: session.servicePlaceChoices ?? null,
      });
    }
    return places;
  }

  private launchedInWorktree(): boolean {
    const session = this.dependencies.session();
    const choices = session.servicePlaceChoices ?? [];
    if (choices.length > 0) {
      return choices.some((choice) => choice.kind === 'WORKTREE');
    }
    return session.worktree?.enabled === true;
  }

  /** The Service's own launch branch if known, else the one branch every launch choice shares. */
  private launchBranchFor(serviceId: string): string | null {
    const session = this.dependencies.session();
    const choices = session.servicePlaceChoices ?? [];
    const own = choices.find((choice) => choice.serviceId === serviceId);
    if (own?.kind === 'WORKTREE') {
      return own.branch;
    }
    const ownState = session.worktreeState?.[serviceId]?.branch;
    if (ownState) {
      return ownState;
    }
    if (choices.length > 0) {
      const branches = new Set(
        choices.map((choice) => (choice.kind === 'WORKTREE' ? choice.branch : null)),
      );
      const [only] = [...branches];
      return branches.size === 1 && only ? only : null;
    }
    const launchState = session.launchServiceId
      ? session.worktreeState?.[session.launchServiceId]
      : undefined;
    return launchState?.branch ?? session.worktree?.branch ?? null;
  }

  /**
   * The places to open for the Services this approval adds: the approver's choice, or the
   * proposed place when none was sent (older UI, Task Monitor). Prior choices are kept.
   */
  private mergePlaceChoices(
    request: AgentSessionServiceScopeRequest,
    input: ServiceScopeDecisionInput,
  ): { choices: ServicePlaceChoice[]; unresolvedServiceIds: string[] } {
    const logger = this.dependencies.logger;
    const added = request.requestedServiceIds.filter(
      (serviceId) => !request.currentServiceIds.includes(serviceId),
    );
    const chosen = input.servicePlaceChoices ?? [];
    logger.debug('local.service_scope.approval.place_choices_received', {
      runId: this.dependencies.runId,
      requestId: request.id,
      chosen,
      proposed: request.proposedPlaces ?? [],
    });
    const unresolvedServiceIds: string[] = [];
    const effective = added.flatMap((serviceId) => {
      const choice = chosen.find((entry) => entry.serviceId === serviceId);
      if (choice) {
        return [choice];
      }
      const proposed = request.proposedPlaces?.find((entry) => entry.serviceId === serviceId);
      if (proposed) {
        logger.debug('local.service_scope.approval.place_fallback_to_proposed', {
          runId: this.dependencies.runId,
          requestId: request.id,
          serviceId,
        });
        return [proposed];
      }
      // A request that carries a proposal list but omits this Service deliberately left it
      // unproposed (unknown launch branch). A request with no list predates proposals.
      if (request.proposedPlaces) {
        unresolvedServiceIds.push(serviceId);
      }
      return [];
    });
    const prior = (this.dependencies.session().servicePlaceChoices ?? []).filter(
      (choice) => !added.includes(choice.serviceId),
    );
    return { choices: [...prior, ...effective], unresolvedServiceIds };
  }

  /** Place choices belong only to an approval, and only to Services the request adds. */
  private findPlaceChoiceProblem(
    request: AgentSessionServiceScopeRequest,
    input: ServiceScopeDecisionInput,
  ): { serviceId: string; reason: string } | null {
    const choices = input.servicePlaceChoices;
    if (!choices || choices.length === 0) return null;
    if (input.decision !== 'approve') {
      return { serviceId: choices[0]!.serviceId, reason: 'choices sent with a deny' };
    }
    const added = new Set(
      request.requestedServiceIds.filter(
        (serviceId) => !request.currentServiceIds.includes(serviceId),
      ),
    );
    const stray = choices.find((choice) => !added.has(choice.serviceId));
    return stray
      ? { serviceId: stray.serviceId, reason: 'Service is not part of the pending request' }
      : null;
  }
  private async settleFailedApproval(
    pending: ServiceScopeRequestEntry,
    input: ServiceScopeDecisionInput,
    decider: ServiceScopeDecider,
    failureReason?: string,
  ): Promise<void> {
    const deps = this.dependencies;
    const scope = deps.serviceScope;
    await scope.clearServiceScopeContinuation();
    await this.settle(pending, input.decision, decider, failureReason);
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
    entry: ServiceScopeRequestEntry,
    decision: 'approve' | 'deny',
    decider: ServiceScopeDecider,
    failureReason?: string,
  ): Promise<void> {
    const { request, messageId, data } = entry;
    const deps = this.dependencies;
    const decidedAt = new Date().toISOString();
    const updatedData = this.withDecision(
      data ?? serviceScopeMessageData(request, ['the requested Services']),
      decision,
      decidedAt,
      failureReason,
    );
    await this.dependencies.poster.complete(
      deps.organizationId,
      deps.projectId,
      messageId,
      { status: MessageStatus.Completed, data: updatedData },
      null,
    );
    deps.serviceScope.settleServiceScopeRequest(request.id);
    this.settledBy.set(request.id, { decider, decision });
    this.platformGrantedRequestIds.delete(request.id);
  }
  private withDecision(
    data: SystemMessageData,
    decision: 'approve' | 'deny',
    decidedAt: string,
    failureReason?: string,
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
        ...(failureReason ? { failureReason } : {}),
      };
      return { ...element, payload };
    });
    return { ...data, ...(uiElements ? { uiElements } : {}) };
  }
}
