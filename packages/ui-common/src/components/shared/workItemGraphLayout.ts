import type {
  ProjectedWorkItem,
  ProjectedWorkItemRelationship,
  WorkItemChangeSetIdentity,
  WorkItemChangeSetPosition,
  WorkItemGraphLayoutPreferenceValue,
} from "../../api";
import {
  buildCanonicalProjectedGraphPositions,
  buildPreferredProjectedGraphPositionResult,
} from "./WorkflowMentionInlineRenderer";

export const WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION =
  "work-item-graph-layout.v1" as const;

export interface WorkItemGraphLayoutNode {
  node: WorkItemChangeSetIdentity;
  position: WorkItemChangeSetPosition;
}

export interface WorkItemGraphLayout {
  schemaVersion: typeof WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION;
  nodes: WorkItemGraphLayoutNode[];
}

export interface CanonicalWorkItemGraphLayoutInput {
  children: readonly ProjectedWorkItem[];
  relationships: readonly ProjectedWorkItemRelationship[];
}

export type PreferredWorkItemGraphShape = Pick<
  WorkItemGraphLayoutPreferenceValue,
  "rows" | "columns"
>;

export type PreferredLayoutDeparture =
  | "atomic-group-preserved"
  | "branch-lanes-preserved"
  | "cycle-routing-preserved"
  | "requested-shape-unattainable";

export interface PreferredWorkItemGraphLayoutResult {
  layout: WorkItemGraphLayout;
  requested: PreferredWorkItemGraphShape;
  actual: PreferredWorkItemGraphShape;
  departures: readonly PreferredLayoutDeparture[];
}

export function workItemIdentityKey(
  identity: WorkItemChangeSetIdentity
): string {
  return identity.refType === "existing"
    ? `existing:${identity.id}`
    : `temporary:${identity.tempId}`;
}

export function compareWorkItemIdentities(
  left: WorkItemChangeSetIdentity,
  right: WorkItemChangeSetIdentity
): number {
  return workItemIdentityKey(left).localeCompare(workItemIdentityKey(right));
}

function isActiveChild(node: ProjectedWorkItem): boolean {
  return !node.deleted;
}

/**
 * Compute the density-independent fallback placement used when a graph has no
 * authored layout. The result depends on node meaning and flow topology, not
 * retrieval order, operation order, or the kind of identity used by a node.
 */
export function computeCanonicalWorkItemGraphLayout({
  children,
  relationships,
}: CanonicalWorkItemGraphLayoutInput): WorkItemGraphLayout {
  const activeChildren = children.filter(isActiveChild);
  const positions = buildCanonicalProjectedGraphPositions(
    activeChildren,
    relationships
  );
  return {
    schemaVersion: WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION,
    nodes: activeChildren
      .map((child) => ({
        node: child.identity,
        position: positions.get(workItemIdentityKey(child.identity)),
      }))
      .filter(
        (
          entry
        ): entry is {
          node: WorkItemChangeSetIdentity;
          position: WorkItemChangeSetPosition;
        } => entry.position !== undefined
      )
      .sort((left, right) => compareWorkItemIdentities(left.node, right.node)),
  };
}

export function computePreferredWorkItemGraphLayout(
  input: CanonicalWorkItemGraphLayoutInput,
  preference: PreferredWorkItemGraphShape
): PreferredWorkItemGraphLayoutResult {
  const canonical = computeCanonicalWorkItemGraphLayout(input);
  if (
    !Number.isInteger(preference.rows) ||
    preference.rows < 1 ||
    !Number.isInteger(preference.columns) ||
    preference.columns < 1
  ) {
    return {
      layout: canonical,
      requested: preference,
      actual: { rows: 0, columns: 0 },
      departures: ["requested-shape-unattainable"],
    };
  }

  const preferred = buildPreferredProjectedGraphPositionResult(
    input.children,
    input.relationships,
    preference
  );
  const nodes = input.children.flatMap((child) => {
    const position = preferred.positions.get(
      workItemIdentityKey(child.identity)
    );
    return position ? [{ node: child.identity, position }] : [];
  });
  return {
    layout: {
      schemaVersion: WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION,
      nodes: nodes.sort((left, right) =>
        compareWorkItemIdentities(left.node, right.node)
      ),
    },
    requested: preference,
    actual: preferred.actual,
    departures: preferred.departures,
  };
}

export function normalizeWorkItemGraphLayout(
  layout: WorkItemGraphLayout,
  children: readonly ProjectedWorkItem[]
): WorkItemGraphLayout {
  const activeChildKeys = new Set(
    children
      .filter(isActiveChild)
      .map((child) => workItemIdentityKey(child.identity))
  );
  const seen = new Set<string>();
  const nodes = layout.nodes
    .filter((entry) => {
      const key = workItemIdentityKey(entry.node);
      if (!activeChildKeys.has(key) || seen.has(key)) return false;
      seen.add(key);
      return (
        Number.isFinite(entry.position.x) && Number.isFinite(entry.position.y)
      );
    })
    .sort((left, right) => compareWorkItemIdentities(left.node, right.node));

  return {
    schemaVersion: WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION,
    nodes,
  };
}

export function mergeWorkItemGraphLayout(
  base: WorkItemGraphLayout,
  canonical: WorkItemGraphLayout,
  overrides: ReadonlyMap<string, WorkItemChangeSetPosition>
): WorkItemGraphLayout {
  const authoredByIdentity = new Map(
    base.nodes.map((entry) => [workItemIdentityKey(entry.node), entry.position])
  );
  const nodes = canonical.nodes.map((entry) => ({
    node: entry.node,
    position:
      overrides.get(workItemIdentityKey(entry.node)) ??
      authoredByIdentity.get(workItemIdentityKey(entry.node)) ??
      entry.position,
  }));
  return {
    schemaVersion: WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION,
    nodes,
  };
}
