import type {
  ActivateOpenItemRequest,
  AssignOpenItemsToGroupRequest,
  CreateOpenItemGroupRequest,
  DeleteOpenItemGroupRequest,
  EntityType,
  MigrateOpenItemsRequest,
  MoveOpenItemGroupMemberRequest,
  MoveOpenItemGroupRequest,
  MoveOpenItemRequest,
  OpenItem,
  OpenItemGoalTrackedWorkFilter,
  OpenItemGroup,
  OpenItemLineageEntry,
  OpenItemPresentation,
  OpenItemRef,
  OpenItemsMutationResult,
  OpenItemsPresentCollection,
  RemoveOpenItemRequest,
  RemoveOpenItemsRequest,
  RenameOpenItemGroupRequest,
  ResetOpenItemsRequest,
  SetOpenItemGroupDisclosureRequest,
  SetOpenItemNoteRequest,
  SetOpenItemPinRequest,
  SetOpenItemGoalFilterRequest,
  SetOpenItemGoalDisclosureRequest,
  UngroupOpenItemsRequest,
} from 'src/generated';
import {
  comparePositionKeys,
  evenlySpacedPositionKeys,
  MAX_POSITION_KEY_LENGTH,
  positionKeyAfter,
  positionKeyBetween,
} from './open-items-position';
import {
  OpenItemsConflictException,
  OpenItemsValidationException,
} from './open-items.errors';

export const MAX_OPEN_ITEMS = 1000;
export const MAX_OPEN_ITEM_GROUPS = 200;

export interface OpenItemRow {
  id: string;
  entityType: EntityType;
  entityId: string;
  note: string | null;
  pinned: boolean;
  position: string;
  groupId: string | null;
  memberPosition: string | null;
  goalTrackedWorkFilter: OpenItemGoalTrackedWorkFilter;
  goalCollapsed: boolean;
  revision: number;
  lineage: OpenItemLineageEntry[];
  presentation: OpenItemPresentation;
  removedAt: Date | null;
  updatedAt: Date;
}

export interface OpenItemGroupRow {
  id: string;
  name: string;
  position: string;
  collapsed: boolean;
  revision: number;
  updatedAt: Date;
}

/** Collection state as loaded inside the mutation transaction. */
export interface OpenItemsState {
  revision: number;
  items: OpenItemRow[];
  groups: OpenItemGroupRow[];
}

export interface OpenItemsMutationEnvironment {
  /** Collection revision this mutation commits. */
  nextRevision: number;
  now: Date;
  newId: () => string;
  log: (message: string) => void;
}

/** Rows to write; persistence applies them in a foreign-key-safe order. */
export interface OpenItemsChangeSet {
  clearCollection: boolean;
  createdItemIds: Set<string>;
  createdGroupIds: Set<string>;
  items: Map<string, OpenItemRow>;
  groups: Map<string, OpenItemGroupRow>;
  deletedGroupIds: string[];
}

export type OpenItemsOutcome =
  | {
      kind: 'unchanged';
      changes: OpenItemsChangeSet;
      result: OpenItemsMutationResult;
    }
  | {
      kind: 'mutation';
      changes: OpenItemsChangeSet;
      result: OpenItemsMutationResult;
    }
  | {
      kind: 'collection';
      changes: OpenItemsChangeSet;
      result: OpenItemsPresentCollection;
    };

const identityKey = (ref: { entityType: string; entityId: string }) =>
  `${ref.entityType}:${ref.entityId}`;

/** Both null and the empty string clear a note; the stored value is null. */
export const normalizeNote = (note: string | null): string | null =>
  note === null || note === '' ? null : note;

const normalizeGroupName = (name: string, path: string): string => {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw OpenItemsValidationException.of(
      'INVALID_REQUEST',
      'Group names must not be blank.',
      [{ path, message: 'must contain a non-whitespace character' }],
    );
  }
  return trimmed;
};

const sameLineage = (a: OpenItemLineageEntry[], b: OpenItemLineageEntry[]) =>
  a.length === b.length &&
  a.every(
    (entry, index) =>
      entry.entityType === b[index]?.entityType &&
      entry.entityId === b[index]?.entityId,
  );

const sameRouteParams = (
  a: OpenItemPresentation['routeParams'],
  b: OpenItemPresentation['routeParams'],
) => {
  const left = a ?? null;
  const right = b ?? null;
  if (left === null || right === null) return left === right;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => key in right && left[key] === right[key])
  );
};

const samePresentation = (a: OpenItemPresentation, b: OpenItemPresentation) =>
  a.label === b.label &&
  (a.workItemTypeKey ?? null) === (b.workItemTypeKey ?? null) &&
  (a.agentSessionType ?? null) === (b.agentSessionType ?? null) &&
  sameRouteParams(a.routeParams, b.routeParams);

