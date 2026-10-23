import type {
  WorkItemChangeSetIdentity,
  WorkItemChangeSetValidationRequest,
} from 'src/generated';
import {
  nodeKey,
  relKey,
  type NodeKey,
  type ProjectionState,
  type RelKey,
} from './projection-state';

export interface RequestFacts {
  /** Rules that report by operation index or field path read it from here. */
  request: WorkItemChangeSetValidationRequest;
  root: NodeKey;
  creates: { node: NodeKey; type: string; parent: NodeKey | null }[];
  updates: {
    node: NodeKey;
    fields: string[];
    parentChange?: { from: NodeKey | null; to: NodeKey | null };
  }[];
  deletes: { node: NodeKey; parent: NodeKey | null }[];
  sectionWrites: { node: NodeKey; key: string; kind: 'replace' | 'clear' }[];
  relationshipOps: {
    op: 'create' | 'update' | 'delete';
    ref: RelKey;
    edgeType?: string;
    source?: NodeKey;
    target?: NodeKey;
  }[];
  layoutOps: { op: 'replace' | 'clear'; root: NodeKey }[];
  hasLayoutBoundary: boolean;
  serviceRefs: { node: NodeKey; serviceIds: string[] }[];
  typeOf(node: NodeKey): string | undefined;
  parentOf(node: NodeKey): NodeKey | null | undefined;
  parentTypeOf(node: NodeKey): string | null | undefined;
  sectionContentOf(node: NodeKey, key: string): unknown;
}

/** Existing work-item ids the request names directly; the facts phase hydrates these. */
export function namedExistingIds(
  request: WorkItemChangeSetValidationRequest,
): string[] {
  const ids = new Set<string>();
  const visit = (identity: WorkItemChangeSetIdentity | null | undefined) => {
    if (identity?.refType === 'existing') ids.add(identity.id);
  };
  visit(request.root);
  for (const boundary of request.layoutBoundary ?? []) visit(boundary);
  for (const operation of request.operations) {
    switch (operation.op) {
      case 'workItem.create':
        visit(operation.parent);
        break;
      case 'workItem.update':
        visit(operation.ref);
        visit(operation.parent);
        break;
      case 'workItem.delete':
      case 'section.replace':
      case 'section.clear':
        visit(operation.ref);
        break;
      case 'relationship.create':
      case 'relationship.update':
        visit(operation.source);
        visit(operation.target);
        break;
      case 'layout.replace':
        visit(operation.root);
        operation.entries.forEach((entry) => visit(entry.node));
        break;
      case 'layout.clear':
        visit(operation.root);
        break;
      case 'relationship.delete':
        break;
    }
  }
  return [...ids].sort();
}

/** The parent `of` has once the request applies, preferring a reparent. */
export function projectedParentOf(
  facts: RequestFacts,
  of: NodeKey,
): NodeKey | null | undefined {
  const update = facts.updates.find(
    (candidate) => candidate.node === of && candidate.parentChange,
  );
  return update?.parentChange ? update.parentChange.to : facts.parentOf(of);
}

/**
 * Derived after the facts phase has hydrated directly named items and before
 * any operation is applied, so `typeOf`/`parentOf` describe stored state for
 * existing nodes and the declared values for created ones. Parent types
 * describe the effective parent, including creates and reparenting.
 */
