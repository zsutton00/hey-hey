import type {
  WorkItemChangeSetOperation,
  WorkItemCreateOperation,
  WorkItemUpdateOperation,
} from 'src/generated';
import {
  isWorkItemServiceScopeEligible,
  WORK_ITEM_SERVICE_SCOPE_INVALID_REASON,
} from '../../../tasks/work-item-service-scope-policy';
import type { ProjectionRule, RuleContext } from '../projection-rule';
import {
  nodeKey,
  relKey,
  type ApplyOutcome,
  type IssueLayer,
  type NodeKey,
  type ProjectionFindings,
} from '../projection-state';
import { namedExistingIds } from '../request-facts';

const STRUCTURAL: IssueLayer = 'structural';
const REFERENTIAL: IssueLayer = 'referential';

type OperationsScope = { operations: WorkItemChangeSetOperation[] };

function appliedOf<K extends ApplyOutcome['kind']>(
  ctx: RuleContext,
  kinds: readonly K[],
): Extract<ApplyOutcome, { kind: K }>[] {
  return ctx.findings.applied.filter(
    (outcome): outcome is Extract<ApplyOutcome, { kind: K }> =>
      (kinds as readonly string[]).includes(outcome.kind),
  );
}

export const requestTempRefsRule: ProjectionRule<OperationsScope> = {
  id: 'request.tempRefs',
  appliesTo: (facts) =>
    facts.creates.length > 0 ||
    facts.relationshipOps.some((operation) => operation.op === 'create')
      ? { operations: facts.request.operations }
      : null,
  loads: () => [],
  check(_state, scope, ctx) {
    const seenWorkItems = new Set<string>();
    const seenRelationships = new Set<string>();
    scope.operations.forEach((operation, index) => {
      if (operation.op === 'workItem.create') {
        const key = nodeKey(operation.ref);
        if (seenWorkItems.has(key)) {
          ctx.addIssue(
            `operations[${index}].ref.tempId`,
            'duplicate_temporary_reference',
            `Temporary work-item reference ${operation.ref.tempId} is declared more than once.`,
            STRUCTURAL,
          );
        }
        seenWorkItems.add(key);
      }
      if (operation.op === 'relationship.create') {
        const key = relKey(operation.ref);
        if (seenRelationships.has(key)) {
          ctx.addIssue(
            `operations[${index}].ref.tempId`,
            'duplicate_temporary_reference',
            `Temporary relationship reference ${operation.ref.tempId} is declared more than once.`,
            STRUCTURAL,
          );
        }
        seenRelationships.add(key);
      }
    });
  },
};

/** Reports ids a hydration pass did not find or cannot project. */
export function reportNamedReferences(
  findings: Pick<ProjectionFindings, 'namedMissing' | 'namedUnavailable'>,
  addIssue: RuleContext['addIssue'],
): void {
  for (const id of findings.namedMissing) {
    addIssue(
      `references.${id}`,
      'dangling_reference',
      `Existing work-item ${id} was not found in this project.`,
      REFERENTIAL,
    );
  }
  for (const { id, type } of findings.namedUnavailable) {
    addIssue(
      `references.${id}.type`,
      'unrecognized_type',
      `Work-item type ${type} is unavailable in this project.`,
      REFERENTIAL,
    );
  }
}

export const refExistenceRule: ProjectionRule<true> = {
  id: 'ref.existence',
  appliesTo: (facts) =>
    namedExistingIds(facts.request).length > 0 ? true : null,
  // The facts phase already hydrated every named id.
  loads: () => [],
  check(_state, _scope, ctx) {
    reportNamedReferences(ctx.findings, ctx.addIssue);
  },
};

export const opTypeAvailableRule: ProjectionRule<true> = {
  id: 'op.typeAvailable',
  // A create only meets an already-projected node when its ref is reused.
  appliesTo(facts) {
    const createCounts = new Map<NodeKey, number>();
    facts.creates.forEach(({ node }) =>
      createCounts.set(node, (createCounts.get(node) ?? 0) + 1),
    );
    return facts.request.operations.some(
      (operation) =>
        !operation.op.startsWith('relationship.') &&
        (operation.op !== 'workItem.create' ||
          (createCounts.get(nodeKey(operation.ref)) ?? 0) > 1),
    )
      ? true
      : null;
  },
  loads: () => [],
  check(_state, _scope, ctx) {
    for (const outcome of appliedOf(ctx, ['unavailableType'])) {
      ctx.addIssue(
        `operations[${outcome.index}].ref`,
        'unrecognized_type',
        `Work-item type ${outcome.type} is unavailable in this project.`,
        REFERENTIAL,
      );
    }
  },
};

