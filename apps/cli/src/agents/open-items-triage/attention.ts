import { z } from 'zod';
import { EntityType } from '../../shared/api/generated/api';
import type { LocalOpenItemsTriageItem } from '../../shared/agent-bridge-contract/generated';

export const TRIAGE_CAPS = {
  attentionPages: 20,
  pageSize: 50,
  items: 100,
  groups: 50,
  goals: 20,
  trackedPerGoal: 100,
  connectionSeeds: 100,
  sourceProposalsPerSeed: 1,
  sourceConversationsPerSeed: 1,
  connectionsPerSeed: 50,
  connections: 200,
  timeline: 100,
  reopen: 50,
  coAttention: 50,
} as const;
export const DAY_MS = 86_400_000;
const PROXIMITY_MS = 10 * 60_000;
export const attentionSessionSchema = z
  .object({
    id: z.string().uuid(),
    entityType: z.nativeEnum(EntityType),
    entityId: z.string().uuid(),
    entityName: z.string().min(1),
    focusStart: z.string().datetime({ offset: true }),
    focusEnd: z.string().datetime({ offset: true }),
    durationMs: z.number().finite().nonnegative(),
  })
  .refine(
    (s) =>
      Date.parse(s.focusEnd) >= Date.parse(s.focusStart) &&
      s.durationMs <= Date.parse(s.focusEnd) - Date.parse(s.focusStart),
    'Invalid focus interval',
  );
export type AttentionSession = z.infer<typeof attentionSessionSchema>;
export const itemKey = (item: Pick<LocalOpenItemsTriageItem, 'entityType' | 'entityId'>): string =>
  `${item.entityType}:${item.entityId}`;
// Attention is recorded for every viewable entity, but triage only reasons about these as open items.
const openItemCandidateTypes: ReadonlySet<EntityType> = new Set([
  EntityType.Initiative,
  EntityType.Task,
  EntityType.Project,
  EntityType.Conversation,
  EntityType.DesignDoc,
]);
export const isOpenItemCandidate = (s: AttentionSession): boolean =>
  openItemCandidateTypes.has(s.entityType);
const sessionItem = (s: AttentionSession): LocalOpenItemsTriageItem => ({
  entityType: s.entityType,
  entityId: s.entityId,
  title: s.entityName,
});

export interface AttentionCounters {
  lastViewed: string | null;
  // These legacy view-named fields count focus-session starts, not navigation visits.
  // Source: OpenAPI schemas/analytics.yaml#AttentionEventResponse; the attention
  // endpoint does not specify how navigation/continuous events become sessions.
  viewsToday: number;
  viewsSevenDays: number;
  focusMsSevenDays: number;
}
export interface AttentionAggregate extends AttentionCounters {
  item: LocalOpenItemsTriageItem;
  totalsComplete: boolean;
}
interface TimelineSpan {
  item: LocalOpenItemsTriageItem;
  start: string;
  end: string;
  focusMs: number;
  views: number;
}

const counters = ({
  lastViewed,
  viewsToday,
  viewsSevenDays,
  focusMsSevenDays,
}: AttentionAggregate): AttentionCounters => ({
  lastViewed,
  viewsToday,
  viewsSevenDays,
  focusMsSevenDays,
});

