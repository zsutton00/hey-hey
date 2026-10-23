import type { FeatureRequirementsSection } from 'src/generated';
import { FeatureRequirementAuthoringService } from '../../../tasks/feature-requirement-authoring.service';
import { validateFeatureRequirementsSection } from '../../../tasks/feature-requirements-section.validator';
import type { Load, ProjectionRule, RuleContext } from '../projection-rule';
import {
  existingId,
  nodeKey,
  type IssueLayer,
  type NodeKey,
  type ProjectedEdge,
  type ProjectedNode,
  type ProjectionState,
  type RelKey,
} from '../projection-state';
import { projectedParentOf, type RequestFacts } from '../request-facts';

const REFERENTIAL: IssueLayer = 'referential';
const DEPENDS_ON = 'DEPENDS_ON';
const CONTRACT_PARTICIPATION_EDGE_TYPES = [
  'GUARANTEES',
  'IMPLEMENTS',
  'CONSUMES',
];

type RelationshipOp = RequestFacts['relationshipOps'][number];

function liveNode(
  state: ProjectionState,
  key: NodeKey,
): ProjectedNode | undefined {
  const node = state.nodes.get(key);
  return node && !node.deleted ? node : undefined;
}

function liveDependency(
  state: ProjectionState,
  key: RelKey,
): ProjectedEdge | undefined {
  const edge = state.relationships.get(key);
  return edge && !edge.deleted && edge.edgeType === DEPENDS_ON
    ? edge
    : undefined;
}

/** A create or update that may leave a DEPENDS_ON edge; an update keeps its stored type when it names none. */
const mayResultInDependency = (operation: RelationshipOp): boolean =>
  (operation.op === 'create' && operation.edgeType === DEPENDS_ON) ||
  (operation.op === 'update' &&
    (operation.edgeType === undefined || operation.edgeType === DEPENDS_ON));

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

type RefsScope = { refs: RelKey[] };

export const relationshipExistenceRule: ProjectionRule<RefsScope> = {
  id: 'relationship.existence',
  appliesTo(facts) {
    const refs = unique(
      facts.relationshipOps
        .filter(
          (operation) =>
            operation.op !== 'create' &&
            existingId(operation.ref) !== undefined,
        )
        .map(({ ref }) => ref),
    ).sort();
    return refs.length > 0 ? { refs } : null;
  },
  loads: (scope) => scope.refs.map((ref) => ({ kind: 'edgeById', ref })),
  check(_state, scope, ctx) {
    for (const ref of scope.refs) {
      if (!ctx.loaded.missingEdges.has(ref)) continue;
      ctx.addIssue(
        `relationships.${ref}`,
        'dangling_reference',
        `Existing relationship ${existingId(ref)} was not found in this graph boundary.`,
        REFERENTIAL,
      );
    }
  },
};

export const relationshipEndpointsRule: ProjectionRule<RefsScope> = {
  id: 'relationship.endpoints',
  appliesTo(facts) {
    const refs = unique(
      facts.relationshipOps
        .filter((operation) => operation.op !== 'delete')
        .map(({ ref }) => ref),
    );
    return refs.length > 0 ? { refs } : null;
  },
  // Endpoints a create or update names are hydrated by the facts phase; an
  // update that keeps its endpoints gets them from `relationship.existence`.
  loads: () => [],
  check(state, scope, ctx) {
    for (const key of scope.refs) {
      const edge = state.relationships.get(key);
      if (!edge || edge.deleted) continue;
      const resolve = (
        identity: ProjectedEdge['source'],
        field: string,
      ): ProjectedNode | undefined => {
        const node = state.nodes.get(nodeKey(identity));
        if (!node) {
          ctx.addIssue(
            field,
            'dangling_reference',
            `Work-item reference ${nodeKey(identity)} does not resolve.`,
            REFERENTIAL,
          );
        }
        return node;
      };
      const source = resolve(edge.source, `relationships.${key}.source`);
      const target = resolve(edge.target, `relationships.${key}.target`);
      if (!source || !target || source.deleted || target.deleted) {
        ctx.addIssue(
          `relationships.${key}`,
          'dangling_reference',
          'Relationship endpoints must resolve to non-deleted projected work items.',
          REFERENTIAL,
        );
      } else if (
        CONTRACT_PARTICIPATION_EDGE_TYPES.includes(edge.edgeType) &&
        (source.type !== 'DIAGRAM_ELEMENT' || target.type !== 'CONTRACT')
      ) {
        ctx.addIssue(
          `relationships.${key}`,
          'invalid_contract_participants',
          'Contract participation requires DIAGRAM_ELEMENT to CONTRACT.',
          REFERENTIAL,
        );
      }
    }
  },
};