export const opRefResolvesRule: ProjectionRule<true> = {
  id: 'op.refResolves',
  appliesTo: (facts) =>
    facts.request.operations.some(
      (operation) => operation.op !== 'workItem.create',
    )
      ? true
      : null,
  loads: () => [],
  check(_state, _scope, ctx) {
    for (const outcome of appliedOf(ctx, [
      'unresolvedNode',
      'unresolvedRelationship',
    ])) {
      ctx.addIssue(
        outcome.field,
        'dangling_reference',
        outcome.kind === 'unresolvedNode'
          ? `Work-item reference ${outcome.key} does not resolve.`
          : `Relationship reference ${outcome.key} does not resolve.`,
        REFERENTIAL,
      );
    }
  },
};

export const sectionClearRule: ProjectionRule<true> = {
  id: 'section.clear',
  appliesTo: (facts) =>
    facts.sectionWrites.some((write) => write.kind === 'clear') ? true : null,
  loads: () => [],
  check(_state, _scope, ctx) {
    for (const outcome of appliedOf(ctx, [
      'unsupportedSectionClear',
      'requirementsSectionClear',
    ])) {
      if (outcome.kind === 'unsupportedSectionClear') {
        ctx.addIssue(
          'section.clear.key',
          'unsupported_section',
          `${outcome.sectionKey} is not declared for ${outcome.type}.`,
          REFERENTIAL,
        );
      } else {
        ctx.addIssue(
          'section.clear.key',
          'invalid_feature_requirement_section',
          'FEATURE requirements must be replaced with a schema-backed JSON collection; use { records: [] } to empty it.',
          REFERENTIAL,
        );
      }
    }
  },
};

export const layoutSectionKeyRule: ProjectionRule<true> = {
  id: 'layout.sectionKey',
  appliesTo: (facts) => (facts.layoutOps.length > 0 ? true : null),
  loads: () => [],
  check(_state, _scope, ctx) {
    for (const outcome of appliedOf(ctx, ['invalidLayoutSection'])) {
      ctx.addIssue(
        'layout.sectionKey',
        'invalid_layout_section',
        `${outcome.sectionKey} is not the declared authored-layout section for ${outcome.type}.`,
        REFERENTIAL,
      );
    }
  },
};

type ServiceRefsScope = {
  entries: {
    index: number;
    op: (WorkItemCreateOperation | WorkItemUpdateOperation)['op'];
    node: NodeKey;
    serviceIds: string[];
  }[];
};

export const serviceRefsRule: ProjectionRule<ServiceRefsScope> = {
  id: 'service.refs',
  appliesTo(facts) {
    const entries = facts.request.operations.flatMap((operation, index) =>
      (operation.op === 'workItem.create' ||
        operation.op === 'workItem.update') &&
      operation.serviceIds !== undefined
        ? [
            {
              index,
              op: operation.op,
              node: nodeKey(operation.ref),
              serviceIds: [...operation.serviceIds],
            },
          ]
        : [],
    );
    return entries.length > 0 ? { entries } : null;
  },
  loads(scope) {
    const ids = [
      ...new Set(scope.entries.flatMap((entry) => entry.serviceIds)),
    ];
    return ids.length > 0 ? [{ kind: 'services', ids }] : [];
  },
  check(state, scope, ctx) {
    for (const { index, op, node: key, serviceIds } of scope.entries) {
      const field = `operations[${index}].serviceIds`;
      const duplicateCount = serviceIds.length - new Set(serviceIds).size;
      if (duplicateCount > 0) {
        ctx.logger.warn(
          'Duplicate Service IDs accepted in work-item change set',
          {
            projectId: ctx.projectId,
            operationIndex: index,
            operationKind: op,
            field,
            duplicateCount,
          },
        );
      }
      const node = state.nodes.get(key);
      if (
        node &&
        !isWorkItemServiceScopeEligible(
          ctx.registry.getRulesForProject(node.type, ctx.projectId),
        )
      ) {
        ctx.addIssue(
          field,
          'invalid_field',
          WORK_ITEM_SERVICE_SCOPE_INVALID_REASON,
          REFERENTIAL,
        );
      }
      const invalidIds = serviceIds.filter(
        (id) => !ctx.loaded.services.has(id),
      );
      if (invalidIds.length > 0) {
        ctx.addIssue(
          field,
          'entity_not_found',
          `serviceIds contains services outside this project: ${invalidIds.join(', ')}.`,
          REFERENTIAL,
        );
      }
    }
  },
};
