import {
  createWorkItemParameters,
  editWorkItemParameters,
  getProposalOutput,
} from '../tools/proposal-tools.provider';
import { AGENT_EDGE_TYPES } from '../tools/agent-edge-vocabulary';
import { ProposalEdgeType } from '../../generated/model/proposalEdgeType';

// proposalEdgeDeclarationSchema (the create_work_item MCP boundary) exposes
// the full canonical AGENT_EDGE_TYPES set. Raw create_edge is narrower — it
// offers only the freely-authorable subset (SUPERSEDES excluded) because a
// bare SUPERSEDES skips the supersede transition. The proposal surface keeps
// SUPERSEDES because a declared SUPERSEDES on an approved proposal materializes
// through the supersede transition (status flip + edge), not through raw
// create_edge — so the contracts intentionally diverge. BLOCKS is retired
// entirely. These tests pin that consolidated invariant.

const UUID = '00000000-0000-0000-0000-000000000001';

const workItemEdges = createWorkItemParameters.shape.edges;
const editWorkItemEdges = editWorkItemParameters.shape.edges;

const declareEdge = (edgeType: string) => ({
  targetEntityId: UUID,
  targetEntityType: 'PROPOSAL' as const,
  edgeType,
});

describe('proposal edge declaration vocabulary', () => {
  it('exposes the full canonical AGENT_EDGE_TYPES set (SUPERSEDES included)', () => {
    expect([...AGENT_EDGE_TYPES].sort()).toEqual([
      'CONTRADICTS',
      'DEPENDS_ON',
      'DERIVES_FROM',
      'EVOLVES',
      'RELATED_TO',
      'SUPERSEDES',
    ]);
  });

  it.each(AGENT_EDGE_TYPES)(
    'create_work_item edges accept edgeType %s',
    (edgeType) => {
      const parsed = workItemEdges.parse([declareEdge(edgeType)]);
      expect(parsed?.[0]?.edgeType).toBe(edgeType);
    },
  );

  it.each(AGENT_EDGE_TYPES)(
    'edit_work_item edges accept edgeType %s',
    (edgeType) => {
      const parsed = editWorkItemEdges.parse([declareEdge(edgeType)]);
      expect(parsed?.[0]?.edgeType).toBe(edgeType);
    },
  );

  it.each([
    { refType: 'temporary' as const, tempId: 'diagram-element' },
    { refType: 'existing' as const, id: UUID },
  ])(
    'accepts a deferred sourceRef on edit but not on create: %j',
    (sourceRef) => {
      const declaration = { ...declareEdge('RELATED_TO'), sourceRef };

      expect(workItemEdges.safeParse([declaration]).success).toBe(false);
      expect(editWorkItemEdges.parse([declaration])?.[0]?.sourceRef).toEqual(
        sourceRef,
      );
    },
  );

  it('restricts sourceRef to deferred PROPOSAL targets', () => {
    expect(
      editWorkItemEdges.safeParse([
        {
          ...declareEdge('RELATED_TO'),
          targetEntityType: 'TASK',
          sourceRef: { refType: 'temporary', tempId: 'diagram-element' },
        },
      ]).success,
    ).toBe(false);
    expect(
      editWorkItemEdges.safeParse([
        {
          ...declareEdge('RELATED_TO'),
          endpointMode: 'PROPOSAL',
          sourceRef: { refType: 'existing', id: UUID },
        },
      ]).success,
    ).toBe(false);
  });

  it('returns sourceRef on proposal reads', () => {
    const sourceRef = { refType: 'temporary' as const, tempId: 'element-a' };
    const proposal = getProposalOutput.parse({
      id: UUID,
      status: 'DRAFT',
      action: 'CREATE',
      targetEntityType: 'TASK',
      targetEntityId: UUID,
      edges: [{ ...declareEdge('RELATED_TO'), sourceRef }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(proposal.edges?.[0]?.sourceRef).toEqual(sourceRef);
  });

  it('rejects the retired BLOCKS edge type on create_work_item', () => {
    expect(workItemEdges.safeParse([declareEdge('BLOCKS')]).success).toBe(
      false,
    );
  });

  it('keeps TRACKS out of generic edges and accepts the structured compound field', () => {
    expect(workItemEdges.safeParse([declareEdge('TRACKS')]).success).toBe(
      false,
    );
    expect(
      createWorkItemParameters.shape.tracks.parse({ sourceEntityId: UUID }),
    ).toEqual({ sourceEntityId: UUID });
    expect(ProposalEdgeType.Tracks).toBe('TRACKS');
  });

  it.each(['STANDARD', 'CONDITIONAL', 'LOOP', 'FULFILLED_BY'])(
    'keeps workflow edge type %s out of generic proposal edge declarations',
    (edgeType) => {
      expect(workItemEdges.safeParse([declareEdge(edgeType)]).success).toBe(
        false,
      );
      expect(editWorkItemEdges.safeParse([declareEdge(edgeType)]).success).toBe(
        false,
      );
    },
  );

  it('preserves ProposalEdgeType.Supersedes as the supersede-transition path', () => {
    // The transition itself emits ProposalEdgeType.Supersedes on the wire
    // (see task-supersede.service.ts). Accepting SUPERSEDES on the MCP
    // declaration vocabulary must not disturb the wire-side enum value.
    expect(ProposalEdgeType.Supersedes).toBe('SUPERSEDES');
  });
});