export const toOpenItemDto = (row: OpenItemRow): OpenItem => ({
  entityType: row.entityType,
  entityId: row.entityId,
  note: row.note,
  pinned: row.pinned,
  position: row.position,
  groupId: row.groupId,
  memberPosition: row.memberPosition,
  goalTrackedWorkFilter: row.goalTrackedWorkFilter,
  goalCollapsed: row.goalCollapsed,
  revision: row.revision,
  lineage: row.lineage,
  presentation: row.presentation,
  removedAt: row.removedAt?.toISOString() ?? null,
  updatedAt: row.updatedAt.toISOString(),
});

export const toOpenItemGroupDto = (row: OpenItemGroupRow): OpenItemGroup => ({
  groupId: row.id,
  name: row.name,
  position: row.position,
  collapsed: row.collapsed,
  revision: row.revision,
  updatedAt: row.updatedAt.toISOString(),
});

export const byPosition = (a: { position: string }, b: { position: string }) =>
  comparePositionKeys(a.position, b.position);

/** Canonical PRESENT read model: open items and groups in position order. */
export function toPresentCollection(
  state: OpenItemsState,
): OpenItemsPresentCollection {
  return {
    state: 'PRESENT',
    revision: state.revision,
    items: state.items
      .filter((item) => item.removedAt === null)
      .sort(byPosition)
      .map(toOpenItemDto),
    groups: [...state.groups].sort(byPosition).map(toOpenItemGroupDto),
  };
}

/**
 * Mutable working copy of one collection inside a transaction. Every touched
 * row takes the committed collection revision as its new revision, so item
 * and group revisions are monotonic and never reused.
 */
class OpenItemsWorkspace {
  private readonly items = new Map<string, OpenItemRow>();
  private readonly itemsByIdentity = new Map<string, OpenItemRow>();
  private readonly groups = new Map<string, OpenItemGroupRow>();
  readonly changes: OpenItemsChangeSet = {
    clearCollection: false,
    createdItemIds: new Set(),
    createdGroupIds: new Set(),
    items: new Map(),
    groups: new Map(),
    deletedGroupIds: [],
  };

  constructor(
    readonly state: OpenItemsState,
    readonly env: OpenItemsMutationEnvironment,
  ) {
    for (const item of state.items) {
      const copy = { ...item };
      this.items.set(copy.id, copy);
      this.itemsByIdentity.set(identityKey(copy), copy);
    }
    for (const group of state.groups) {
      this.groups.set(group.id, { ...group });
    }
  }

  get currentRevision() {
    return this.state.revision;
  }

  find(ref: { entityType: string; entityId: string }) {
    return this.itemsByIdentity.get(identityKey(ref));
  }

  openItems(): OpenItemRow[] {
    return [...this.items.values()]
      .filter((item) => item.removedAt === null)
      .sort(byPosition);
  }

  allGroups(): OpenItemGroupRow[] {
    return [...this.groups.values()].sort(byPosition);
  }

  group(groupId: string) {
    return this.groups.get(groupId);
  }

  members(groupId: string): OpenItemRow[] {
    return this.openItems()
      .filter((item) => item.groupId === groupId)
      .sort((a, b) =>
        comparePositionKeys(a.memberPosition ?? '', b.memberPosition ?? ''),
      );
  }

  touchItem(item: OpenItemRow, patch: Partial<OpenItemRow>) {
    Object.assign(item, patch, {
      revision: this.env.nextRevision,
      updatedAt: this.env.now,
    });
    this.changes.items.set(item.id, item);
  }

  insertItem(row: Omit<OpenItemRow, 'id' | 'revision' | 'updatedAt'>) {
    const item: OpenItemRow = {
      ...row,
      id: this.env.newId(),
      revision: this.env.nextRevision,
      updatedAt: this.env.now,
    };
    this.items.set(item.id, item);
    this.itemsByIdentity.set(identityKey(item), item);
    this.changes.createdItemIds.add(item.id);
    this.changes.items.set(item.id, item);
    return item;
  }

  touchGroup(group: OpenItemGroupRow, patch: Partial<OpenItemGroupRow>) {
    Object.assign(group, patch, {
      revision: this.env.nextRevision,
      updatedAt: this.env.now,
    });
    this.changes.groups.set(group.id, group);
  }

  insertGroup(row: Omit<OpenItemGroupRow, 'id' | 'revision' | 'updatedAt'>) {
    const group: OpenItemGroupRow = {
      ...row,
      id: this.env.newId(),
      revision: this.env.nextRevision,
      updatedAt: this.env.now,
    };
    this.groups.set(group.id, group);
    this.changes.createdGroupIds.add(group.id);
    this.changes.groups.set(group.id, group);
    return group;
  }