type DependencyTopologyScope = {
  touched: { ref: RelKey; source?: NodeKey; target?: NodeKey }[];
  /** Every relationship the request writes, so its projected state wins over stored edges. */
  requestRefs: RelKey[];
};

export const dependencyTopologyRule: ProjectionRule<DependencyTopologyScope> = {
  id: 'dependency.topology',
  appliesTo(facts) {
    const touched = facts.relationshipOps
      .filter(mayResultInDependency)
      .map(({ ref, source, target }) => ({ ref, source, target }));
    return touched.length > 0
      ? {
          touched,
          requestRefs: unique(facts.relationshipOps.map(({ ref }) => ref)),
        }
      : null;
  },
  loads(scope) {
    const sources = unique(
      scope.touched.flatMap(({ source }) => (source ? [source] : [])),
    );
    const targets = unique(
      scope.touched.flatMap(({ target }) => (target ? [target] : [])),
    );
    // An update that names no target starts from its stored edge's target.
    const untargeted = unique(
      scope.touched.flatMap(({ ref, target }) => (target ? [] : [ref])),
    );
    // An update that names no source reads its stored edge's source.
    const unsourced = unique(
      scope.touched.flatMap(({ ref, source }) => (source ? [] : [ref])),
    );
    return [
      ...sources.map(
        (of): Load => ({
          kind: 'incidentEdges',
          of,
          edgeTypes: [DEPENDS_ON],
        }),
      ),
      ...unsourced.map(
        (sourceOf): Load => ({
          kind: 'incidentEdges',
          sourceOf,
          edgeTypes: [DEPENDS_ON],
        }),
      ),
      ...(targets.length > 0 || untargeted.length > 0
        ? [
            {
              kind: 'dependsOnClosure',
              from: targets,
              edges: untargeted,
            } satisfies Load,
          ]
        : []),
    ];
  },
  check(state, scope, ctx) {
    // Stored edges come from the source's incident edges and the target
    // closure; a stored edge the request rewrites is read in its projected form.
    const edges = new Map<RelKey, { source: NodeKey; target: NodeKey }>();
    const consider = (key: RelKey) => {
      if (edges.has(key)) return;
      const edge = liveDependency(state, key);
      if (edge)
        edges.set(key, {
          source: nodeKey(edge.source),
          target: nodeKey(edge.target),
        });
    };
    scope.requestRefs.forEach(consider);
    for (const { ref, source } of scope.touched) {
      const resolved = source ?? nodeKey(state.relationships.get(ref)?.source);
      if (resolved)
        (ctx.loaded.incidentEdges.get(resolved) ?? []).forEach(consider);
    }
    for (const stored of ctx.loaded.closureEdges) {
      const key = `existing:${stored.id}`;
      if (state.relationships.has(key)) consider(key);
      else if (!edges.has(key))
        edges.set(key, {
          source: `existing:${stored.sourceNodeId}`,
          target: `existing:${stored.targetNodeId}`,
        });
    }
    const outgoing = new Map<NodeKey, NodeKey[]>();
    for (const { source, target } of edges.values()) {
      outgoing.set(source, [...(outgoing.get(source) ?? []), target]);
    }

    for (const key of unique(scope.touched.map(({ ref }) => ref))) {
      const edge = edges.get(key);
      if (!edge || !liveDependency(state, key)) continue;
      const { source, target } = edge;
      if (
        [...edges].some(
          ([otherKey, other]) =>
            otherKey !== key &&
            other.source === source &&
            other.target === target,
        )
      ) {
        ctx.addIssue(
          `relationships.${key}`,
          'duplicate_dependency',
          'Keep one DEPENDS_ON relationship for these endpoints.',
          REFERENTIAL,
        );
      }
      const visited = new Set<NodeKey>();
      const pending = [target];
      while (pending.length > 0) {
        const current = pending.pop()!;
        if (current === source) {
          ctx.addIssue(
            `relationships.${key}`,
            'dependency_cycle',
            'DEPENDS_ON relationships must not contain a cycle.',
            REFERENTIAL,
          );
          break;
        }
        if (visited.has(current)) continue;
        visited.add(current);
        pending.push(...(outgoing.get(current) ?? []));
      }
    }
  },
};

