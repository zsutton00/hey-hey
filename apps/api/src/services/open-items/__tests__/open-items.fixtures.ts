import type { EntityType, OpenItemLineageEntry } from 'src/generated';
import type {
  OpenItemGroupRow,
  OpenItemRow,
  OpenItemsMutationEnvironment,
  OpenItemsState,
} from '../open-items.domain';

export const T0 = new Date('2026-10-01T00:00:00.000Z');
export const NOW = new Date('2026-10-05T00:00:00.000Z');

export const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

export const ref = (n: number, entityType: EntityType = 'TASK') => ({
  entityType,
  entityId: uuid(n),
});

export function item(
  n: number,
  overrides: Partial<OpenItemRow> & { parents?: number[] } = {},
): OpenItemRow {
  const { parents = [], ...rest } = overrides;
  const lineage: OpenItemLineageEntry[] = parents.map((parent) => ref(parent));
  return {
    id: `item-${n}`,
    ...ref(n),
    note: null,
    pinned: false,
    position: `V${n.toString().padStart(3, '0')}`,
    groupId: null,
    memberPosition: null,
    goalTrackedWorkFilter: 'ACTIVE_AND_BACKLOG',
    goalCollapsed: true,
    revision: 1,
    lineage,
    presentation: { label: `Item ${n}` },
    removedAt: null,
    updatedAt: T0,
    ...rest,
  };
}

export function group(
  id: string,
  overrides: Partial<OpenItemGroupRow> = {},
): OpenItemGroupRow {
  return {
    id,
    name: `Group ${id}`,
    position: 'V',
    collapsed: false,
    revision: 1,
    updatedAt: T0,
    ...overrides,
  };
}

export function state(
  revision: number,
  items: OpenItemRow[] = [],
  groups: OpenItemGroupRow[] = [],
): OpenItemsState {
  return { revision, items, groups };
}

export function env(
  nextRevision: number,
): OpenItemsMutationEnvironment & { logs: string[] } {
  let counter = 1000;
  const logs: string[] = [];
  return {
    nextRevision,
    now: NOW,
    newId: () => uuid(counter++),
    log: (message) => logs.push(message),
    logs,
  };
}

export const key = (n: number) => `idem-key-${n}`;
