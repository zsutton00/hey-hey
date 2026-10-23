import type {
  WorkItemChangeSetIdentity,
  WorkItemChangeSetRelationshipIdentity,
  WorkItemChangeSetValidationRequest,
} from 'src/generated';
import {
  siblingsKey,
  type Load,
  type LoadedData,
  type ProjectionRule,
} from '../projection-rule';
import {
  existingId,
  nodeKey,
  relKey,
  type IssueLayer,
  type NodeKey,
  type ProjectionState,
} from '../projection-state';
import { projectedParentOf, type RequestFacts } from '../request-facts';

const STRUCTURAL: IssueLayer = 'structural';
const REFERENTIAL: IssueLayer = 'referential';

type BoundaryScope = { request: WorkItemChangeSetValidationRequest };

/** Work-item refs whose membership in the root's graph is checked. */
function boundaryRefs(
  request: WorkItemChangeSetValidationRequest,
): WorkItemChangeSetIdentity[] {
  const refs: WorkItemChangeSetIdentity[] = [
    request.root,
    ...(request.layoutBoundary ?? []),
  ];
  for (const operation of request.operations) {
    switch (operation.op) {
      case 'workItem.create':
      case 'workItem.update':
      case 'workItem.delete':
      case 'section.replace':
      case 'section.clear':
        refs.push(operation.ref);
        break;
      case 'layout.replace':
        refs.push(
          operation.root,
          ...operation.entries.map((entry) => entry.node),
        );
        break;
      case 'layout.clear':
        refs.push(operation.root);
        break;
      default:
        break;
    }
  }
  return refs;
}

/**
 * The first existing node on `key`'s projected parent path, unless that path
 * reaches the root (or ends) without leaving known state.
 */
function ancestorLoadTarget(
  facts: RequestFacts,
  key: NodeKey,
): NodeKey | undefined {
  const seen = new Set<NodeKey>();
  let current: NodeKey | null | undefined = key;
  while (current && current !== facts.root && !seen.has(current)) {
    seen.add(current);
    const parent = projectedParentOf(facts, current);
    if (existingId(current) !== undefined)
      return parent && parent !== facts.root ? current : undefined;
    current = parent;
  }
  return undefined;
}

/**
 * Walks projected parents, falling back to loaded ancestor chains for nodes
 * the projection does not hold.
 */
function isInRootGraph(
  state: ProjectionState,
  loaded: LoadedData,
  root: NodeKey,
  key: NodeKey,
): boolean {
  const chainParents = new Map<NodeKey, NodeKey | null>();
  for (const chain of loaded.ancestors.values()) {
    for (const skeleton of chain) {
      const skeletonKey = skeleton.id.startsWith('temporary:')
        ? skeleton.id
        : `existing:${skeleton.id}`;
      chainParents.set(skeletonKey, skeleton.parent);
    }
  }
  const seen = new Set<NodeKey>();
  let current: NodeKey | null | undefined = key;
  while (current && !seen.has(current)) {
    if (current === root) return true;
    seen.add(current);
    const node = state.nodes.get(current);
    current = node
      ? node.parent
        ? nodeKey(node.parent)
        : null
      : chainParents.get(current);
  }
  return false;
}

/**
 * Persisted identities are authoritative; names are only collision
 * guardrails. Graph membership comes from projected parents plus the ancestor
 * chains of refs whose path to the root leaves the request.
 */
export const identityBoundaryRule: ProjectionRule<BoundaryScope> = {
  id: 'identity.boundary',
  appliesTo: (facts) => ({ request: facts.request }),
  loads(scope, facts) {
    const targets = new Set<NodeKey>();
    for (const ref of boundaryRefs(scope.request)) {
      const target = ancestorLoadTarget(facts, nodeKey(ref));
      if (target) targets.add(target);
    }
    return [...targets].map((of): Load => ({ kind: 'ancestorsToRoot', of }));
  },
  check(state, { request }, ctx) {
    const rootKey = nodeKey(request.root);
    const temporaryWorkItemCreates = new Set(
      request.operations.flatMap((operation) =>
        operation.op === 'workItem.create' ? [nodeKey(operation.ref)] : [],
      ),
    );
    const temporaryRelationshipCreates = new Set(
      request.operations.flatMap((operation) =>
        operation.op === 'relationship.create' ? [relKey(operation.ref)] : [],
      ),
    );

    const validateWorkItemReference = (
      identity: WorkItemChangeSetIdentity | null | undefined,
      field: string,
      options: { allowOutsideRoot?: boolean } = {},
    ): void => {
      if (!identity) return;
      const key = nodeKey(identity);
      if (
        identity.refType === 'temporary' &&
        !temporaryWorkItemCreates.has(key)
      ) {
        ctx.addIssue(
          field,
          'unresolved_reference',
          `Temporary work-item reference ${key} must be declared by a workItem.create operation in this change set.`,
          REFERENTIAL,
        );
        return;
      }
      if (!state.nodes.has(key)) {
        ctx.addIssue(
          field,
          'dangling_reference',
          `Work-item reference ${key} does not resolve.`,
          REFERENTIAL,
        );
        return;
      }
      if (
        !options.allowOutsideRoot &&
        !isInRootGraph(state, ctx.loaded, rootKey, key)
      ) {
        ctx.addIssue(
          field,
          'cross_root_reference',
          `Work-item reference ${key} is outside the target graph root.`,
          REFERENTIAL,
        );
      }
    };

    const validateRelationshipReference = (
      identity: WorkItemChangeSetRelationshipIdentity,
      field: string,
    ): void => {
      const key = relKey(identity);
      if (
        identity.refType === 'temporary' &&
        !temporaryRelationshipCreates.has(key)
      ) {
        ctx.addIssue(
          field,
          'unresolved_reference',
          `Temporary relationship reference ${key} must be declared by a relationship.create operation in this change set.`,
          REFERENTIAL,
        );
        return;
      }
      if (!state.relationships.has(key)) {
        ctx.addIssue(
          field,
          'dangling_reference',
          `Relationship reference ${key} does not resolve.`,
          REFERENTIAL,
        );
      }
    };

    const validateLayoutRoot = (
      root: WorkItemChangeSetIdentity,
      field: string,
    ): void => {
      validateWorkItemReference(root, field);
      if (nodeKey(root) !== rootKey) {
        ctx.addIssue(
          field,
          'cross_root_reference',
          'Layout operations must target the requested graph root.',
          REFERENTIAL,
        );
      }
    };

    validateWorkItemReference(request.root, 'root');
    for (const [index, identity] of (request.layoutBoundary ?? []).entries()) {
      validateWorkItemReference(identity, `layoutBoundary[${index}]`);
    }

    for (const [operationIndex, operation] of request.operations.entries()) {
      const field = `operations[${operationIndex}]`;
      switch (operation.op) {
        case 'workItem.create':
        case 'workItem.update':
          validateWorkItemReference(operation.ref, `${field}.ref`);
          validateWorkItemReference(operation.parent, `${field}.parent`, {
            allowOutsideRoot: true,
          });
          break;
        case 'workItem.delete':
        case 'section.replace':
        case 'section.clear':
          validateWorkItemReference(operation.ref, `${field}.ref`);
          break;
        case 'relationship.create':
        case 'relationship.update':
          validateRelationshipReference(operation.ref, `${field}.ref`);
          validateWorkItemReference(operation.source, `${field}.source`, {
            allowOutsideRoot: true,
          });
          validateWorkItemReference(operation.target, `${field}.target`, {
            allowOutsideRoot: true,
          });
          break;
        case 'relationship.delete':
          validateRelationshipReference(operation.ref, `${field}.ref`);
          break;
        case 'layout.replace':
          validateLayoutRoot(operation.root, `${field}.root`);
          for (const [entryIndex, entry] of operation.entries.entries()) {
            validateWorkItemReference(
              entry.node,
              `${field}.entries[${entryIndex}].node`,
            );
          }
          break;
        case 'layout.clear':
          validateLayoutRoot(operation.root, `${field}.root`);
          break;
      }
    }
  },
};

