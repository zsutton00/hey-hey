import type { LocalOpenItemsTriageItem } from '../../shared/agent-bridge-contract/generated';
import { itemKey, TRIAGE_CAPS } from './attention';

export interface Connection {
  source: LocalOpenItemsTriageItem;
  target: Pick<LocalOpenItemsTriageItem, 'entityId' | 'entityType'> & { title?: string };
  relationship: string;
}
const lineage = new Set([
  'derives-from',
  'derived-from-by',
  'supersedes',
  'superseded-by',
  'evolves',
  'evolved-by',
  'depends-on',
  'depended-on-by',
]);

export function reduceConnections(
  connections: readonly Connection[],
  relevant: readonly LocalOpenItemsTriageItem[],
) {
  const keys = new Set(relevant.map(itemKey));
  const grouped = new Map<string, Connection[]>();
  for (const c of connections) {
    if (
      c.relationship === 'parent' ||
      (c.relationship === 'created-via' && c.target.entityType === 'CONVERSATION')
    ) {
      const key = `${c.relationship}:${itemKey(c.target)}`;
      const list = grouped.get(key) ?? [];
      list.push(c);
      grouped.set(key, list);
    }
  }
  const reduced = connections.filter(
    (c) => lineage.has(c.relationship) && keys.has(itemKey(c.target)),
  );
  for (const group of grouped.values()) {
    // Retain parent/source identities only when they connect two relevant seeds.
    const shared = group.filter((c) => keys.has(itemKey(c.source)));
    if (new Set(shared.map((c) => itemKey(c.source))).size >= 2) reduced.push(...shared);
  }
  const ordered = [
    ...new Map(
      reduced.map((c) => [`${itemKey(c.source)}:${c.relationship}:${itemKey(c.target)}`, c]),
    ).values(),
  ].sort(
    (a, b) =>
      itemKey(a.source).localeCompare(itemKey(b.source)) ||
      a.relationship.localeCompare(b.relationship) ||
      itemKey(a.target).localeCompare(itemKey(b.target)),
  );
  return {
    connections: ordered.slice(0, TRIAGE_CAPS.connections),
    truncated: ordered.length > TRIAGE_CAPS.connections,
  };
}
