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
            expires_at: z
              .string()
              .datetime()
              .nullish()
              .transform((value) => value ?? null),
            /** Set by an originating tool that marks the action USER_REQUIRED. */
            user_required: z.boolean().optional(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export type TaskMonitorPermissionAdmission =
  | {
      accepted: true;
      providerSessionId: string;
      request: z.infer<typeof exactActionPayloadSchema>['canonical_event']['permission_request'];
    }
  | { accepted: false; reason: string };

/** Shared boundary validation for monitor admission and ordinary-card fallback. */
export const checkTaskMonitorPermissionAdmission = (
  event: LocalAgentOutputEvent,
): TaskMonitorPermissionAdmission => {
  if (event.source !== 'provider') {
    return { accepted: false, reason: 'permission_request_not_provider_owned' };
  }
  if (event.sessionId === null) {
    return { accepted: false, reason: 'permission_request_missing_provider_session' };
  }
  const parsed = exactActionPayloadSchema.safeParse(event.payload);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => `${issue.path.join('.')}:${issue.code}`);
    return { accepted: false, reason: `permission_request_invalid_fields:${fields.join(',')}` };
  }
  const request = parsed.data.canonical_event.permission_request;
  if (
    parsed.data.canonical_event.timestamp !== request.created_at ||
    event.timestamp !== request.created_at
  ) {
    return { accepted: false, reason: 'permission_request_timestamp_mismatch' };
  }
  return { accepted: true, request, providerSessionId: event.sessionId };
};

export const taskMonitorExactActionInputFromProviderEvent = (
  input: TaskMonitorProviderEventInput,
  createInterventionId: () => string = randomUUID,
  onRejected: (reason: string) => void = () => {},
): VerifiedTaskMonitorProviderInterventionInput | null => {
  if (input.event.runId !== input.owner.runId) {
    onRejected('permission_request_run_mismatch');
    return null;
  }
  const admission = checkTaskMonitorPermissionAdmission(input.event);
  if (!admission.accepted) {
    onRejected(admission.reason);
    return null;
  }
  const request = admission.request;

  return {
    source: 'PROVIDER_INTERVENTION',
    identity: { machineType: 'TASK_MONITOR', instanceId: input.owner.taskMonitorId },
    ingressId: `provider-action:${input.owner.runId}:${request.id}`,
    taskMonitorId: input.owner.taskMonitorId,
    interventionId: createInterventionId(),
    providerActionId: request.id,
    providerSessionId: admission.providerSessionId,
    runId: input.owner.runId,
    agentSessionId: input.owner.agentSessionId,
    action: request.action,
    target: request.target,
    fingerprint: request.fingerprint,
    createdAt: request.created_at,
    expiresAt: request.expires_at,
    userRequired: request.user_required === true,
  };
};