type PlanBoundaryScope = {
  touched: { ref: RelKey; source?: NodeKey; target?: NodeKey }[];
  reparented: NodeKey[];
};

export const planDependenciesBoundaryRule: ProjectionRule<PlanBoundaryScope> = {
  id: 'plan.dependencies.boundary',
  appliesTo(facts) {
    const touched = facts.relationshipOps
      .filter(mayResultInDependency)
      .map(({ ref, source, target }) => ({ ref, source, target }));
    // Moving into or out of a Stage can change the boundary of stored edges.
    // The old parent may not be directly named by the request.
    const mayBeStage = (key: NodeKey | null) => {
      if (!key) return false;
      const type = facts.typeOf(key);
      return type === undefined || type === 'PLAN_STAGE';
    };
    const reparented = unique(
      facts.updates
        .filter(
          ({ node, parentChange }) =>
            parentChange &&
            !facts.creates.some((create) => create.node === node) &&
            facts.typeOf(node) === 'STANDARD' &&
            (mayBeStage(parentChange.from) || mayBeStage(parentChange.to)),
        )
        .map(({ node }) => node),
    );
    return touched.length > 0 || reparented.length > 0
      ? { touched, reparented }
      : null;
  },
  loads(scope) {
    return [
      ...scope.touched.flatMap(({ ref, source, target }) =>
        (['source', 'target'] as const).flatMap((endpoint): Load[] =>
          (endpoint === 'source' ? source : target) === undefined
            ? [{ kind: 'parent', endpointOf: ref, endpoint }]
            : [],
        ),
      ),
      ...scope.reparented.map(
        (of): Load => ({
          kind: 'incidentEdges',
          of,
          edgeTypes: [DEPENDS_ON],
        }),
      ),
    ];
  },
  check(state, scope, ctx) {
    const keys = unique([
      ...scope.touched.map(({ ref }) => ref),
      ...scope.reparented.flatMap(
        (node) => ctx.loaded.incidentEdges.get(node) ?? [],
      ),
    ]);
    for (const key of keys) {
      const relationship = liveDependency(state, key);
      if (!relationship) continue;
      const source = endpointView(state, ctx, nodeKey(relationship.source));
      const target = endpointView(state, ctx, nodeKey(relationship.target));
      if (!source || !target) continue;

      const planStageEdge =
        source.type === 'PLAN_STAGE' || target.type === 'PLAN_STAGE';
      const planTaskEdge =
        source.type === 'STANDARD' &&
        target.type === 'STANDARD' &&
        (source.parentType === 'PLAN_STAGE' ||
          target.parentType === 'PLAN_STAGE');
      if (
        !(planStageEdge || planTaskEdge) ||
        (source.parent && target.parent && source.parent === target.parent)
      )
        continue;
      ctx.addIssue(
        `relationships.${key}`,
        planStageEdge
          ? 'plan_stage_reference_outside_plan'
          : 'cross_boundary_dependency',
        planStageEdge
          ? 'A Plan Stage dependency must target another PLAN_STAGE under the same Plan.'
          : 'Plan Task dependencies must remain within one Plan Stage.',
        REFERENTIAL,
        planStageEdge
          ? 'Point DEPENDS_ON to the immediate predecessor Stage in this Plan.'
          : undefined,
        {
          relationshipIdentity: key,
          sourceStageIdentity: nodeKey(relationship.source),
          targetStageIdentity: nodeKey(relationship.target),
        },
      );
    }
  },
};

/** A dependency endpoint's type and parent, from projected state or the incident-edge load. */
function endpointView(
  state: ProjectionState,
  ctx: RuleContext,
  key: NodeKey,
):
  | { type: string; parent: NodeKey | null; parentType: string | undefined }
  | undefined {
  const node = state.nodes.get(key);
  if (node) {
    if (node.deleted) return undefined;
    const parent =
      projectedParentOf(ctx.facts, key) ??
      (node.parent ? nodeKey(node.parent) : null);
    return {
      type: node.type,
      parent,
      parentType:
        ctx.facts.parentTypeOf(key) ??
        (parent ? state.nodes.get(parent)?.type : undefined),
    };
  }
  const skeleton = ctx.loaded.edgeEndpoints.get(key);
  if (!skeleton) return undefined;
  return {
    type: skeleton.type,
    parent: skeleton.parent,
    parentType:
      (skeleton.parent ? state.nodes.get(skeleton.parent)?.type : undefined) ??
      skeleton.parentType ??
      undefined,
  };
}

