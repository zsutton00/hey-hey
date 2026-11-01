import type { FeatureRequirementsSection } from 'src/generated';
import type { GraphAgentEdge } from './projection-loader';
import type { Logger } from '@nestjs/common';
import type { TaskSectionSchemaValidatorRegistry } from '../../tasks/task-section-schema-validator.registry';
import type { WorkItemParentageValidator } from '../../tasks/work-item-parentage-validator.service';
import type { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import type { ProjectId } from 'src/types';
import type {
  IssueLayer,
  NodeKey,
  ProjectionFindings,
  ProjectionState,
  RelKey,
} from './projection-state';
import type { RequestFacts } from './request-facts';

export type Load =
  | { kind: 'parent'; of: NodeKey }
  | { kind: 'parent'; endpointOf: RelKey; endpoint: 'source' | 'target' }
  | { kind: 'ancestorsToRoot'; of: NodeKey }
  | { kind: 'children'; of: NodeKey }
  | { kind: 'siblingsNamed'; parent: NodeKey; name: string }
  | { kind: 'edgeById'; ref: RelKey }
  | { kind: 'incidentEdges'; of: NodeKey; edgeTypes: string[] }
  /** Incident edges of a stored edge's source, for updates that name no endpoints. */
  | { kind: 'incidentEdges'; sourceOf: RelKey; edgeTypes: string[] }
  /** `edges` start the walk from each stored edge's target, for updates that name no endpoints. */
  | { kind: 'dependsOnClosure'; from: NodeKey[]; edges: RelKey[] }
  | { kind: 'planStages'; plan: NodeKey }
  | { kind: 'diagramGraph'; of: NodeKey }
  | { kind: 'diagramTargets'; of: NodeKey[] }
  | { kind: 'services'; ids: string[] }
  | {
      kind: 'requirementCitations';
      feature: NodeKey;
      records: FeatureRequirementsSection['records'];
      onlyEntityId?: string | null;
    };

export type LoadKind = Load['kind'];

/** Identity, type and parent only; used where sections are never read. */
export type NodeSkeleton = { id: string; type: string; parent: NodeKey | null };

/** A far edge endpoint, with its parent's type so boundary rules need no further read. */
export type EndpointSkeleton = NodeSkeleton & { parentType: string | null };

/**
 * What the loader produced beyond the full nodes and edges it writes into
 * `ProjectionState`. Rules read these instead of querying.
 */
export type LoadedData = {
  /** Ancestor chains, nearest parent first, keyed by the starting node. */
  ancestors: Map<NodeKey, NodeSkeleton[]>;
  /** Stored children found by `siblingsNamed`, keyed by `siblingsKey`. */
  siblings: Map<string, NodeKey[]>;
  /** Nodes reached by `dependsOnClosure`, keyed by node key. */
  closureNodes: Map<NodeKey, NodeSkeleton>;
  /** Task-to-task DEPENDS_ON edges walked by `dependsOnClosure`. */
  closureEdges: GraphAgentEdge[];
  /** Edges named by `edgeById` that the Graph did not return. */
  missingEdges: Set<RelKey>;
  /** Stored types of explicitly loaded relationships, before request updates. */
  storedEdgeTypes: Map<RelKey, string>;
  /** Stored children found by `children`, keyed by parent. */
  children: Map<NodeKey, NodeKey[]>;
  /** Edge keys found by `incidentEdges`, keyed by the node they touch. */
  incidentEdges: Map<NodeKey, RelKey[]>;
  /** Far endpoints of `incidentEdges` results that were not otherwise loaded. */
  edgeEndpoints: Map<NodeKey, EndpointSkeleton>;
  /** Stored PLAN_STAGE children and their stage-to-stage edges, keyed by Plan. */
  planStages: Map<NodeKey, { stages: NodeKey[]; edges: RelKey[] }>;
  /** Stored requirements content before operations apply, keyed by FEATURE. */
  priorRequirements: Map<NodeKey, unknown>;
  /** Live canonical Diagram targets by entity id. */
  diagramTargets: Map<
    string,
    { entityType: 'TASK' | 'SERVICE'; type?: string }
  >;
  /** Service ids that exist and are live in the project. */
  services: Set<string>;
  /** Cited tasks and design docs by id, regardless of project. */
  requirementCitations: Map<
    string,
    { entityType: 'TASK' | 'DESIGN_DOC'; projectId: string; type?: string }
  >;
};

export function createLoadedData(): LoadedData {
  return {
    ancestors: new Map(),
    siblings: new Map(),
    closureNodes: new Map(),
    closureEdges: [],
    missingEdges: new Set(),
    storedEdgeTypes: new Map(),
    children: new Map(),
    incidentEdges: new Map(),
    edgeEndpoints: new Map(),
    planStages: new Map(),
    priorRequirements: new Map(),
    diagramTargets: new Map(),
    services: new Set(),
    requirementCitations: new Map(),
  };
}

export function siblingsKey(parent: NodeKey, name: string): string {
  return `${parent}\u0000${name}`;
}

export type RuleContext = {
  facts: RequestFacts;
  registry: WorkItemTypeRegistryService;
  parentage: WorkItemParentageValidator;
  sectionValidators: TaskSectionSchemaValidatorRegistry;
  logger: Logger;
  projectId: ProjectId;
  loaded: LoadedData;
  findings: ProjectionFindings;
  addIssue: (
    field: string,
    code: string,
    reason: string,
    layer: IssueLayer,
    suggestion?: string,
    metadata?: Record<string, unknown>,
  ) => void;
  /** A finding the user may proceed past; it never makes the result invalid. */
  addWarning: (
    field: string,
    code: string,
    reason: string,
    layer: IssueLayer,
    suggestion?: string,
    metadata?: Record<string, unknown>,
  ) => void;
};

export interface ProjectionRule<S> {
  /** Stable; used by the shape test and logs. */
  id: string;
  /** Null when nothing in the request can change this rule's result. */
  appliesTo(
    facts: RequestFacts,
    registry: WorkItemTypeRegistryService,
    projectId: ProjectId,
  ): S | null;
  loads(scope: S, facts: RequestFacts): Load[];
  /** Reads only its scope and loaded data; never iterates all of state. */
  check(state: ProjectionState, scope: S, ctx: RuleContext): void;
}

// The planner holds rules of differing scope types side by side.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyProjectionRule = ProjectionRule<any>;

export type ActiveRule = { rule: AnyProjectionRule; scope: unknown };

export type ProjectionPlan = {
  active: ActiveRule[];
  loads: Load[];
};

export function loadIdentity(load: Load): string {
  switch (load.kind) {
    case 'dependsOnClosure':
      return `${load.kind}:${[...new Set(load.from)].sort().join(',')}|${[...new Set(load.edges)].sort().join(',')}`;
    case 'diagramTargets':
      return `${load.kind}:${[...new Set(load.of)].sort().join(',')}`;
    case 'services':
      return `${load.kind}:${[...new Set(load.ids)].sort().join(',')}`;
    case 'incidentEdges':
      return `${load.kind}:${'of' in load ? load.of : `sourceOf:${load.sourceOf}`}:${[...new Set(load.edgeTypes)].sort().join(',')}`;
    case 'siblingsNamed':
      return `${load.kind}:${load.parent}:${load.name}`;
    case 'parent':
      return `${load.kind}:${'of' in load ? load.of : `${load.endpointOf}:${load.endpoint}`}`;
    case 'ancestorsToRoot':
    case 'children':
    case 'diagramGraph':
      return `${load.kind}:${load.of}`;
    case 'edgeById':
      return `${load.kind}:${load.ref}`;
    case 'planStages':
      return `${load.kind}:${load.plan}`;
    case 'requirementCitations':
      return `${load.kind}:${load.feature}${load.onlyEntityId === undefined ? '' : `:only:${load.onlyEntityId}`}`;
  }
}

/**
 * Pure: evaluates every rule's trigger against the request facts and returns
 * the active rules in declaration order with a deduplicated load list.
 */
export function planProjection(params: {
  rules: readonly AnyProjectionRule[];
  facts: RequestFacts;
  registry: WorkItemTypeRegistryService;
  projectId: ProjectId;
}): ProjectionPlan {
  const active: ActiveRule[] = [];
  const loads = new Map<string, Load>();
  for (const rule of params.rules) {
    const scope: unknown = rule.appliesTo(
      params.facts,
      params.registry,
      params.projectId,
    );
    if (scope === null) continue;
    active.push({ rule, scope });
    for (const load of rule.loads(scope, params.facts)) {
      const identity = loadIdentity(load);
      if (!loads.has(identity)) loads.set(identity, load);
    }
  }
  return { active, loads: [...loads.values()] };
}