  deleteGroup(group: OpenItemGroupRow) {
    this.groups.delete(group.id);
    this.changes.groups.delete(group.id);
    this.changes.deletedGroupIds.push(group.id);
  }

  clear() {
    this.items.clear();
    this.itemsByIdentity.clear();
    this.groups.clear();
    this.changes.clearCollection = true;
    this.changes.items.clear();
    this.changes.groups.clear();
    this.changes.createdItemIds.clear();
    this.changes.createdGroupIds.clear();
  }

  /**
   * Open items whose stored lineage contains any of the given roots. Lineage
   * carries the full route-owned ancestor chain, so one pass finds every
   * nested descendant.
   */
  openDescendants(roots: OpenItemRow[]): OpenItemRow[] {
    const rootKeys = new Set(roots.map(identityKey));
    return this.openItems().filter(
      (item) =>
        !rootKeys.has(identityKey(item)) &&
        item.lineage.some((entry) => rootKeys.has(identityKey(entry))),
    );
  }

  mutationResult(
    items: OpenItemRow[],
    groups: OpenItemGroupRow[],
  ): OpenItemsOutcome {
    const uniqueItems = [
      ...new Map(items.map((item) => [item.id, item])).values(),
    ];
    const uniqueGroups = [
      ...new Map(groups.map((group) => [group.id, group])).values(),
    ];
    return {
      kind: 'mutation',
      changes: this.changes,
      result: {
        collectionRevision: this.env.nextRevision,
        items: uniqueItems.map(toOpenItemDto),
        groups: uniqueGroups.map(toOpenItemGroupDto),
        deletedGroupIds: [...this.changes.deletedGroupIds],
        replayed: false,
      },
    };
  }

  /** Canonical current state of `items`; nothing is written. */
  unchangedResult(items: OpenItemRow[]): OpenItemsOutcome {
    return {
      kind: 'unchanged',
      changes: this.changes,
      result: {
        collectionRevision: this.state.revision,
        items: items.map(toOpenItemDto),
        groups: [],
        deletedGroupIds: [],
        replayed: false,
      },
    };
  }

  collectionResult(): Extract<OpenItemsOutcome, { kind: 'collection' }> {
    return {
      kind: 'collection',
      changes: this.changes,
      result: toPresentCollection({
        revision: this.env.nextRevision,
        items: [...this.items.values()],
        groups: [...this.groups.values()],
      }),
    };
  }
}

// ---------- current targets ----------
function findOpenItem(workspace: OpenItemsWorkspace, ref: OpenItemRef) {
  const item = workspace.find(ref);
  return item?.removedAt === null ? item : undefined;
}

function openSelection(
  workspace: OpenItemsWorkspace,
  refs: OpenItemRef[],
): OpenItemRow[] {
  return refs.flatMap((ref) => {
    const item = findOpenItem(workspace, ref);
    return item ? [item] : [];
  });
}

const invalidPlacement = (path: string, message: string) =>
  OpenItemsValidationException.of('INVALID_PLACEMENT', message, [
    { path, message },
  ]);

// ---------- ordering ----------

/**
 * Places `moving` after `anchor` (or first) within `ordered`, rewriting only
 * the moved row unless the key would exceed the contract length, in which
 * case the whole sequence is evenly respaced.
 */
function place<Row>(
  workspace: OpenItemsWorkspace,
  ordered: Row[],
  moving: Row,
  anchor: Row | null,
  read: (row: Row) => string,
  write: (row: Row, key: string) => void,
) {
  const others = ordered.filter((row) => row !== moving);
  const anchorIndex = anchor === null ? -1 : others.indexOf(anchor);
  const lower = anchor === null ? null : read(anchor);
  const upperRow = others[anchorIndex + 1];
  const key = positionKeyBetween(lower, upperRow ? read(upperRow) : null);
  if (key.length <= MAX_POSITION_KEY_LENGTH) {
    write(moving, key);
    return;
  }
  workspace.env.log(
    `Position key exhausted for a sequence of ${ordered.length}; respacing`,
  );
  const sequence = [...others];
  sequence.splice(anchorIndex + 1, 0, moving);
  const spacedKeys = evenlySpacedPositionKeys(sequence.length);
  sequence.forEach((row, index) => write(row, spacedKeys[index] as string));
}

function appendKey(keys: string[]): string {
  return positionKeyAfter(keys.at(-1) ?? null);
}

// ---------- membership ----------