type PlanChainScope = {
  plan: NodeKey;
  /** False when only relationship operations triggered, so a touched edge must join two stages. */
  membershipChanges: boolean;
  /** Nodes the request creates or reparents, which may join the Plan's stages. */
  candidateStages: NodeKey[];
  requestRefs: RelKey[];
};

export const planDependenciesChainRule: ProjectionRule<PlanChainScope> = {
  id: 'plan.dependencies.chain',
  appliesTo(facts) {
    const plan = facts.root;
    if (facts.typeOf(plan) !== 'PLAN') return null;
    const isStage = (key: NodeKey | undefined) =>
      key !== undefined && facts.typeOf(key) === 'PLAN_STAGE';
    const membershipChanges =
      facts.creates.some(
        ({ type, parent }) => type === 'PLAN_STAGE' && parent === plan,
      ) ||
      facts.deletes.some(({ node }) => isStage(node)) ||
      facts.updates.some(
        ({ node, parentChange }) =>
          parentChange &&
          isStage(node) &&
          (parentChange.from === plan || parentChange.to === plan),
      );
    // A delete or an endpoint-less update names no endpoints to rule out.
    const stageEdgeChanges = facts.relationshipOps.some((operation) =>
      operation.op === 'create'
        ? operation.edgeType === DEPENDS_ON &&
          isStage(operation.source) &&
          isStage(operation.target)
        : operation.op === 'delete' ||
          (operation.op === 'update' &&
            (operation.source === undefined || isStage(operation.source)) &&
            (operation.target === undefined || isStage(operation.target))),
    );
    if (!membershipChanges && !stageEdgeChanges) return null;
    return {
      plan,
      membershipChanges,
      candidateStages: unique([
        ...facts.creates.map(({ node }) => node),
        ...facts.updates
          .filter(({ parentChange }) => parentChange?.to === plan)
          .map(({ node }) => node),
      ]),
      requestRefs: unique(facts.relationshipOps.map(({ ref }) => ref)),
    };
  },
  loads: (scope) => [{ kind: 'planStages', plan: scope.plan }],
  check(state, scope, ctx) {
    const root = liveNode(state, scope.plan);
    if (!root || root.type !== 'PLAN') return;
    const loaded = ctx.loaded.planStages.get(scope.plan);
    const stageKeys = new Set(
      unique([...(loaded?.stages ?? []), ...scope.candidateStages]).filter(
        (key) => {
          const node = liveNode(state, key);
          return (
            node?.type === 'PLAN_STAGE' && nodeKey(node.parent) === scope.plan
          );
        },
      ),
    );
    if (stageKeys.size <= 1) return;
    // A deleted or retyped edge keeps its endpoints in state, so an edge
    // between two tasks never re-checks a persisted chain.
    const touchesStageEdge = scope.requestRefs.some((key) => {
      const edge = state.relationships.get(key);
      return (
        edge !== undefined &&
        (edge.edgeType === DEPENDS_ON ||
          ctx.loaded.storedEdgeTypes.get(key) === DEPENDS_ON) &&
        stageKeys.has(nodeKey(edge.source)) &&
        stageKeys.has(nodeKey(edge.target))
      );
    });
    if (!scope.membershipChanges && !touchesStageEdge) return;
    const stageEdges = unique([
      ...(loaded?.edges ?? []),
      ...scope.requestRefs,
    ]).flatMap((key) => {
      const edge = liveDependency(state, key);
      return edge &&
        stageKeys.has(nodeKey(edge.source)) &&
        stageKeys.has(nodeKey(edge.target))
        ? [{ key, source: nodeKey(edge.source), target: nodeKey(edge.target) }]
        : [];
    });
    reportPlanStageChain(scope.plan, stageKeys, stageEdges, ctx);
  },
};

