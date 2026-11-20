import { createHash, randomUUID } from 'node:crypto';
import type { AgentSessionServiceScopeRequest } from '@hey-hey/contracts/api/models';
import type { ServerLogger } from './logger';
import type { TaskMonitorStateMachineInputAdapter } from './state-machine-input-adapter';

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

/** Sends a monitored Run's Service scope request to the Task Monitor machine to be decided. */
export class TaskMonitorServiceScopeAdmission {
  public constructor(
    private readonly inputAdapter: TaskMonitorStateMachineInputAdapter,
    private readonly logger: ServerLogger,
  ) {}

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