export function deriveRequestFacts(
  request: WorkItemChangeSetValidationRequest,
  state: ProjectionState,
  storedParentTypes: ReadonlyMap<NodeKey, string | null> = new Map(),
): RequestFacts {
  const facts: Omit<
    RequestFacts,
    'typeOf' | 'parentOf' | 'parentTypeOf' | 'sectionContentOf'
  > = {
    request,
    root: nodeKey(request.root),
    creates: [],
    updates: [],
    deletes: [],
    sectionWrites: [],
    relationshipOps: [],
    layoutOps: [],
    hasLayoutBoundary: (request.layoutBoundary?.length ?? 0) > 0,
    serviceRefs: [],
  };
  const createdTypes = new Map<NodeKey, string>();
  const createdParents = new Map<NodeKey, NodeKey | null>();
  const storedParent = (key: NodeKey): NodeKey | null | undefined => {
    const node = state.nodes.get(key);
    if (!node) return undefined;
    return node.parent ? nodeKey(node.parent) : null;
  };

  for (const operation of request.operations) {
    switch (operation.op) {
      case 'workItem.create': {
        const key = nodeKey(operation.ref);
        const type = operation.type ?? 'STANDARD';
        const parent = operation.parent ? nodeKey(operation.parent) : null;
        createdTypes.set(key, type);
        createdParents.set(key, parent);
        facts.creates.push({ node: key, type, parent });
        if (operation.serviceIds !== undefined)
          facts.serviceRefs.push({
            node: key,
            serviceIds: [...operation.serviceIds],
          });
        break;
      }
      case 'workItem.update': {
        const key = nodeKey(operation.ref);
        const fields = Object.keys(operation)
          .filter((field) => field !== 'op' && field !== 'ref')
          .sort();
        facts.updates.push({
          node: key,
          fields,
          ...(Object.prototype.hasOwnProperty.call(operation, 'parent')
            ? {
                parentChange: {
                  from: storedParent(key) ?? null,
                  to: operation.parent ? nodeKey(operation.parent) : null,
                },
              }
            : {}),
        });
        if (operation.serviceIds !== undefined)
          facts.serviceRefs.push({
            node: key,
            serviceIds: [...operation.serviceIds],
          });
        break;
      }
      case 'workItem.delete': {
        const key = nodeKey(operation.ref);
        facts.deletes.push({ node: key, parent: storedParent(key) ?? null });
        break;
      }
      case 'section.replace':
      case 'section.clear':
        facts.sectionWrites.push({
          node: nodeKey(operation.ref),
          key: operation.key,
          kind: operation.op === 'section.replace' ? 'replace' : 'clear',
        });
        break;
      case 'relationship.create':
        facts.relationshipOps.push({
          op: 'create',
          ref: relKey(operation.ref),
          edgeType: operation.edgeType,
          source: nodeKey(operation.source),
          target: nodeKey(operation.target),
        });
        break;
      case 'relationship.update':
        facts.relationshipOps.push({
          op: 'update',
          ref: relKey(operation.ref),
          ...(operation.edgeType ? { edgeType: operation.edgeType } : {}),
          ...(operation.source ? { source: nodeKey(operation.source) } : {}),
          ...(operation.target ? { target: nodeKey(operation.target) } : {}),
        });
        break;
      case 'relationship.delete':
        facts.relationshipOps.push({
          op: 'delete',
          ref: relKey(operation.ref),
        });
        break;
      case 'layout.replace':
      case 'layout.clear':
        facts.layoutOps.push({
          op: operation.op === 'layout.replace' ? 'replace' : 'clear',
          root: nodeKey(operation.root),
        });
        break;
    }
  }

  const typeOf = (key: NodeKey) =>
    createdTypes.get(key) ?? state.nodes.get(key)?.type;
  return {
    ...facts,
    typeOf,
    parentTypeOf: (key) => {
      const reparent = facts.updates.find(
        (update) => update.node === key && update.parentChange,
      );
      if (reparent?.parentChange) {
        const parent = reparent.parentChange.to;
        return parent ? typeOf(parent) : null;
      }
      if (createdParents.has(key)) {
        const parent = createdParents.get(key);
        return parent ? typeOf(parent) : null;
      }
      if (storedParentTypes.has(key)) return storedParentTypes.get(key);
      // Overlay-only nodes have no joined database fact, but their parent may
      // already be present in the projection supplied by grouped proposals.
      const parent = storedParent(key);
      return parent === undefined ? undefined : parent ? typeOf(parent) : null;
    },
    sectionContentOf: (node, key) => {
      const content: unknown = state.nodes
        .get(node)
        ?.sections.find((section) => section.key === key)?.content;
      return content;
    },
    parentOf: (key) =>
      createdParents.has(key) ? createdParents.get(key) : storedParent(key),
  };
}
