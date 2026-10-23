import {
  agentEdgeToRelationship,
  AGENT_EDGE_RELATIONSHIP_TYPES,
  FLOW_AGENT_EDGE_RELATIONSHIP_TYPES,
  isAgentEdgeRelationshipType,
  isFlowAgentEdgeRelationshipType,
} from '../relationship-mapping';

describe('AGENT_EDGE_RELATIONSHIP_TYPES', () => {
  it('includes EVOLVES', () => {
    expect(AGENT_EDGE_RELATIONSHIP_TYPES).toContain('EVOLVES');
  });

  it('classifies FULFILLED_BY as meta and workflow sequencing edges as flow', () => {
    expect(isAgentEdgeRelationshipType('FULFILLED_BY')).toBe(true);
    expect(agentEdgeToRelationship('FULFILLED_BY', 'outbound')).toBe(
      'related-to',
    );
    expect(agentEdgeToRelationship('FULFILLED_BY', 'inbound')).toBe(
      'related-to',
    );

    for (const edgeType of FLOW_AGENT_EDGE_RELATIONSHIP_TYPES) {
      expect(isAgentEdgeRelationshipType(edgeType)).toBe(false);
      expect(isFlowAgentEdgeRelationshipType(edgeType)).toBe(true);
    }
  });
});

describe('agentEdgeToRelationship — EVOLVES direction convention', () => {
  it('outbound EVOLVES returns evolved-by (seed is the newer entity)', () => {
    expect(agentEdgeToRelationship('EVOLVES', 'outbound')).toBe('evolved-by');
  });

  it('inbound EVOLVES returns evolves (seed is the predecessor)', () => {
    expect(agentEdgeToRelationship('EVOLVES', 'inbound')).toBe('evolves');
  });

  it('follows the same direction convention as SUPERSEDES', () => {
    // SUPERSEDES: outbound → superseded-by, inbound → supersedes
    // EVOLVES:    outbound → evolved-by,    inbound → evolves
    // Both encode "what happened to the target" in the outbound label.
    expect(agentEdgeToRelationship('SUPERSEDES', 'outbound')).toBe(
      'superseded-by',
    );
    expect(agentEdgeToRelationship('SUPERSEDES', 'inbound')).toBe('supersedes');
    expect(agentEdgeToRelationship('EVOLVES', 'outbound')).toBe('evolved-by');
    expect(agentEdgeToRelationship('EVOLVES', 'inbound')).toBe('evolves');
  });
});