function inheritAncestorGroup(
  workspace: OpenItemsWorkspace,
  item: OpenItemRow,
) {
  const ancestor = [...item.lineage]
    .reverse()
    .map((entry) => findOpenItem(workspace, entry))
    .find((entry) => entry !== undefined);
  if (!ancestor || ancestor.groupId === null) return;

  const members = workspace.members(ancestor.groupId);
  workspace.touchItem(item, { groupId: ancestor.groupId });
  place(
    workspace,
    [...members, item],
    item,
    members.at(-1) ?? null,
    (row) => row.memberPosition ?? '',
    (row, memberPosition) => workspace.touchItem(row, { memberPosition }),
  );
}

function removableDescendant(root: OpenItemRow, descendant: OpenItemRow) {
  return (
    !descendant.pinned &&
    (descendant.groupId === null ||
      (root.groupId !== null && descendant.groupId === root.groupId))
  );
}

function assignToGroup(
  workspace: OpenItemsWorkspace,
  group: OpenItemGroupRow,
  selected: OpenItemRow[],
): OpenItemRow[] {
  const descendants = workspace.openDescendants(selected);
  const affected = [
    ...new Map(
      [...selected, ...descendants].map((item) => [item.id, item]),
    ).values(),
  ].sort(byPosition);
  workspace.env.log(
    `Assigning ${selected.length} selected and ${descendants.length} descendant item(s) to group ${group.id}`,
  );
  const memberKeys = workspace
    .members(group.id)
    .map((member) => member.memberPosition ?? '');
  for (const item of affected) {
    if (item.groupId === group.id) continue;
    const memberPosition = appendKey(memberKeys);
    memberKeys.push(memberPosition);
    workspace.touchItem(item, { groupId: group.id, memberPosition });
  }
  return affected;
}

// ---------- operations ----------

export function activateOpenItem(
  state: OpenItemsState,
  env: OpenItemsMutationEnvironment,
  request: ActivateOpenItemRequest,
): OpenItemsOutcome {
  const workspace = new OpenItemsWorkspace(state, env);
  const premise = request.item;
  const existing = workspace.find(premise);
  const open = existing !== undefined && existing.removedAt === null;

  if (existing && open) {
    // Route hydration can temporarily supply no ancestors or only part of them.
    // Keep the known branch until activation has at least as much ancestry.
    const refreshLineage =
      request.lineage.length > 0 &&
      request.lineage.length >= existing.lineage.length;
    const lineage = refreshLineage ? request.lineage : existing.lineage;
    const presentation =
      refreshLineage || !existing.presentation.routeParams?.lineageKinds
        ? request.presentation
        : {
            ...request.presentation,
            routeParams: {
              ...request.presentation.routeParams,
              lineageKinds: existing.presentation.routeParams.lineageKinds,
            },
          };

    if (
      sameLineage(existing.lineage, lineage) &&
      samePresentation(existing.presentation, presentation)
    ) {
      env.log(
        `Activation of open ${identityKey(premise)} is unchanged; collection revision stays ${state.revision}`,
      );
      return workspace.unchangedResult([existing]);
    }
    env.log(
      `Activation refreshes lineage/presentation of ${identityKey(premise)}`,
    );
    workspace.touchItem(existing, {
      lineage,
      presentation,
    });
    return workspace.mutationResult([existing], []);
  }

  const openItems = workspace.openItems();
  if (openItems.length >= MAX_OPEN_ITEMS) {
    env.log(`Activation rejected: collection holds ${openItems.length} items`);
    throw OpenItemsValidationException.of(
      'COLLECTION_LIMIT_EXCEEDED',
      `A collection holds at most ${MAX_OPEN_ITEMS} open items.`,
      [{ path: '/item', message: 'would exceed the open item limit' }],
    );
  }
  const position = appendKey(openItems.map((item) => item.position));
  const fresh = {
    note: null,
    pinned: false,
    position,
    groupId: null,
    memberPosition: null,
    lineage: request.lineage,
    presentation: request.presentation,
    removedAt: null,
  };
  if (existing) {
    env.log(`Activation revives removed ${identityKey(premise)}`);
    workspace.touchItem(existing, fresh);
    inheritAncestorGroup(workspace, existing);
    return workspace.mutationResult([...workspace.changes.items.values()], []);
  }
  env.log(`Activation inserts ${identityKey(premise)}`);
  const inserted = workspace.insertItem({
    entityType: premise.entityType,
    entityId: premise.entityId,
    goalTrackedWorkFilter: 'ACTIVE_AND_BACKLOG',
    goalCollapsed: true,
    ...fresh,
  });
  inheritAncestorGroup(workspace, inserted);
  return workspace.mutationResult([...workspace.changes.items.values()], []);
}

