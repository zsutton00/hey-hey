import { describe, expect, it } from "vitest";
import { AgentEdgeType, RelationshipValue } from "../../../api";
import {
  AGENT_EDGE_TYPE_FALLBACK_LABELS,
  AGENT_EDGE_TYPE_INVERSE_FALLBACK_LABELS,
  RELATIONSHIP_LABELS,
  agentEdgeTypeToRelationshipValue,
  formatRelationshipLabel,
  isRelationshipValue,
} from "../relationshipLabels";

describe("RELATIONSHIP_LABELS", () => {
  it("has an entry for every RelationshipValue enum member", () => {
    for (const value of Object.values(RelationshipValue)) {
      expect(
        RELATIONSHIP_LABELS[value],
        `missing label for ${value}`
      ).toBeTypeOf("string");
      expect(RELATIONSHIP_LABELS[value].length).toBeGreaterThan(0);
    }
  });

  it("renders curated text for the key labels", () => {
    expect(RELATIONSHIP_LABELS[RelationshipValue.DependsOn]).toBe("Depends on");
    expect(RELATIONSHIP_LABELS[RelationshipValue.Supersedes]).toBe(
      "Supersedes"
    );
    expect(RELATIONSHIP_LABELS[RelationshipValue.DerivesFrom]).toBe(
      "Derives from"
    );
    expect(RELATIONSHIP_LABELS[RelationshipValue.SiblingViaParent]).toBe(
      "Sibling"
    );
    expect(RELATIONSHIP_LABELS[RelationshipValue.ProposedTogether]).toBe(
      "Proposed together"
    );
  });
});

describe("formatRelationshipLabel", () => {
  it("delegates to RELATIONSHIP_LABELS", () => {
    expect(formatRelationshipLabel(RelationshipValue.MentionedBy)).toBe(
      "Mentioned by"
    );
    expect(formatRelationshipLabel(RelationshipValue.CreatedVia)).toBe(
      "Created via"
    );
    expect(formatRelationshipLabel(RelationshipValue.Parent)).toBe("Parent");
  });
});

describe("isRelationshipValue", () => {
  it("recognises every RelationshipValue member", () => {
    for (const value of Object.values(RelationshipValue)) {
      expect(isRelationshipValue(value)).toBe(true);
    }
  });

  it("returns false for non-RelationshipValue strings", () => {
    expect(isRelationshipValue("explicit_mention")).toBe(false);
    expect(isRelationshipValue("")).toBe(false);
  });
});

describe("agentEdgeTypeToRelationshipValue", () => {
  it("maps the six convertible AgentEdgeType members", () => {
    expect(agentEdgeTypeToRelationshipValue(AgentEdgeType.DependsOn)).toBe(
      RelationshipValue.DependsOn
    );
    expect(agentEdgeTypeToRelationshipValue(AgentEdgeType.RelatedTo)).toBe(
      RelationshipValue.RelatedTo
    );
    expect(agentEdgeTypeToRelationshipValue(AgentEdgeType.DerivesFrom)).toBe(
      RelationshipValue.DerivesFrom
    );
    expect(agentEdgeTypeToRelationshipValue(AgentEdgeType.Supersedes)).toBe(
      RelationshipValue.Supersedes
    );
    expect(agentEdgeTypeToRelationshipValue(AgentEdgeType.Contradicts)).toBe(
      RelationshipValue.Contradicts
    );
    expect(
      agentEdgeTypeToRelationshipValue(AgentEdgeType.ProposedTogether)
    ).toBe(RelationshipValue.ProposedTogether);
  });

  it("returns null for EVOLVES and TRACKS", () => {
    expect(agentEdgeTypeToRelationshipValue(AgentEdgeType.Evolves)).toBeNull();
    expect(agentEdgeTypeToRelationshipValue(AgentEdgeType.Tracks)).toBeNull();
  });
});

describe("AGENT_EDGE_TYPE_FALLBACK_LABELS", () => {
  it("labels EVOLVES and TRACKS for the EntityListItem fallback", () => {
    expect(AGENT_EDGE_TYPE_FALLBACK_LABELS[AgentEdgeType.Evolves]).toBe(
      "Evolves"
    );
    expect(AGENT_EDGE_TYPE_FALLBACK_LABELS[AgentEdgeType.Tracks]).toBe(
      "Tracks"
    );
  });
});

describe("AGENT_EDGE_TYPE_INVERSE_FALLBACK_LABELS", () => {
  it("labels EVOLVES as 'Evolved by' for the incoming direction", () => {
    expect(AGENT_EDGE_TYPE_INVERSE_FALLBACK_LABELS[AgentEdgeType.Evolves]).toBe(
      "Evolved by"
    );
  });
});