export function reduceAttention(
  sessions: readonly AttentionSession[],
  openItems: readonly LocalOpenItemsTriageItem[],
  now: number,
  complete: boolean,
  excludedKeys: ReadonlySet<string> = new Set(),
  authoritativeOpenKeys: ReadonlySet<string> = new Set(openItems.map(itemKey)),
) {
  const since = now - 7 * DAY_MS;
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const events = [...new Map(sessions.map((s) => [s.id, s])).values()]
    .filter(
      (s) =>
        Date.parse(s.focusStart) <= now &&
        Date.parse(s.focusEnd) >= since &&
        !excludedKeys.has(itemKey(sessionItem(s))),
    )
    .sort(
      (a, b) => Date.parse(a.focusStart) - Date.parse(b.focusStart) || a.id.localeCompare(b.id),
    );
  const aggregates = new Map<string, AttentionAggregate>();
  for (const item of openItems)
    aggregates.set(itemKey(item), {
      item,
      lastViewed: null,
      viewsToday: 0,
      viewsSevenDays: 0,
      focusMsSevenDays: 0,
      totalsComplete: complete,
    });
  const timeline: TimelineSpan[] = [];
  const pairs = new Map<string, { items: LocalOpenItemsTriageItem[]; occurrences: number }>();
  let previous: AttentionSession | undefined;
  for (const event of events) {
    const item = sessionItem(event);
    const key = itemKey(item);
    const start = Date.parse(event.focusStart),
      end = Math.min(now, Date.parse(event.focusEnd));
    const focusMs = Math.min(event.durationMs, Math.max(0, end - Math.max(since, start)));
    const aggregate = aggregates.get(key) ?? {
      item,
      lastViewed: null,
      viewsToday: 0,
      viewsSevenDays: 0,
      focusMsSevenDays: 0,
      totalsComplete: complete,
    };
    aggregate.lastViewed = event.focusStart;
    aggregate.viewsToday += Number(start >= today);
    aggregate.viewsSevenDays += Number(start >= since);
    aggregate.focusMsSevenDays += focusMs;
    aggregates.set(key, aggregate);
    if (end >= now - 2 * DAY_MS) {
      const span = timeline.at(-1);
      const timelineStart = Math.max(start, now - 2 * DAY_MS);
      const timelineFocus = Math.min(event.durationMs, Math.max(0, end - timelineStart));
      if (
        span &&
        itemKey(span.item) === key &&
        timelineStart - Date.parse(span.end) <= PROXIMITY_MS
      ) {
        span.end = new Date(Math.max(end, Date.parse(span.end))).toISOString();
        span.focusMs += timelineFocus;
        span.views++;
      } else
        timeline.push({
          item,
          start: new Date(timelineStart).toISOString(),
          end: new Date(end).toISOString(),
          focusMs: timelineFocus,
          views: 1,
        });
    }
    // Adjacent distinct returned focus sessions are one observed transition.
    if (
      previous &&
      itemKey(sessionItem(previous)) !== key &&
      start - Date.parse(previous.focusEnd) <= PROXIMITY_MS &&
      start >= Date.parse(previous.focusStart)
    ) {
      const items = [sessionItem(previous), item].sort((a, b) =>
        itemKey(a).localeCompare(itemKey(b)),
      );
      const pairKey = items.map(itemKey).join('|');
      const pair = pairs.get(pairKey) ?? { items, occurrences: 0 };
      pair.occurrences++;
      pairs.set(pairKey, pair);
    }
    previous = event;
  }
  const reopen = [...aggregates.values()]
    .filter(
      (a) =>
        !authoritativeOpenKeys.has(itemKey(a.item)) &&
        a.lastViewed !== null &&
        Date.parse(a.lastViewed) >= now - 2 * DAY_MS,
    )
    .sort(
      (a, b) =>
        (b.lastViewed ?? '').localeCompare(a.lastViewed ?? '') ||
        itemKey(a.item).localeCompare(itemKey(b.item)),
    );
  const coAttention = [...pairs.values()]
    .filter((p) => p.occurrences >= 2)
    .sort(
      (a, b) =>
        b.occurrences - a.occurrences ||
        a.items.map(itemKey).join('|').localeCompare(b.items.map(itemKey).join('|')),
    );
  return {
    timezone: 'UTC',
    since: new Date(since).toISOString(),
    todayStartsAt: new Date(today).toISOString(),
    asOf: new Date(now).toISOString(),
    totalsComplete: complete,
    openCounters: new Map(
      openItems.map((item) => [itemKey(item), counters(aggregates.get(itemKey(item))!)]),
    ),
    timeline: timeline.slice(-TRIAGE_CAPS.timeline),
    reopenCandidates: reopen.slice(0, TRIAGE_CAPS.reopen),
    coAttention: coAttention.slice(0, TRIAGE_CAPS.coAttention),
    truncated: {
      timeline: timeline.length > TRIAGE_CAPS.timeline,
      reopen: reopen.length > TRIAGE_CAPS.reopen,
      coAttention: coAttention.length > TRIAGE_CAPS.coAttention,
    },
  };
}