export function setOpenItemNote(
  state: OpenItemsState,
  env: OpenItemsMutationEnvironment,
  ref: OpenItemRef,
  request: SetOpenItemNoteRequest,
): OpenItemsOutcome {
  const workspace = new OpenItemsWorkspace(state, env);
  const item = findOpenItem(workspace, ref);
  if (!item) return workspace.unchangedResult([]);
  workspace.touchItem(item, { note: normalizeNote(request.note) });
  env.log(
    `Note ${item.note === null ? 'cleared' : 'set'} on ${identityKey(ref)}`,
  );
  return workspace.mutationResult([item], []);
}

export function setOpenItemPin(
  state: OpenItemsState,
  env: OpenItemsMutationEnvironment,
  ref: OpenItemRef,
  request: SetOpenItemPinRequest,
): OpenItemsOutcome {
  const workspace = new OpenItemsWorkspace(state, env);
  const item = findOpenItem(workspace, ref);
  if (!item) return workspace.unchangedResult([]);
  workspace.touchItem(item, { pinned: request.pinned });
  env.log(`Pin=${request.pinned} on ${identityKey(ref)}`);
  return workspace.mutationResult([item], []);
}

export function setOpenItemGoalFilter(
  state: OpenItemsState,
  env: OpenItemsMutationEnvironment,
  ref: OpenItemRef,
  request: SetOpenItemGoalFilterRequest,
): OpenItemsOutcome {
  const workspace = new OpenItemsWorkspace(state, env);
  const item = findOpenItem(workspace, ref);
  if (!item) return workspace.unchangedResult([]);
  workspace.touchItem(item, { goalTrackedWorkFilter: request.filter });
  return workspace.mutationResult([item], []);
}

export function setOpenItemGoalDisclosure(
  state: OpenItemsState,
  env: OpenItemsMutationEnvironment,
  ref: OpenItemRef,
  request: SetOpenItemGoalDisclosureRequest,
): OpenItemsOutcome {
  const workspace = new OpenItemsWorkspace(state, env);
  const item = findOpenItem(workspace, ref);
  if (!item) return workspace.unchangedResult([]);
  workspace.touchItem(item, { goalCollapsed: request.collapsed });
  return workspace.mutationResult([item], []);
}

/** Publishes promotion against current collection state in one revision. */
export function publishGroupPromotion(
  state: OpenItemsState,
  env: OpenItemsMutationEnvironment,
  groupId: string,
  goal: OpenItemRef,
  goalName: string,
  tracked: OpenItemRef[],
): Extract<OpenItemsOutcome, { kind: 'collection' }> {
  const workspace = new OpenItemsWorkspace(state, env);
  const group = workspace.group(groupId);
  if (!group) {
    throw OpenItemsValidationException.of(
      'GROUP_NOT_FOUND',
      'The group no longer exists.',
      [{ path: '/groupId', message: 'must identify an existing group' }],
    );
  }
  const trackedKeys = new Set(tracked.map(identityKey));
  const remainingCount = workspace
    .openItems()
    .filter(
      (item) => item.groupId !== groupId || !trackedKeys.has(identityKey(item)),
    ).length;
  if (!workspace.find(goal) && remainingCount >= MAX_OPEN_ITEMS) {
    throw OpenItemsValidationException.of(
      'COLLECTION_LIMIT_EXCEEDED',
      'Promotion would exceed the open item limit.',
      [{ path: '/groupId', message: 'would exceed the open item limit' }],
    );
  }
  for (const member of workspace.members(groupId)) {
    workspace.touchItem(member, {
      groupId: null,
      memberPosition: null,
      ...(trackedKeys.has(identityKey(member)) ? { removedAt: env.now } : {}),
    });
  }
  workspace.deleteGroup(group);
  const existing = workspace.find(goal);
  const goalData = {
    note: null,
    pinned: true,
    position: group.position,
    groupId: null,
    memberPosition: null,
    lineage: [],
    presentation: { label: goalName, workItemTypeKey: 'GOAL' },
    removedAt: null,
  };
  if (existing) {
    workspace.touchItem(existing, goalData);
  } else {
    workspace.insertItem({
      ...goal,
      ...goalData,
      goalTrackedWorkFilter: 'ACTIVE_AND_BACKLOG',
      goalCollapsed: true,
    });
  }
  return workspace.collectionResult();
}

