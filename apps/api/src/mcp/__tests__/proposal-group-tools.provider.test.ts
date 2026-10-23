import { ProposalGroupToolsProvider } from '../tools/proposal-group-tools.provider';
import { proposalGroupContextSchema } from '../tools/proposal-group-tool.schemas';
import { AUTHORING_ROOT_PROOF } from '../tools/authoring-guidance';

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const GROUP_ID = '00000000-0000-4000-8000-000000000003';
const MEMBER_ID = '00000000-0000-4000-8000-000000000004';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000006';

const makeRequest = () =>
  ({
    headers: {
      authorization: 'Bearer token',
      'x-project-id': PROJECT_ID,
      'x-conversation-id': CONVERSATION_ID,
    },
    user: {
      userId: '00000000-0000-4000-8000-000000000005',
      email: 'agent@example.com',
      name: 'Agent',
      currentOrgId: ORGANIZATION_ID,
      orgMemberships: [],
      isDevAdmin: false,
      devAdminMode: false,
    },
    cookies: {},
  }) as any;

const snapshot = (revision = 0) =>
  ({
    groupId: GROUP_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    lifecycle: 'BUILDING',
    currentRevision: revision,
    members: [],
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
  }) as any;

const createProvider = () => {
  const authoring = {
    start: jest.fn(),
    replacePrerequisites: jest.fn(),
    removeMember: jest.fn(),
  };
  const finalization = {
    finalize: jest.fn(),
    takeFrozenTopologyLintFindings: jest.fn().mockReturnValue([]),
  };
  const groups = { findCanonical: jest.fn() };
  return {
    provider: new ProposalGroupToolsProvider(
      authoring as any,
      finalization as any,
      groups as any,
    ),
    authoring,
    finalization,
    groups,
  };
};

describe('ProposalGroupToolsProvider', () => {
  it('requires callers to translate snapshot currentRevision to expectedRevision', () => {
    expect(
      proposalGroupContextSchema.safeParse({
        groupId: GROUP_ID,
        expectedRevision: 4,
      }).success,
    ).toBe(true);
    expect(
      proposalGroupContextSchema.safeParse({
        groupId: GROUP_ID,
        currentRevision: 4,
      }).success,
    ).toBe(false);
    expect(proposalGroupContextSchema.description).toContain(
      'Set expectedRevision to the currentRevision returned',
    );
    expect(
      proposalGroupContextSchema.shape.expectedRevision.description,
    ).toContain('do not send currentRevision as a groupContext key');
  });

  it('starts one explicitly scoped hidden group and returns its snapshot', async () => {
    const { provider, authoring } = createProvider();
    authoring.start.mockResolvedValue(snapshot());

    await expect(
      provider.start(
        { authoringRootProof: AUTHORING_ROOT_PROOF },
        {} as any,
        makeRequest(),
      ),
    ).resolves.toEqual(snapshot());
    expect(authoring.start).toHaveBeenCalledWith(ORGANIZATION_ID, PROJECT_ID, {
      originatingConversationId: undefined,
    });
  });

  it('rejects a supplied conversation outside the authenticated MCP context', async () => {
    const { provider, authoring } = createProvider();

    const result = await provider.start(
      {
        authoringRootProof: AUTHORING_ROOT_PROOF,
        originatingConversationId: '00000000-0000-4000-8000-000000000099',
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'must match the authenticated MCP conversation context',
    );
    expect(authoring.start).not.toHaveBeenCalled();
  });

  it('reads only the explicitly identified BUILDING group', async () => {
    const { provider, groups } = createProvider();
    groups.findCanonical.mockResolvedValue(snapshot(3));

    const result = await provider.getAuthoringSnapshot(
      { groupId: GROUP_ID },
      {} as any,
      makeRequest(),
    );

    expect(result).toEqual(snapshot(3));
    expect(groups.findCanonical).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
    );
  });

  it('passes the explicit group identity and current revision to mutations', async () => {
    const { provider, authoring } = createProvider();
    authoring.replacePrerequisites.mockResolvedValue(snapshot(5));

    await provider.replacePrerequisites(
      {
        groupContext: { groupId: GROUP_ID, expectedRevision: 4 },
        memberId: MEMBER_ID,
        prerequisiteMemberIds: [],
        authoringRootProof: AUTHORING_ROOT_PROOF,
      },
      {} as any,
      makeRequest(),
    );

    expect(authoring.replacePrerequisites).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      MEMBER_ID,
      { expectedRevision: 4, prerequisiteMemberIds: [] },
    );
  });

  it('returns every finalization issue without changing the failed result', async () => {
    const { provider, finalization } = createProvider();
    finalization.finalize.mockResolvedValue({
      outcome: 'VALIDATION_FAILED',
      authoringSnapshot: snapshot(2),
      issues: [
        {
          code: 'MEMBER_REFERENCE_UNRESOLVED',
          location: '/members/0/proposal/updates/parentTaskId',
          memberId: MEMBER_ID,
          message: 'Reference is unresolved.',
        },
        {
          code: 'DEPENDENCY_CYCLE',
          location: '/members/0/prerequisiteMemberIds',
          memberId: MEMBER_ID,
          message: 'Dependency cycle.',
        },
      ],
    });

    const result = await provider.finalize(
      {
        groupContext: { groupId: GROUP_ID, expectedRevision: 2 },
        authoringRootProof: AUTHORING_ROOT_PROOF,
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).outcome).toBe('VALIDATION_FAILED');
    expect((result as any).issues).toHaveLength(2);
    expect(finalization.finalize).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      makeRequest().user,
      { expectedRevision: 2 },
    );
  });

  it('returns advisory warnings without changing successful finalization', async () => {
    const { provider, finalization } = createProvider();
    finalization.finalize.mockResolvedValue({
      outcome: 'FINALIZED',
      group: { ...snapshot(3), lifecycle: 'REVIEWABLE' },
    });
    finalization.takeFrozenTopologyLintFindings.mockReturnValue([
      {
        rule: 'workflow_step_missing_fulfillment',
        severity: 'warning',
        path: 'projected.nodes[existing:step].relationships',
        message: 'Missing fulfillment.',
        suggestion: 'Add FULFILLED_BY.',
      },
    ]);

    const result = await provider.finalize(
      {
        groupContext: { groupId: GROUP_ID, expectedRevision: 3 },
        authoringRootProof: AUTHORING_ROOT_PROOF,
      },
      {} as any,
      makeRequest(),
    );

    expect(result).toMatchObject({
      outcome: 'FINALIZED',
      lintFindings: [
        expect.objectContaining({
          rule: 'workflow_step_missing_fulfillment',
          severity: 'warning',
        }),
      ],
    });
  });
});
