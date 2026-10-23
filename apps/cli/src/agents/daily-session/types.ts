import type {
  ActiveGoalDto,
  AttentionEventResponse,
  RecentActivityCorrelationRecordDto,
} from '../../shared/api/generated/api';
import type { ServerLogger } from '../../server/logger';
import type { LocalDailySessionPromptPayload } from '../../shared/agent-bridge-contract/generated/api';
import type { DeltaResult } from './delta-calculator';

/**
 * Activity record type used internally by the daily session handler.
 * These come from the platform API's activity correlation endpoint.
 */
export type ActivityRecord = RecentActivityCorrelationRecordDto;

export interface ActivityDeltaStatusChange {
  entityId: string;
  entityType: string;
  title: string;
  previousStatus: string;
  currentStatus: string;
  changedAt: string;
}

export interface ActivityDeltaItemCompletion {
  entityId: string;
  entityType: string;
  title: string;
  completedAt: string;
}

export interface ActivityDeltaNewSignal {
  entityId: string;
  entityType: string;
  title: string;
  signalType: string;
  receivedAt: string;
}

export interface ActivityDelta {
  statusChanges: ActivityDeltaStatusChange[];
  itemCompletions: ActivityDeltaItemCompletion[];
  newSignals: ActivityDeltaNewSignal[];
  computedAt: string;
}

/**
 * Internal enriched payload passed to the prompt builder.
 * This is NOT the API contract — the API payload is thin
 * (payloadVersion + optional userMessage). The handler's
 * prepare method constructs this from fetched data.
 */
export interface DailySessionPromptInput {
  activitySnapshot: ActivityRecord[];
  computedDelta: ActivityDelta;
  userMessage?: string;
  /** Delta from trigger signals, when the session was initiated by a trigger. */
  triggerDelta?: DeltaResult;
  /** User-declared focus intent, when set on the session. */
  userFocus?: string;
  /** Active goals for the user (GOAL-typed tasks due within the look-ahead window). Absent and empty are equivalent on the consumer side. */
  activeGoals?: ActiveGoalDto[];
}

/**
 * Attention is behavioral evidence only. It deliberately carries the
 * resolved entity label and focus interval, but not the optional full entity
 * payload returned by the analytics endpoint.
 */
export type DailySessionAttentionEvidence = Pick<
  AttentionEventResponse,
  'entityType' | 'entityId' | 'entityName' | 'focusStart' | 'focusEnd' | 'durationMs' | 'tab'
>;

export interface DailySessionCoachPromptInput extends DailySessionPromptInput {
  attentionEvidence: readonly DailySessionAttentionEvidence[];
}

/** Internal payload enrichment shared by the report and coach handlers. */
export type DailySessionEnrichedPayload<
  TInput extends DailySessionPromptInput = DailySessionPromptInput,
> = LocalDailySessionPromptPayload & {
  _enriched?: TInput;
  _logger?: ServerLogger;
};