export function moveOpenItem(
  state: OpenItemsState,
  env: OpenItemsMutationEnvironment,
  ref: OpenItemRef,
  request: MoveOpenItemRequest,
): OpenItemsOutcome {
  const workspace = new OpenItemsWorkspace(state, env);
  const item = workspace.find(ref);
  if (!item || item.removedAt !== null) {
    return workspace.unchangedResult([]);
  }
  let anchor: OpenItemRow | null = null;
  if (request.after !== null) {
    const after = workspace.find(request.after);
    if (!after || after.removedAt !== null)
      return workspace.unchangedResult([]);
    if (after.id === item.id) {
      throw invalidPlacement('/after', 'must identify another open item');
    }
    anchor = after;
  }
  const before = new Map(
    workspace.openItems().map((row) => [row.id, row.position]),
  );
  place(
    workspace,
    workspace.openItems(),
    item,
    anchor,
    (row) => row.position,
    (row, key) => {
      row.position = key;
    },
  );
  const moved = workspace
    .openItems()
    .filter((row) => before.get(row.id) !== row.position);
  for (const row of moved) workspace.touchItem(row, {});
  env.log(`Moved ${identityKey(ref)}; ${moved.length} row(s) rewritten`);
  return workspace.mutationResult(moved.length > 0 ? moved : [item], []);
}

export function removeOpenItem(
  state: OpenItemsState,
  env: OpenItemsMutationEnvironment,
  ref: OpenItemRef,
  request: RemoveOpenItemRequest,
): OpenItemsOutcome {
  const workspace = new OpenItemsWorkspace(state, env);
  const removed = removeOpenItemFromWorkspace(
    workspace,
    env,
    ref,
    request.includeDescendants,
  );
  return removed.length > 0
    ? workspace.mutationResult(removed, [])
    : workspace.unchangedResult([]);
}

export function removeOpenItems(
  state: OpenItemsState,
  env: OpenItemsMutationEnvironment,
  request: RemoveOpenItemsRequest,
): OpenItemsOutcome {
  const workspace = new OpenItemsWorkspace(state, env);
  const removed: OpenItemRow[] = [];
  for (const ref of request.items) {
    removed.push(
      ...removeOpenItemFromWorkspace(
        workspace,
        env,
        ref,
        request.includeDescendants,
      ),
    );
  }
  return removed.length > 0
    ? workspace.mutationResult(removed, [])
    : workspace.unchangedResult([]);
}

function removeOpenItemFromWorkspace(
  workspace: OpenItemsWorkspace,
  env: OpenItemsMutationEnvironment,
  ref: OpenItemRef,
  includeDescendants: boolean,
): OpenItemRow[] {
  const item = findOpenItem(workspace, ref);
  if (!item) return [];
  const descendants = includeDescendants
    ? workspace.openDescendants([item])
    : [];
  const removable = descendants.filter((descendant) =>
    removableDescendant(item, descendant),
  );
  env.log(
    `Removing ${identityKey(ref)} with ${removable.length} descendant(s); retaining ${descendants.length - removable.length} pinned or different-group`,
  );
  const removed = [item, ...removable];
  for (const row of removed) {
    workspace.touchItem(row, {
      removedAt: env.now,
      groupId: null,
      memberPosition: null,
    });
  }
  return removed;
}

export function createOpenItemGroup(
  state: OpenItemsState,
  env: OpenItemsMutationEnvironment,
  request: CreateOpenItemGroupRequest,
): OpenItemsOutcome {
  const workspace = new OpenItemsWorkspace(state, env);
  const name = normalizeGroupName(request.name, '/name');
  const groups = workspace.allGroups();
  if (groups.length >= MAX_OPEN_ITEM_GROUPS) {
    env.log(`Group creation rejected: ${groups.length} groups exist`);
    throw OpenItemsValidationException.of(
      'COLLECTION_LIMIT_EXCEEDED',
      `A collection holds at most ${MAX_OPEN_ITEM_GROUPS} groups.`,
      [{ path: '/name', message: 'would exceed the group limit' }],
    );
  }
  const selected = request.assign
    ? openSelection(workspace, request.assign)
    : [];
  const group = workspace.insertGroup({
    name,
    collapsed: request.collapsed ?? false,
    position: appendKey(groups.map((row) => row.position)),
  });
  env.log(`Created group ${group.id}`);
  const affected =
    selected.length > 0 ? assignToGroup(workspace, group, selected) : [];
  return workspace.mutationResult(affected, [group]);
}

export function renameOpenItemGroup(
  state: OpenItemsState,
  env: OpenItemsMutationEnvironment,
  groupId: string,
  request: RenameOpenItemGroupRequest,
): OpenItemsOutcome {
  const workspace = new OpenItemsWorkspace(state, env);
  const group = workspace.group(groupId);
  if (!group) return workspace.unchangedResult([]);
  workspace.touchGroup(group, {
    name: normalizeGroupName(request.name, '/name'),
  });
  env.log(`Renamed group ${groupId}`);
  return workspace.mutationResult([], [group]);
}