function reportPlanStageChain(
  plan: NodeKey,
  stageKeys: ReadonlySet<NodeKey>,
  stageEdges: readonly { key: RelKey; source: NodeKey; target: NodeKey }[],
  ctx: RuleContext,
): void {
  type StageEdge = (typeof stageEdges)[number];
  const prerequisiteEdges = new Map<NodeKey, StageEdge[]>();
  const dependentEdges = new Map<NodeKey, StageEdge[]>();
  for (const key of stageKeys) {
    prerequisiteEdges.set(key, []);
    dependentEdges.set(key, []);
  }
  const edgeByEndpoints = new Map<string, StageEdge[]>();
  for (const edge of stageEdges) {
    prerequisiteEdges.get(edge.source)!.push(edge);
    dependentEdges.get(edge.target)!.push(edge);
    const endpointKey = `${edge.source}->${edge.target}`;
    edgeByEndpoints.set(endpointKey, [
      ...(edgeByEndpoints.get(endpointKey) ?? []),
      edge,
    ]);
  }

  for (const duplicates of edgeByEndpoints.values()) {
    for (const duplicate of duplicates.slice(1)) {
      ctx.addIssue(
        `relationships.${duplicate.key}`,
        'duplicate_plan_stage_dependency',
        'The same Plan Stage dependency is declared more than once.',
        REFERENTIAL,
        'Keep one DEPENDS_ON relationship between this Stage and its immediate predecessor.',
        {
          planIdentity: plan,
          relationshipIdentity: duplicate.key,
          sourceStageIdentity: duplicate.source,
          targetStageIdentity: duplicate.target,
        },
      );
    }
  }

  for (const [stageKey, edges] of prerequisiteEdges) {
    if (edges.length <= 1) continue;
    ctx.addIssue(
      `nodes.${stageKey}.stageDependencies`,
      'plan_stage_multiple_predecessors',
      'A Plan Stage may depend on exactly one immediate predecessor.',
      REFERENTIAL,
      "Remove every DEPENDS_ON relationship except the one to this Stage's immediate predecessor.",
      {
        planIdentity: plan,
        stageIdentity: stageKey,
        relationshipIdentities: edges.map((edge) => edge.key),
        predecessorCount: edges.length,
      },
    );
  }

  for (const [stageKey, edges] of dependentEdges) {
    if (edges.length <= 1) continue;
    ctx.addIssue(
      `nodes.${stageKey}.stageDependencies`,
      'plan_stage_branching',
      'A Plan Stage may have only one immediate successor in a linear Plan.',
      REFERENTIAL,
      'Choose one next Stage and make any later Stage depend on that Stage instead.',
      {
        planIdentity: plan,
        stageIdentity: stageKey,
        relationshipIdentities: edges.map((edge) => edge.key),
        successorStageIdentities: edges.map((edge) => edge.source),
      },
    );
  }

  const firstStages = [...prerequisiteEdges.entries()]
    .filter(([, edges]) => edges.length === 0)
    .map(([key]) => key);
  const firstStage = firstStages.length === 1 ? firstStages[0] : undefined;
  const visited = new Set<NodeKey>();
  let cursor = firstStage;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const successors = dependentEdges.get(cursor) ?? [];
    cursor = successors.length === 1 ? successors[0]!.source : undefined;
  }

  const canReach = (from: NodeKey, target: NodeKey): boolean => {
    const pending = [from];
    const seen = new Set<NodeKey>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current === target) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const edge of prerequisiteEdges.get(current) ?? []) {
        pending.push(edge.target);
      }
    }
    return false;
  };
  const cyclicRelationships = stageEdges.filter((edge) =>
    canReach(edge.target, edge.source),
  );
  const cyclicStageKeys = new Set(
    cyclicRelationships.flatMap((edge) => [edge.source, edge.target]),
  );
  if (cyclicStageKeys.size > 0) {
    ctx.addIssue(
      `nodes.${plan}.stageDependencies`,
      'plan_stage_cycle',
      'Plan Stage dependencies contain a cycle, so the Plan has no valid linear execution order.',
      REFERENTIAL,
      'Remove or redirect the listed DEPENDS_ON relationships so exactly one Stage remains first.',
      {
        planIdentity: plan,
        stageIdentities: [...cyclicStageKeys].sort(),
        relationshipIdentities: cyclicRelationships
          .map((edge) => edge.key)
          .sort(),
      },
    );
  }

  const disconnectedStageKeys = [...stageKeys].filter(
    (key) => !visited.has(key) && !cyclicStageKeys.has(key),
  );
  if (
    cyclicStageKeys.size === 0 &&
    (firstStages.length !== 1 || disconnectedStageKeys.length > 0)
  ) {
    ctx.addIssue(
      `nodes.${plan}.stageDependencies`,
      'plan_stage_disconnected',
      'Plan Stages must form one connected DEPENDS_ON chain with exactly one first Stage.',
      REFERENTIAL,
      'Leave the first Stage without a predecessor, then make every later Stage depend on its immediate predecessor.',
      {
        planIdentity: plan,
        firstStageIdentities: firstStages.sort(),
        disconnectedStageIdentities: disconnectedStageKeys.sort(),
      },
    );
  }
}

