import {
  EntityType,
  type AttentionItemSummary,
  type AttentionSummaryEntity,
  type AttentionSummaryResponse,
} from '@hey-hey/contracts/api/models';
import type { LocalOpenItemsTriageItem } from '@hey-hey/contracts/agent-bridge';

export const TRIAGE_CAPS = {
  items: 100,
  groups: 50,
  goals: 20,
  trackedPerGoal: 100,
  connectionSeeds: 100,
  sourceProposalsPerSeed: 1,
  sourceConversationsPerSeed: 1,
  connectionsPerSeed: 50,
  connections: 200,
  reopen: 50,
} as const;
export const DAY_MS = 86_400_000;
export const itemKey = (item: Pick<LocalOpenItemsTriageItem, 'entityType' | 'entityId'>): string =>
  `${item.entityType}:${item.entityId}`;
// Attention is recorded for every viewable entity, but triage only reasons about these as open items.
export const OPEN_ITEM_ENTITY_TYPES: readonly EntityType[] = [
  EntityType.Initiative,
  EntityType.Task,
  EntityType.Project,
  EntityType.Conversation,
  EntityType.DesignDoc,
  EntityType.AgentSession,
  EntityType.Proposal,
];
const summaryItem = (entity: AttentionSummaryEntity): LocalOpenItemsTriageItem => ({
  entityType: entity.entityType,
  entityId: entity.entityId,
  title: entity.entityName,
});

export interface AttentionCounters {
  lastViewed: string | null;
  // These legacy view-named fields count focus-session starts, not navigation visits.
  // Source: OpenAPI schemas/analytics.yaml#AttentionSummaryResponse; the attention
  // producer does not specify how navigation/continuous events become sessions.
  viewsToday: number;
  viewsSevenDays: number;
  focusMsSevenDays: number;
}
export interface AttentionAggregate extends AttentionCounters {
  item: LocalOpenItemsTriageItem;
  totalsComplete: boolean;
}
const NO_ATTENTION: AttentionCounters = {
  lastViewed: null,
  viewsToday: 0,
  viewsSevenDays: 0,
  focusMsSevenDays: 0,
};
const counters = ({
  lastViewed,
  viewsToday,
  viewsSevenDays,
  focusMsSevenDays,
}: AttentionItemSummary): AttentionCounters => ({
  lastViewed,
  viewsToday,
  viewsSevenDays,
  focusMsSevenDays,
});

/** The summary to reason from when the API could not provide one. */
export function emptyAttentionSummary(now: number): AttentionSummaryResponse {
  return {
    since: new Date(now - 7 * DAY_MS).toISOString(),
    todayStartsAt: new Date(Math.floor(now / DAY_MS) * DAY_MS).toISOString(),
    asOf: new Date(now).toISOString(),
    items: [],
    switches: [],
    timeline: [],
    truncated: { switches: false, timeline: false },
    unreadableRecords: 0,
  };
}

/** Shapes the API's counts around the user's collection. The API does all the counting. */
export function attentionEvidence(
  summary: AttentionSummaryResponse,
  openItems: readonly LocalOpenItemsTriageItem[],
  complete: boolean,
  excludedKeys: ReadonlySet<string> = new Set(),
  authoritativeOpenKeys: ReadonlySet<string> = new Set(openItems.map(itemKey)),
) {
  const included = (entity: AttentionSummaryEntity) => !excludedKeys.has(itemKey(entity));
  const viewed = new Map(
    summary.items
      .filter(({ entity }) => included(entity))
      .map((record) => [itemKey(record.entity), record]),
  );
  const reopenSince = Date.parse(summary.asOf) - 2 * DAY_MS;
  const reopen: AttentionAggregate[] = [...viewed]
    .filter(
      ([key, record]) =>
        !authoritativeOpenKeys.has(key) && Date.parse(record.lastViewed) >= reopenSince,
    )
    .sort(
      ([leftKey, left], [rightKey, right]) =>
        right.lastViewed.localeCompare(left.lastViewed) || leftKey.localeCompare(rightKey),
    )
    .map(([, record]) => ({
      item: summaryItem(record.entity),
      ...counters(record),
      totalsComplete: complete,
    }));
  return {
    timezone: 'UTC',
    since: summary.since,
    todayStartsAt: summary.todayStartsAt,
    asOf: summary.asOf,
    totalsComplete: complete,
    openCounters: new Map(
      openItems.map((item) => {
        const record = viewed.get(itemKey(item));
        return [itemKey(item), record ? counters(record) : NO_ATTENTION];
      }),
    ),
    timeline: summary.timeline
      .filter(({ entity }) => included(entity))
      .map(({ entity, start, end, focusMs, views }) => ({
        item: summaryItem(entity),
        start,
        end,
        focusMs,
        views,
      })),
    reopenCandidates: reopen.slice(0, TRIAGE_CAPS.reopen),
    coAttention: summary.switches
      .filter(({ entities }) => entities.every(included))
      .map(({ entities, occurrences }) => ({ items: entities.map(summaryItem), occurrences })),
    truncated: {
      timeline: summary.truncated.timeline,
      reopen: reopen.length > TRIAGE_CAPS.reopen,
      coAttention: summary.truncated.switches,
    },
  };
}