export const layoutIdentityUniqueRule: ProjectionRule<BoundaryScope> = {
  id: 'layout.identityUnique',
  appliesTo: (facts) =>
    facts.hasLayoutBoundary ||
    facts.layoutOps.some((operation) => operation.op === 'replace')
      ? { request: facts.request }
      : null,
  loads: () => [],
  check(_state, { request }, ctx) {
    const seenBoundary = new Set<string>();
    for (const [index, identity] of (request.layoutBoundary ?? []).entries()) {
      const key = nodeKey(identity);
      if (seenBoundary.has(key)) {
        ctx.addIssue(
          `layoutBoundary[${index}]`,
          'duplicate_layout_reference',
          `Layout boundary identity ${key} appears more than once.`,
          STRUCTURAL,
        );
      }
      seenBoundary.add(key);
    }

    request.operations.forEach((operation, operationIndex) => {
      if (operation.op !== 'layout.replace') return;
      const seenEntries = new Set<string>();
      operation.entries.forEach((entry, entryIndex) => {
        const key = nodeKey(entry.node);
        if (seenEntries.has(key)) {
          ctx.addIssue(
            `operations[${operationIndex}].entries[${entryIndex}].node`,
            'duplicate_layout_entry',
            `Layout identity ${key} appears more than once in the replacement.`,
            STRUCTURAL,
          );
        }
        seenEntries.add(key);
      });
    });
  },
};

type NameCollisionScope = {
  creates: { index: number; node: NodeKey; parent: NodeKey; name: string }[];
  /** Nodes the request names, which may carry projected names or parents. */
  named: NodeKey[];
};

export const nameCollisionRule: ProjectionRule<NameCollisionScope> = {
  id: 'name.collision',
  appliesTo(facts) {
    const creates = facts.request.operations.flatMap((operation, index) =>
      operation.op === 'workItem.create'
        ? [
            {
              index,
              node: nodeKey(operation.ref),
              parent: nodeKey(operation.parent),
              name: operation.name,
            },
          ]
        : [],
    );
    if (creates.length === 0) return null;
    const named = new Set<NodeKey>([
      ...facts.creates.map(({ node }) => node),
      ...facts.updates.map(({ node }) => node),
    ]);
    return { creates, named: [...named] };
  },
  loads: (scope) =>
    scope.creates.flatMap(({ parent, name }): Load[] =>
      existingId(parent) !== undefined
        ? [{ kind: 'siblingsNamed', parent, name }]
        : [],
    ),
  check(state, scope, ctx) {
    for (const { index, node: createKey, parent, name } of scope.creates) {
      const candidates = new Set<NodeKey>([
        ...scope.named,
        ...ctx.findings.overlayNodes,
        ...(ctx.loaded.siblings.get(siblingsKey(parent, name)) ?? []),
      ]);
      const created = state.nodes.get(createKey);
      const collision = [...candidates].some((key) => {
        const node = state.nodes.get(key);
        return (
          key !== createKey &&
          node !== undefined &&
          !node.deleted &&
          node.type === created?.type &&
          node.name === name &&
          nodeKey(node.parent) === parent
        );
      });
      if (collision) {
        ctx.addWarning(
          `operations[${index}].name`,
          'work_item_name_collision',
          `A ${created?.type} named ${name} already exists under the requested parent.`,
          REFERENTIAL,
          'Rename the new item, reuse the existing item with an update, or continue if both are intended.',
        );
      }
    }
  },
};
