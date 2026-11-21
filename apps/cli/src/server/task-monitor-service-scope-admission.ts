import { createHash, randomUUID } from 'node:crypto';
import type { AgentSessionServiceScopeRequest } from '@hey-hey/contracts/api/models';
import type { ServerLogger } from './logger';
import type { TaskMonitorStateMachineInputAdapter } from './state-machine-input-adapter';
import type { TaskMonitorStateStore } from '../agents/task-monitor/state-machine/machine';

export interface TaskMonitorServiceScopeRequestInput {
  readonly taskMonitorId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly request: AgentSessionServiceScopeRequest;
  readonly additionalServiceNames: readonly string[];
}

export type TaskMonitorServiceScopeAdmissionResult =
  | { readonly status: 'admitted' }
  | { readonly status: 'rejected'; readonly code: string; readonly reason: string };

/**
 * The exact action a Service scope request asks for: the Services it would add and the reason
 * given. A request for different Services, or for the same Services with a different reason,
 * is a different action and needs its own decision.
 */
export const serviceScopeFingerprint = (request: AgentSessionServiceScopeRequest): string => {
  const additionalServiceIds = request.requestedServiceIds.filter(
    (serviceId) => !request.currentServiceIds.includes(serviceId),
  );
  const digest = createHash('sha256')
    .update(JSON.stringify([[...additionalServiceIds].sort(), request.reason]))
    .digest('hex');

  return `service-scope:${digest}`;
};

/**
 * Sends a monitored Run's Service scope request to the Task Monitor machine to be decided, and
 * answers who owns it from the machine's durable record.
 */
export class TaskMonitorServiceScopeAdmission {
  public constructor(
    private readonly inputAdapter: TaskMonitorStateMachineInputAdapter,
    private readonly stateStore: TaskMonitorStateStore,
    private readonly logger: ServerLogger,
  ) {}

  /**
   * The machine is the one authority on who holds a request. It holds a Service scope request for
   * the monitor while the request is its front or queued request and has not been handed to a
   * person; once handed over, the machine drops its copy and the person owns it.
   */
  public async monitorHoldsRequest(input: {
    readonly taskMonitorId: string;
    readonly runId: string;
    readonly requestId: string;
  }): Promise<boolean> {
    const stored = await this.stateStore.findByInstanceId(input.taskMonitorId);
    const context = stored?.snapshot.context;
    const requests = context
      ? [
          ...(context.pendingIntervention ? [context.pendingIntervention] : []),
          ...(context.queuedInterventions ?? []),
        ]
      : [];
    const held = requests.some(
      (request) =>
        request.requestKind === 'SERVICE_SCOPE' &&
        request.providerActionId === input.requestId &&
        request.runId === input.runId &&
        request.userRequired !== true &&
        request.owner !== 'HUMAN',
    );
    this.logger.debug('task_monitor.service_scope_admission.owner_read', {
      ...input,
      machineFound: stored !== null,
      owner: held ? 'MONITOR' : 'HUMAN',
    });

    return held;
  }

  public async admit(
    input: TaskMonitorServiceScopeRequestInput,
  ): Promise<TaskMonitorServiceScopeAdmissionResult> {
    const { request } = input;
    const result = await this.inputAdapter.admitVerified({
      source: 'PROVIDER_INTERVENTION',
      identity: { machineType: 'TASK_MONITOR', instanceId: input.taskMonitorId },
      ingressId: `service-scope:${input.runId}:${request.id}`,
      taskMonitorId: input.taskMonitorId,
      interventionId: randomUUID(),
      providerActionId: request.id,
      providerSessionId: request.sessionId,
      runId: input.runId,
      agentSessionId: input.agentSessionId,
      action: 'Give the coding session access to additional project Services',
      target: `Services: ${input.additionalServiceNames.join(', ')}. Reason given: ${request.reason}`,
      fingerprint: serviceScopeFingerprint(request),
      createdAt: request.timestamp,
      expiresAt: null,
      userRequired: false,
      requestKind: 'SERVICE_SCOPE',
    });
    if (result.status === 'rejected') {
      return { status: 'rejected', code: result.code, reason: result.reason };
    }
    this.logger.debug('task_monitor.service_scope_admission.admitted', {
      taskMonitorId: input.taskMonitorId,
      runId: input.runId,
      requestId: request.id,
      status: result.status,
    });

    return { status: 'admitted' };
  }
}
