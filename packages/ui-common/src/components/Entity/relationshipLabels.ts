import { AgentEdgeType, RelationshipValue } from "../../api";

export const RELATIONSHIP_LABELS: Record<RelationshipValue, string> = {
  [RelationshipValue.DependsOn]: "Depends on",
  [RelationshipValue.DependedOnBy]: "Depended on by",
  [RelationshipValue.Blocks]: "Blocks",
  [RelationshipValue.BlockedBy]: "Blocked by",
  [RelationshipValue.SupersededBy]: "Superseded by",
  [RelationshipValue.Supersedes]: "Supersedes",
  [RelationshipValue.DerivesFrom]: "Derives from",
  [RelationshipValue.DerivedFromBy]: "Derived from by",
  [RelationshipValue.Contradicts]: "Contradicts",
  [RelationshipValue.RelatedTo]: "Related to",
  [RelationshipValue.Mentions]: "Mentions",
  [RelationshipValue.MentionedBy]: "Mentioned by",
  [RelationshipValue.CreatedVia]: "Created via",
  [RelationshipValue.ProposedTogether]: "Proposed together",
  [RelationshipValue.SiblingViaParent]: "Sibling",
  [RelationshipValue.Parent]: "Parent",
  [RelationshipValue.Evolves]: "Evolves",
  [RelationshipValue.EvolvedBy]: "Evolved by",
  [RelationshipValue.Tracks]: "Tracks",
  [RelationshipValue.TrackedBy]: "Tracked by",
};

export const AGENT_EDGE_TYPE_FALLBACK_LABELS: Partial<
  Record<AgentEdgeType, string>
> = {
  [AgentEdgeType.Evolves]: "Evolves",
  [AgentEdgeType.Tracks]: "Tracks",
};

export const AGENT_EDGE_TYPE_INVERSE_FALLBACK_LABELS: Partial<
  Record<AgentEdgeType, string>
> = {
  [AgentEdgeType.Evolves]: "Evolved by",
};

const KNOWN_RELATIONSHIP_VALUES: Set<string> = new Set(
  Object.values(RelationshipValue)
);

export const isRelationshipValue = (
  value: string
): value is RelationshipValue => KNOWN_RELATIONSHIP_VALUES.has(value);

export const formatRelationshipLabel = (value: RelationshipValue): string =>
  RELATIONSHIP_LABELS[value];

export const agentEdgeTypeToRelationshipValue = (
  edge: AgentEdgeType
): RelationshipValue | null => {
  switch (edge) {
    case AgentEdgeType.DependsOn:
      return RelationshipValue.DependsOn;
    case AgentEdgeType.RelatedTo:
      return RelationshipValue.RelatedTo;
    case AgentEdgeType.DerivesFrom:
      return RelationshipValue.DerivesFrom;
    case AgentEdgeType.Supersedes:
      return RelationshipValue.Supersedes;
    case AgentEdgeType.Contradicts:
      return RelationshipValue.Contradicts;
    case AgentEdgeType.ProposedTogether:
      return RelationshipValue.ProposedTogether;
    default:
      return null;
  }
};
