import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';

import type { LocalAgentOutputEvent } from '../../../run/types';
import type { VerifiedTaskMonitorProviderInterventionInput } from './events';

interface TaskMonitorOwnedRunIdentity {
  readonly taskMonitorId: string;
  readonly runId: string;
  readonly agentSessionId: string;
}

export interface TaskMonitorProviderEventInput {
  readonly owner: TaskMonitorOwnedRunIdentity;
  readonly event: LocalAgentOutputEvent;
}

const exactActionPayloadSchema = z
  .object({
    messageType: z.literal('provider_event'),
    canonical_event_type: z.literal('permission_request'),
    normalization: z.object({ success: z.literal(true) }).passthrough(),
    canonical_event: z
      .object({
        canonical_event_type: z.literal('permission_request'),
        timestamp: z.string().datetime(),
        permission_request: z
          .object({
            id: z.string().trim().min(1),
            action: z.string().trim().min(1),
            target: z.string().trim().min(1),
            fingerprint: z.string().trim().min(1),
            created_at: z.string().datetime(),
            expires_at: z.string().datetime(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

/**
 * Converts one already-normalized provider boundary event into an addressed,
 * immutable Task Monitor input. It performs shape and ownership checks only;
 * policy remains in the machine.
 */
export const taskMonitorExactActionInputFromProviderEvent = (
  input: TaskMonitorProviderEventInput,
  createInterventionId: () => string = randomUUID,
  now: () => number = Date.now,
): VerifiedTaskMonitorProviderInterventionInput | null => {
  if (
    input.event.runId !== input.owner.runId ||
    input.event.source !== 'provider' ||
    input.event.sessionId === null
  ) {
    return null;
  }

  const parsed = exactActionPayloadSchema.safeParse(input.event.payload);
  if (!parsed.success) return null;

  const request = parsed.data.canonical_event.permission_request;
  if (
    parsed.data.canonical_event.timestamp !== request.created_at ||
    input.event.timestamp !== request.created_at ||
    Date.parse(request.expires_at) <= Date.parse(request.created_at) ||
    Date.parse(request.expires_at) <= now()
  ) {
    return null;
  }

  return {
    source: 'PROVIDER_INTERVENTION',
    identity: { machineType: 'TASK_MONITOR', instanceId: input.owner.taskMonitorId },
    ingressId: `provider-action:${input.owner.runId}:${request.id}`,
    taskMonitorId: input.owner.taskMonitorId,
    interventionId: createInterventionId(),
    providerActionId: request.id,
    providerSessionId: input.event.sessionId,
    runId: input.owner.runId,
    agentSessionId: input.owner.agentSessionId,
    action: request.action,
    target: request.target,
    fingerprint: request.fingerprint,
    createdAt: request.created_at,
    expiresAt: request.expires_at,
  };
};