export function setOpenItemGroupDisclosure(
  state: OpenItemsState,
  env: OpenItemsMutationEnvironment,
  groupId: string,
  request: SetOpenItemGroupDisclosureRequest,
): OpenItemsOutcome {
  const workspace = new OpenItemsWorkspace(state, env);
  const group = workspace.group(groupId);
  if (!group) return workspace.unchangedResult([]);
  workspace.touchGroup(group, { collapsed: request.collapsed });
  env.log(`Group ${groupId} collapsed=${request.collapsed}`);
  return workspace.mutationResult([], [group]);
}

export function deleteOpenItemGroup(
  state: OpenItemsState,
  env: OpenItemsMutationEnvironment,
  groupId: string,
  request: DeleteOpenItemGroupRequest,
): OpenItemsOutcome {
  const workspace = new OpenItemsWorkspace(state, env);
  const group = workspace.group(groupId);
  if (!group) return workspace.unchangedResult([]);
  const members = workspace.members(groupId);
  for (const member of members) {
    workspace.touchItem(member, { groupId: null, memberPosition: null });
  }
  workspace.deleteGroup(group);
  env.log(`Deleted group ${groupId}; ungrouped ${members.length} member(s)`);
  return workspace.mutationResult(members, []);
}

export function moveOpenItemGroup(
  state: OpenItemsState,
  env: OpenItemsMutationEnvironment,
  groupId: string,
  request: MoveOpenItemGroupRequest,
): OpenItemsOutcome {
  const workspace = new OpenItemsWorkspace(state, env);
  const group = workspace.group(groupId);
  if (!group) return workspace.unchangedResult([]);
  let anchor: OpenItemGroupRow | null = null;
  if (request.afterGroupId !== null) {
    const after = workspace.group(request.afterGroupId);
    if (!after) return workspace.unchangedResult([]);
    if (after.id === group.id) {
      throw invalidPlacement('/afterGroupId', 'must identify another group');
    }
    anchor = after;
  }
  const ordered = workspace.allGroups();
  const before = new Map(ordered.map((row) => [row.id, row.position]));
  place(
    workspace,
    ordered,
    group,
    anchor,
    (row) => row.position,
    (row, key) => {
      row.position = key;
    },
  );
  const moved = ordered.filter((row) => before.get(row.id) !== row.position);
  for (const row of moved) workspace.touchGroup(row, {});
  env.log(`Moved group ${groupId}; ${moved.length} row(s) rewritten`);
  return workspace.mutationResult([], moved.length > 0 ? moved : [group]);
}

export function assignOpenItemsToGroup(
  state: OpenItemsState,
  env: OpenItemsMutationEnvironment,
  groupId: string,
  request: AssignOpenItemsToGroupRequest,
): OpenItemsOutcome {
  const workspace = new OpenItemsWorkspace(state, env);
  const group = workspace.group(groupId);
  if (!group) return workspace.unchangedResult([]);
  const selected = openSelection(workspace, request.items);
  if (selected.length === 0) return workspace.unchangedResult([]);
  const affected = assignToGroup(workspace, group, selected);
  return workspace.mutationResult(affected, [group]);
}

export function ungroupOpenItems(
  state: OpenItemsState,
  env: OpenItemsMutationEnvironment,
  request: UngroupOpenItemsRequest,
): OpenItemsOutcome {
  const workspace = new OpenItemsWorkspace(state, env);
  const selected = openSelection(workspace, request.items);
  if (selected.length === 0) return workspace.unchangedResult([]);
  const groups = new Map<string, OpenItemGroupRow>();
  for (const item of selected) {
    if (item.groupId === null) continue;
    const group = workspace.group(item.groupId);
    if (group) groups.set(group.id, group);
    workspace.touchItem(item, { groupId: null, memberPosition: null });
  }
  env.log(`Ungrouped ${selected.length} item(s) from ${groups.size} group(s)`);
  return workspace.mutationResult(selected, [...groups.values()]);
}

export function moveOpenItemGroupMember(
  state: OpenItemsState,
  env: OpenItemsMutationEnvironment,
  groupId: string,
  ref: OpenItemRef,
  request: MoveOpenItemGroupMemberRequest,
): OpenItemsOutcome {
  const workspace = new OpenItemsWorkspace(state, env);
  const group = workspace.group(groupId);
  if (!group) return workspace.unchangedResult([]);
  const item = workspace.find(ref);
  if (!item || item.removedAt !== null || item.groupId !== groupId) {
    return workspace.unchangedResult([]);
  }
  let anchor: OpenItemRow | null = null;
  if (request.after !== null) {
    const after = workspace.find(request.after);
    if (!after || after.removedAt !== null || after.groupId !== groupId)
      return workspace.unchangedResult([]);
    if (after.id === item.id) {
      throw invalidPlacement(
        '/after',
        'must identify another member of the same group',
      );
    }
    anchor = after;
  }
  const members = workspace.members(groupId);
  const before = new Map(members.map((row) => [row.id, row.memberPosition]));
  place(
    workspace,
    members,
    item,
    anchor,
    (row) => row.memberPosition ?? '',
    (row, key) => {
      row.memberPosition = key;
    },
  );
  const moved = members.filter(
    (row) => before.get(row.id) !== row.memberPosition,
  );
  for (const row of moved) workspace.touchItem(row, {});
  env.log(`Moved member ${identityKey(ref)} in group ${groupId}`);
  return workspace.mutationResult(moved.length > 0 ? moved : [item], [group]);
}

