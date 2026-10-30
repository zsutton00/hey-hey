import type { Task } from '@prisma/client';
import type {
  ProjectedWorkItem,
  ProjectedWorkItemChangeSetIssue,
  ProjectedWorkItemRelationship,
  WorkItemChangeSetIdentity,
  WorkItemChangeSetRelationshipIdentity,
} from 'src/generated';

export type IssueLayer = ProjectedWorkItemChangeSetIssue.LayerEnum;
export type ProjectedNode = ProjectedWorkItem & {
  parent?: WorkItemChangeSetIdentity;
};
export type ProjectedEdge = ProjectedWorkItemRelationship;

export type ProjectionState = {
  nodes: Map<string, ProjectedNode>;
  relationships: Map<string, ProjectedEdge>;
  identityLabels: Record<string, string>;
  issues: ProjectedWorkItemChangeSetIssue[];
  warnings: ProjectedWorkItemChangeSetIssue[];
  layoutEntries: Map<string, Set<string>>;
  deletedLayoutRoots: Set<string>;
  unavailableWorkItemIds: Set<string>;
};

export type ProjectedTaskRecord = Task & {
  sections: Array<{
    key: string;
    materializedMarkdown: string | null;
  }>;
  serviceRelations: Array<{ serviceId: string }>;
};

export type NodeKey = string;
export type RelKey = string;

/**
 * What applying an operation decided without mutating state. Application owns
 * the gating; the matching rules report it.
 */
export type ApplyOutcome =
  | { kind: 'unavailableType'; index: number; type: string }
  | { kind: 'unresolvedNode'; field: string; key: NodeKey }
  | { kind: 'unresolvedRelationship'; field: string; key: RelKey }
  | { kind: 'unsupportedSectionClear'; sectionKey: string; type: string }
  | { kind: 'requirementsSectionClear' }
  | { kind: 'invalidLayoutSection'; sectionKey: string; type: string };

/** Facts-phase and apply-phase results that rules report. */
export type ProjectionFindings = {
  /** Directly named existing ids the facts phase did not find. */
  namedMissing: string[];
  /** Directly named existing ids whose type is unavailable in the project. */
  namedUnavailable: { id: string; type: string }[];
  /** Caller-supplied overlay nodes, which count as present in the request. */
  overlayNodes: Set<NodeKey>;
  overlayRelationships: Set<RelKey>;
  applied: ApplyOutcome[];
};

export function createProjectionFindings(): ProjectionFindings {
  return {
    namedMissing: [],
    namedUnavailable: [],
    overlayNodes: new Set(),
    overlayRelationships: new Set(),
    applied: [],
  };
}

export function nodeKey(
  identity: WorkItemChangeSetIdentity | null | undefined,
): NodeKey {
  if (!identity) return '';
  return identity.refType === 'existing'
    ? `existing:${identity.id}`
    : `temporary:${identity.tempId}`;
}

export function relKey(
  identity: WorkItemChangeSetRelationshipIdentity,
): RelKey {
  return identity.refType === 'existing'
    ? `existing:${identity.id}`
    : `temporary:${identity.tempId}`;
}

/** The persisted id behind an existing key, or undefined for temporary keys. */
export function existingId(key: NodeKey): string | undefined {
  return key.startsWith('existing:')
    ? key.slice('existing:'.length)
    : undefined;
}
