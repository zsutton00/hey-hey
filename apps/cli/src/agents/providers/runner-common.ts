import type { RunStore } from '../../run-store/run-store';
import type { NormalizedProviderFacts } from './provider-event-normalization';
import type { AgentPermissionDecisionDispatch } from '../permission-response-routing';
import type { RunWorkspaceResolution } from '../run-scope';
import { AgentSessionRunnerError } from './session-runner';

/** Bookkeeping shared by the provider session runners; behavior stays provider-neutral. */

/**
 * A `pending_`-prefixed provider session id is the platform-wide Run seed, not
 * a real native id, so it means "no provider session yet".
 */
export const nativeProviderSessionId = (trimmedId: string | null): string | null =>
  trimmedId && !trimmedId.startsWith('pending_') ? trimmedId : null;

/** The runner error thrown when the Run workspace could not be resolved. */
export const workspaceResolutionError = (
  workspace: Extract<RunWorkspaceResolution, { ok: false }>,
): AgentSessionRunnerError =>
  new AgentSessionRunnerError(
    workspace.code === 'REPO_BINDING_MISSING' ? 'REPO_BINDING_MISSING' : 'RUN_FAILED',
    workspace.message,
  );

export type RunnerRawEventEmitter = (input: {
  source: 'provider' | 'local';
  eventType: string;
  timestamp: string;
  sessionId: string | null;
  agentId: string | null;
  payload: Record<string, unknown>;
  providerFacts?: NormalizedProviderFacts;
}) => void;

/**
 * Persist the user's permission decision and emit the submitted and UI events
 * that follow it, all stamped with one decision timestamp.
 */
export const recordPermissionDecisionSubmitted = async ({
  runStore,
  emitRawEvent,
  agenticSessionId,
  dispatch,
}: {
  runStore: RunStore;
  emitRawEvent: RunnerRawEventEmitter;
  agenticSessionId: string;
  dispatch: AgentPermissionDecisionDispatch;
}): Promise<void> => {
  const decisionTimestamp = new Date().toISOString();
  await runStore.appendEvent(agenticSessionId, {
    run_id: agenticSessionId,
    actor: 'app',
    event_type: 'agent_output',
    state_version: 1,
    payload: {
      messageType: 'permission_decision_ui',
      requestId: dispatch.routing.requestId,
      decision: dispatch.decision,
      decidedAt: decisionTimestamp,
      ...(dispatch.routing.userId ? { userId: dispatch.routing.userId } : {}),
    },
  });
  emitRawEvent({
    source: 'local',
    eventType: 'permission_decision_submitted',
    timestamp: decisionTimestamp,
    sessionId: dispatch.routing.sessionId,
    agentId: null,
    payload: {
      messageType: 'permission_decision_submitted',
      agent_type: dispatch.agentType,
      decision: dispatch.decision,
      callback_type: dispatch.callbackType,
      request_id: dispatch.routing.requestId,
      idempotency_token: dispatch.routing.idempotencyToken,
      callback_payload: dispatch.callbackPayload,
    },
  });
  emitRawEvent({
    source: 'local',
    eventType: 'permission_decision_ui',
    timestamp: decisionTimestamp,
    sessionId: dispatch.routing.sessionId,
    agentId: null,
    payload: {
      requestId: dispatch.routing.requestId,
      decision: dispatch.decision,
      decidedAt: decisionTimestamp,
      ...(dispatch.routing.userId ? { userId: dispatch.routing.userId } : {}),
    },
  });
};