/** Import into a collection that the caller has just created (was ABSENT). */
export function migrateOpenItems(
  state: OpenItemsState,
  env: OpenItemsMutationEnvironment,
  request: MigrateOpenItemsRequest,
): OpenItemsOutcome {
  const workspace = new OpenItemsWorkspace(state, env);
  const violations: { path: string; message: string }[] = [];

  const localGroups = new Map<string, number>();
  request.groups.forEach((group, index) => {
    if (localGroups.has(group.localGroupId)) {
      violations.push({
        path: `/groups/${index}/localGroupId`,
        message: 'duplicates an earlier group',
      });
    }
    localGroups.set(group.localGroupId, index);
  });
  request.items.forEach((item, index) => {
    if (item.localGroupId !== null && !localGroups.has(item.localGroupId)) {
      violations.push({
        path: `/items/${index}/localGroupId`,
        message: 'does not resolve to a group in this payload',
      });
    }
  });
  if (violations.length > 0) {
    env.log(`Migration membership invalid: ${violations.length} violation(s)`);
    throw OpenItemsValidationException.of(
      'INVALID_MIGRATION_MEMBERSHIP',
      'Migrated group membership does not resolve within the payload.',
      violations,
    );
  }

  const seen = new Set<string>();
  request.items.forEach((item, index) => {
    const key = identityKey(item);
    if (seen.has(key)) {
      violations.push({
        path: `/items/${index}`,
        message: 'duplicates an earlier item identity',
      });
    }
    seen.add(key);
  });
  if (violations.length > 0) {
    env.log(`Migration items invalid: ${violations.length} duplicate(s)`);
    throw OpenItemsValidationException.of(
      'INVALID_REQUEST',
      'Migrated items must have unique identities.',
      violations,
    );
  }

  const groupKeys = evenlySpacedPositionKeys(request.groups.length);
  const groupIds = new Map<string, string>();
  request.groups.forEach((group, index) => {
    const row = workspace.insertGroup({
      name: normalizeGroupName(group.name, `/groups/${index}/name`),
      collapsed: group.collapsed,
      position: groupKeys[index] as string,
    });
    groupIds.set(group.localGroupId, row.id);
  });

  const memberCounts = new Map<string, number>();
  for (const item of request.items) {
    if (item.localGroupId !== null) {
      memberCounts.set(
        item.localGroupId,
        (memberCounts.get(item.localGroupId) ?? 0) + 1,
      );
    }
  }
  const memberKeys = new Map(
    [...memberCounts].map(([localGroupId, count]) => [
      localGroupId,
      evenlySpacedPositionKeys(count),
    ]),
  );
  const itemKeys = evenlySpacedPositionKeys(request.items.length);
  request.items.forEach((item, index) => {
    workspace.insertItem({
      entityType: item.entityType,
      entityId: item.entityId,
      goalTrackedWorkFilter: 'ACTIVE_AND_BACKLOG',
      goalCollapsed: true,
      note: normalizeNote(item.note),
      pinned: item.pinned,
      position: itemKeys[index] as string,
      groupId:
        item.localGroupId === null
          ? null
          : (groupIds.get(item.localGroupId) ?? null),
      memberPosition:
        item.localGroupId === null
          ? null
          : (memberKeys.get(item.localGroupId)?.shift() ?? null),
      lineage: item.lineage,
      presentation: item.presentation,
      removedAt: null,
    });
  });
  env.log(
    `Migrated ${request.items.length} item(s) and ${request.groups.length} group(s) from source schema v${request.sourceSchemaVersion}`,
  );
  return workspace.collectionResult();
}

/** Clears every item and group, leaving an intentionally empty collection. */
export function resetOpenItems(
  state: OpenItemsState,
  env: OpenItemsMutationEnvironment,
  _request: ResetOpenItemsRequest,
  _collectionWasAbsent: boolean,
): OpenItemsOutcome {
  const workspace = new OpenItemsWorkspace(state, env);
  env.log(
    `Reset clears ${state.items.length} item row(s) and ${state.groups.length} group(s)`,
  );
  workspace.clear();
  return workspace.collectionResult();
}