type FeatureRequirementsScope = {
  features: {
    node: NodeKey;
    created: boolean;
    replaced: boolean;
    reparented: boolean;
  }[];
};

export const featureRequirementsRule: ProjectionRule<FeatureRequirementsScope> =
  {
    id: 'feature.requirements',
    appliesTo(facts) {
      const byNode = new Map<
        NodeKey,
        FeatureRequirementsScope['features'][number]
      >();
      const touch = (
        node: NodeKey,
        flag: 'created' | 'replaced' | 'reparented',
      ) => {
        if (facts.typeOf(node) !== 'FEATURE') return;
        const entry = byNode.get(node) ?? {
          node,
          created: false,
          replaced: false,
          reparented: false,
        };
        entry[flag] = true;
        byNode.set(node, entry);
      };
      facts.creates.forEach(({ node }) => touch(node, 'created'));
      facts.sectionWrites.forEach(({ node, key, kind }) => {
        if (key === 'requirements' && kind === 'replace')
          touch(node, 'replaced');
      });
      facts.updates.forEach(({ node, parentChange }) => {
        if (parentChange) touch(node, 'reparented');
      });
      return byNode.size > 0 ? { features: [...byNode.values()] } : null;
    },
    loads: (scope, facts) =>
      scope.features.flatMap(
        ({ node, created, replaced, reparented }): Load[] => {
          const prior = facts.sectionContentOf(node, 'requirements');
          const writes = facts.request.operations.filter(
            (
              operation,
            ): operation is Extract<
              typeof operation,
              { op: 'section.replace' }
            > =>
              operation.op === 'section.replace' &&
              nodeKey(operation.ref) === node &&
              operation.key === 'requirements',
          );
          const content = writes.length
            ? writes[writes.length - 1]!.content
            : prior;
          const parsed = validateFeatureRequirementsSection(content);
          const records = parsed.success ? parsed.value.records : [];
          const changed =
            parsed.success && replaced && !created
              ? changedRecordIndexes(parsed.value, prior)
              : undefined;
          return [
            ...(created || replaced
              ? [
                  {
                    kind: 'requirementCitations' as const,
                    feature: node,
                    records: records.filter(
                      (_record, index) => !changed || changed.has(index),
                    ),
                  },
                ]
              : []),
            ...(reparented && !created
              ? [
                  {
                    kind: 'requirementCitations' as const,
                    feature: node,
                    records,
                    onlyEntityId:
                      existingId(projectedParentOf(facts, node) ?? '') ?? null,
                  },
                ]
              : []),
          ];
        },
      ),
    check(state, scope, ctx) {
      const authoring = new FeatureRequirementAuthoringService(ctx.registry);
      for (const {
        node: key,
        created,
        replaced,
        reparented,
      } of scope.features) {
        const node = liveNode(state, key);
        if (!node || node.type !== 'FEATURE') continue;
        const content = node.sections.find(
          (section) => section.key === 'requirements',
        )?.content;
        if (content === undefined) continue;
        const report = (field: string, code: string, message: string) =>
          ctx.addIssue(
            `nodes.${key}.sections[requirements].${field}`,
            `feature_requirement_${code}`,
            message,
            REFERENTIAL,
          );

        const structural = validateFeatureRequirementsSection(content);
        if (!structural.success) {
          // A stored malformed collection is not this request's to report.
          if (created || replaced)
            report('requirements', 'invalid_structure', structural.message);
          continue;
        }
        const parent = node.parent ? nodeKey(node.parent) : undefined;
        const diagnostics = authoring.checkCitations(structural.value, {
          projectId: ctx.projectId,
          excluded: new Set(
            [existingId(key), parent && existingId(parent)].filter(
              (id): id is string => Boolean(id),
            ),
          ),
          citations: ctx.loaded.requirementCitations,
        });
        const changed =
          created || !replaced
            ? undefined
            : changedRecordIndexes(
                structural.value,
                ctx.loaded.priorRequirements.get(key),
              );
        for (const diagnostic of diagnostics) {
          const inScope =
            created ||
            (replaced &&
              diagnostic.recordIndex !== undefined &&
              changed!.has(diagnostic.recordIndex)) ||
            (reparented && diagnostic.code === 'excluded_reference');
          if (inScope)
            report(diagnostic.field, diagnostic.code, diagnostic.message);
        }
      }
    },
  };

