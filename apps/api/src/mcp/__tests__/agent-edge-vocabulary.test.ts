import {
  AGENT_EDGE_TYPES,
  EXCLUDED_AGENT_EDGE_TYPES,
  FREELY_AUTHORABLE_EDGE_TYPES,
  GET_EDGES_VISIBLE_EDGE_TYPES,
  WORKFLOW_FLOW_EDGE_TYPES,
  WORKFLOW_META_EDGE_TYPES,
} from '../tools/agent-edge-vocabulary';
import { AgentEdgeType } from '../../generated/model/agentEdgeType';
import { createEdgeParameters } from '../tools/edge-tools.provider';

// agent-edge-vocabulary.ts is declared as the single source of truth for which
// edge types the agent surface offers. These tests pin the partition (its
// concrete membership and disjointness) and pin that create_edge's offered
// vocabulary tracks the freely-authorable subset rather than carrying a
// hand-typed enum that could silently drift.

describe('agent-edge-vocabulary partition', () => {
  it('AGENT_EDGE_TYPES is exactly the authorable set', () => {
    expect([...AGENT_EDGE_TYPES].sort()).toEqual([
      'CONTRADICTS',
      'DEPENDS_ON',
      'DERIVES_FROM',
      'EVOLVES',
      'RELATED_TO',
      'SUPERSEDES',
    ]);
  });

  it('EXCLUDED_AGENT_EDGE_TYPES is exactly the excluded set', () => {
    expect([...EXCLUDED_AGENT_EDGE_TYPES].sort()).toEqual([
      'CONDITIONAL',
      'CONSUMES',
      'FULFILLED_BY',
      'GUARANTEES',
      'IMPLEMENTS',
      'LOOP',
      'PROPOSED_TOGETHER',
      'STANDARD',
      'TRACKS',
    ]);
  });

  it('partitions workflow edges into visible meta and flow-only groups', () => {
    expect([...WORKFLOW_META_EDGE_TYPES]).toEqual([
      'FULFILLED_BY',
      'GUARANTEES',
      'IMPLEMENTS',
      'CONSUMES',
    ]);
    expect([...WORKFLOW_FLOW_EDGE_TYPES].sort()).toEqual([
      'CONDITIONAL',
      'LOOP',
      'STANDARD',
    ]);
    expect([...GET_EDGES_VISIBLE_EDGE_TYPES].sort()).toEqual([
      'CONDITIONAL',
      'CONSUMES',
      'CONTRADICTS',
      'DEPENDS_ON',
      'DERIVES_FROM',
      'EVOLVES',
      'FULFILLED_BY',
      'GUARANTEES',
      'IMPLEMENTS',
      'LOOP',
      'RELATED_TO',
      'STANDARD',
      'SUPERSEDES',
    ]);
  });

  it('union of authorable and excluded equals the generated AgentEdgeType enum', () => {
    const partitionMembers = new Set<string>([
      ...AGENT_EDGE_TYPES,
      ...EXCLUDED_AGENT_EDGE_TYPES,
    ]);
    const enumMembers = new Set<string>(Object.values(AgentEdgeType));

    expect([...partitionMembers].sort()).toEqual([...enumMembers].sort());
  });

  it('authorable and excluded sets are disjoint', () => {
    const authorable = new Set<string>(AGENT_EDGE_TYPES);
    const overlap = EXCLUDED_AGENT_EDGE_TYPES.filter((t) => authorable.has(t));
    expect(overlap).toEqual([]);
  });
});

describe('create_edge vocabulary contract', () => {
  it("create_edge's type enum equals the freely-authorable subset", () => {
    // The zod enum on create_edge's `type` parameter is the agent's only path
    // to authoring a raw edge. If it diverges from FREELY_AUTHORABLE_EDGE_TYPES,
    // the MCP surface has a hand-typed list that can rot — exactly what the
    // shared vocabulary module exists to prevent.
    const typeField = createEdgeParameters.shape.type;
    const offered = (typeField._def as { values: readonly string[] }).values;
    expect([...offered].sort()).toEqual(
      [...FREELY_AUTHORABLE_EDGE_TYPES].sort(),
    );
  });

  it('create_edge does not offer SUPERSEDES', () => {
    // SUPERSEDES must flow through the supersede transition, not raw
    // create_edge. Pin this explicitly so a future "just add SUPERSEDES back"
    // edit fails the test instead of silently re-opening the back door.
    expect(FREELY_AUTHORABLE_EDGE_TYPES).not.toContain('SUPERSEDES');
  });

  it('create_edge does not offer any excluded type', () => {
    const excluded = new Set<string>(EXCLUDED_AGENT_EDGE_TYPES);
    const leaked = FREELY_AUTHORABLE_EDGE_TYPES.filter((t) => excluded.has(t));
    expect(leaked).toEqual([]);
  });
});