/** Indexes of records that are new or whose citations differ from the prior collection. */
function changedRecordIndexes(
  next: FeatureRequirementsSection,
  prior: unknown,
): Set<number> {
  const parsedPrior =
    prior === undefined ? undefined : validateFeatureRequirementsSection(prior);
  const priorCites = new Map(
    parsedPrior?.success
      ? parsedPrior.value.records.map((record) => [record.id, record])
      : [],
  );
  const changed = new Set<number>();
  next.records.forEach((record, index) => {
    const previous = priorCites.get(record.id);
    if (!previous || !sameCitations(previous, record)) changed.add(index);
  });
  return changed;
}

function sameCitations(
  previous: FeatureRequirementsSection['records'][number],
  next: FeatureRequirementsSection['records'][number],
): boolean {
  return (['designedBy', 'fulfilledBy', 'contracts'] as const).every((slot) => {
    const before = previous[slot];
    const after = next[slot];
    return (
      before.length === after.length &&
      before.every(
        (citation, index) =>
          citation.entityType === after[index]!.entityType &&
          citation.entityId === after[index]!.entityId,
      )
    );
  });
}

type LayoutBoundaryScope = {
  root: NodeKey;
  /** Nodes the request creates or moves, which may become root children. */
  candidates: NodeKey[];
  boundary: NodeKey[] | null;
};

export const layoutBoundaryRule: ProjectionRule<LayoutBoundaryScope> = {
  id: 'layout.boundary',
  appliesTo(facts) {
    if (
      !facts.layoutOps.some(
        ({ op, root }) => op === 'replace' && root === facts.root,
      )
    )
      return null;
    return {
      root: facts.root,
      candidates: unique([
        ...facts.creates.map(({ node }) => node),
        ...facts.updates
          .filter(({ parentChange }) => parentChange?.to === facts.root)
          .map(({ node }) => node),
      ]),
      boundary: facts.hasLayoutBoundary
        ? (facts.request.layoutBoundary ?? []).map(nodeKey)
        : null,
    };
  },
  loads: (scope) =>
    scope.boundary ? [] : [{ kind: 'children', of: scope.root }],
  check(state, scope, ctx) {
    const rootKey = scope.root;
    if (state.deletedLayoutRoots.has(rootKey)) return;
    const entries = state.layoutEntries.get(rootKey);
    if (!entries) return;

    const expected = new Set(
      scope.boundary
        ? [...scope.boundary].sort()
        : unique([
            ...(ctx.loaded.children.get(rootKey) ?? []),
            ...scope.candidates,
          ]).filter((key) => {
            const node = liveNode(state, key);
            return node !== undefined && nodeKey(node.parent) === rootKey;
          }),
    );
    for (const expectedKey of expected) {
      if (!entries.has(expectedKey)) {
        ctx.addIssue(
          `layout.${rootKey}`,
          'incomplete_layout_membership',
          `Layout is missing node ${expectedKey}.`,
          REFERENTIAL,
        );
      }
    }
    for (const entryKey of entries) {
      if (!liveNode(state, entryKey)) {
        ctx.addIssue(
          `layout.${rootKey}`,
          'dangling_reference',
          `Layout entry ${entryKey} must resolve to a non-deleted projected work item.`,
          REFERENTIAL,
        );
        continue;
      }
      if (!expected.has(entryKey)) {
        ctx.addIssue(
          `layout.${rootKey}`,
          'extraneous_layout_membership',
          `Layout contains extraneous node ${entryKey}.`,
          REFERENTIAL,
        );
      }
    }
  },
};
