import { ProposalToolsProvider } from '../tools/proposal-tools.provider';
import { AUTHORING_ROOT_PROOF } from '../tools/authoring-guidance';
import {
  GUIDANCE_TOKEN_FIELD,
  carriesProseQualityFields,
  guidanceTokenForType,
  validateGuidanceToken,
} from '../tools/work-item-guidance-token';
import type { ProposalService } from '../../services/proposal/proposal.service';
import type { TaskService } from '../../services/tasks/task.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { createWarmWorkItemTypeRegistry } from '../../../test/setup/work-item-type-registry.fixture';

let workItemTypeRegistry: WorkItemTypeRegistryService;
beforeAll(async () => {
  workItemTypeRegistry = await createWarmWorkItemTypeRegistry();
});

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const OTHER_PROJECT_ID = '123e4567-e89b-42d3-a456-426614174003';
const TASK_ID = '00000000-0000-4000-8000-000000000010';
const PARENT_ID = '00000000-0000-4000-8000-000000000011';
const PROPOSAL_ID = '00000000-0000-4000-8000-000000000020';

function makeUser() {
  return {
    userId: 'u1',
    email: 'test@example.com',
    name: 'Test',
    currentOrgId: ORG_ID,
    orgMemberships: [],
    isDevAdmin: false,
    devAdminMode: false,
  };
}

function makeRequest() {
  return {
    headers: { authorization: 'Bearer tok', 'x-project-id': PROJECT_ID },
    cookies: {},
    user: makeUser(),
    ip: '127.0.0.1',
  } as any;
}

function makeProposal(overrides: Record<string, any> = {}) {
  return {
    id: PROPOSAL_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    type: 'SINGLE',
    action: 'CREATE',
    status: 'DRAFT',
    targetEntityId: TASK_ID,
    targetEntityType: 'TASK',
    updates: {},
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    ...overrides,
  };
}

function createProvider(
  opts: {
    proposalCreate?: jest.Mock;
    proposalUpdate?: jest.Mock;
    taskFindOne?: jest.Mock;
  } = {},
) {
  const proposalCreate = opts.proposalCreate ?? jest.fn();
  const proposalUpdate = opts.proposalUpdate ?? jest.fn();
  const taskFindOne = opts.taskFindOne ?? jest.fn();
  const proposalService = {
    create: proposalCreate,
    update: proposalUpdate,
    findOne: jest.fn(),
  } as unknown as ProposalService;
  const taskService = {
    findOne: taskFindOne,
  } as unknown as TaskService;
  const lintRecovery = {
    markNeedsRevision: jest.fn().mockResolvedValue(undefined),
    consumeRecovery: jest.fn().mockResolvedValue(false),
  } as any;
  const prisma = {
    db: {
      task: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      designDoc: { findMany: jest.fn().mockResolvedValue([]) },
    },
  } as any;
  const provider = new ProposalToolsProvider(
    proposalService,
    taskService,
    lintRecovery,
    workItemTypeRegistry,
    prisma,
  );
  return {
    provider,
    proposalCreate,
    proposalUpdate,
    taskFindOne,
  };
}

// A long-enough description to clear the lint paragraph/length rules, so a
// gate-passing call reaches the `proposed` branch rather than tripping lint.
const GOOD_DESCRIPTION =
  'This work adds a concrete capability to the surface and explains, in a ' +
  'single declarative paragraph, what the delivered behavior is so a reader ' +
  'understands the outcome without reconstructing it from the diff.';

describe('work-item-guidance-token — token derivation', () => {
  it('is deterministic per type', () => {
    expect(guidanceTokenForType('STANDARD', PROJECT_ID)).toBe(
      guidanceTokenForType('STANDARD', PROJECT_ID),
    );
  });

  it('is scoped to the project as well as the work-item type', () => {
    expect(guidanceTokenForType('STANDARD', PROJECT_ID)).not.toBe(
      guidanceTokenForType('STANDARD', OTHER_PROJECT_ID),
    );
  });

  it('differs across types', () => {
    const tokens = new Set([
      guidanceTokenForType('STANDARD', PROJECT_ID),
      guidanceTokenForType('FEATURE', PROJECT_ID),
      guidanceTokenForType('GOAL', PROJECT_ID),
      guidanceTokenForType('BUG', PROJECT_ID),
    ]);
    expect(tokens.size).toBe(4);
  });

  it('normalizes casing so the workItemType an agent reads matches the resolved type', () => {
    expect(guidanceTokenForType('standard', PROJECT_ID)).toBe(
      guidanceTokenForType('STANDARD', PROJECT_ID),
    );
  });

  it('derives a token for any string — custom registry types are gated too', () => {
    expect(guidanceTokenForType('RESEARCH', PROJECT_ID)).toMatch(
      /^gtg-research-[0-9a-f]+$/,
    );
  });
});

describe('work-item-guidance-token — prose-quality detection', () => {
  it('treats a non-empty sections array as prose-quality', () => {
    expect(
      carriesProseQualityFields({ sections: [{ key: 'description' }] }),
    ).toBe(true);
  });

  it('treats a non-empty implementation string as prose-quality', () => {
    expect(carriesProseQualityFields({ implementation: 'touch foo.ts' })).toBe(
      true,
    );
  });

  it('ignores a whitespace-only implementation string', () => {
    expect(carriesProseQualityFields({ implementation: '   ' })).toBe(false);
  });

  it('treats an empty/absent payload as scalar-only', () => {
    expect(carriesProseQualityFields({})).toBe(false);
    expect(carriesProseQualityFields({ sections: [] })).toBe(false);
  });

  it('treats FEATURE requirement authoring as prose-quality', () => {
    expect(carriesProseQualityFields({ requirementProse: true })).toBe(true);
  });

  it('stays scalar-only when requirementProse is false/absent', () => {
    expect(carriesProseQualityFields({ requirementProse: false })).toBe(false);
  });
});

describe('work-item-guidance-token — validateGuidanceToken', () => {
  it('passes scalar-only calls without a token', () => {
    expect(
      validateGuidanceToken({
        toolName: 'edit_work_item',
        type: 'STANDARD',
        projectId: PROJECT_ID,
        token: undefined,
      }),
    ).toBeNull();
  });

  it('rejects a prose-bearing call with a missing token, naming the retry call', () => {
    const err = validateGuidanceToken({
      toolName: 'create_work_item',
      type: 'STANDARD',
      projectId: PROJECT_ID,
      token: undefined,
      sections: [{ key: 'description' }],
    });
    expect(err).toContain(GUIDANCE_TOKEN_FIELD);
    expect(err).toContain(
      'get_tool_guidance({ toolName: "create_work_item", workItemType: "STANDARD" })',
    );
  });

  it('rejects a mismatched token, naming the retry call for the resolved type', () => {
    const err = validateGuidanceToken({
      toolName: 'edit_work_item',
      type: 'BUG',
      projectId: PROJECT_ID,
      token: guidanceTokenForType('STANDARD', PROJECT_ID),
      sections: [{ key: 'description' }],
    });
    expect(err).toContain(
      'get_tool_guidance({ toolName: "edit_work_item", workItemType: "BUG" })',
    );
  });

  it('passes a matching token for the resolved type', () => {
    expect(
      validateGuidanceToken({
        toolName: 'create_work_item',
        type: 'STANDARD',
        projectId: PROJECT_ID,
        token: guidanceTokenForType('STANDARD', PROJECT_ID),
        sections: [{ key: 'description' }],
      }),
    ).toBeNull();
  });

  it('rejects a token issued for another project', () => {
    const err = validateGuidanceToken({
      toolName: 'create_work_item',
      type: 'STANDARD',
      projectId: PROJECT_ID,
      token: guidanceTokenForType('STANDARD', OTHER_PROJECT_ID),
      sections: [{ key: 'description' }],
    });
    expect(err).toContain(`proof-of-read token for project ${PROJECT_ID}`);
  });

  it('gates FEATURE requirement authoring (requirementProse) with no token', () => {
    const err = validateGuidanceToken({
      toolName: 'edit_work_item',
      type: 'FEATURE',
      projectId: PROJECT_ID,
      token: undefined,
      requirementProse: true,
    });
    expect(err).toContain(
      'get_tool_guidance({ toolName: "edit_work_item", workItemType: "FEATURE" })',
    );
  });
});

describe('create_work_item — proof-of-read token gate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects a sections-bearing create with no token', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      {
        type: 'STANDARD',
        name: 'Add the field',
        parentTaskId: PARENT_ID,
        sections: [{ key: 'description', content: GOOD_DESCRIPTION }],
        authoringRootProof: AUTHORING_ROOT_PROOF,
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'get_tool_guidance({ toolName: "create_work_item", workItemType: "STANDARD" })',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects a sections-bearing create with a token for the wrong type', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      {
        type: 'STANDARD',
        name: 'Add the field',
        parentTaskId: PARENT_ID,
        sections: [{ key: 'description', content: GOOD_DESCRIPTION }],
        authoringRootProof: AUTHORING_ROOT_PROOF,
        guidanceToken: guidanceTokenForType('BUG', PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('does not match');
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('accepts a sections-bearing create with a matching token', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(makeProposal());
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        type: 'STANDARD',
        name: 'Add the field',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [
          { key: 'description', content: GOOD_DESCRIPTION },
          { key: 'acceptanceCriteria', content: 'The field is added.' },
        ],
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    expect((result as any).status).toBe('proposed');
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });

  it('gates an implementation-only create the same as a sections create', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      {
        type: 'STANDARD',
        name: 'Add the field',
        parentTaskId: PARENT_ID,
        sections: [{ key: 'description', content: GOOD_DESCRIPTION }],
        authoringRootProof: AUTHORING_ROOT_PROOF,
        implementation: 'Touch src/foo.ts.',
        // no token
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(GUIDANCE_TOKEN_FIELD);
    expect(proposalCreate).not.toHaveBeenCalled();
  });
});

describe('edit_work_item — proof-of-read token gate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects a sections-bearing edit with no token, naming the resolved type', async () => {
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: TASK_ID, type: 'BUG', sections: [] });
    const { provider, proposalCreate } = createProvider({ taskFindOne });

    const result = await provider.editWorkItem(
      {
        targetEntityId: TASK_ID,
        sections: [{ key: 'description', content: GOOD_DESCRIPTION }],
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    // Validated against the server-resolved type (BUG), not anything the
    // caller assumed.
    expect((result as any).content[0].text).toContain(
      'get_tool_guidance({ toolName: "edit_work_item", workItemType: "BUG" })',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('accepts a sections-bearing edit with a token matching the resolved type', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: TASK_ID, type: 'STANDARD', sections: [] });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        targetEntityId: TASK_ID,
        sections: [{ key: 'description', content: GOOD_DESCRIPTION }],
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    expect((result as any).status).toBe('proposed');
  });

  it('proposes two independent edits with their own targets and preserves inert flags', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const taskFindOne = jest.fn().mockImplementation(async (_org, id) => ({
      id,
      type: 'STANDARD',
      sections: [],
    }));
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    for (const targetEntityId of [TASK_ID, PARENT_ID]) {
      const result = await provider.editWorkItem(
        {
          eli5: 'Updates the selected item independently.',
          targetEntityId,
          sections: [{ key: 'description', content: GOOD_DESCRIPTION }],
          guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
          ragEnabled: false,
          applicationEligible: false,
        },
        {} as any,
        makeRequest(),
      );
      expect(result).toMatchObject({ status: 'proposed' });
    }

    expect(proposalCreate).toHaveBeenCalledTimes(2);
    for (const [index, targetEntityId] of [TASK_ID, PARENT_ID].entries()) {
      expect(proposalCreate.mock.calls[index][3]).toMatchObject({
        targetEntityId,
        ragEnabled: false,
        applicationEligible: false,
        updates: {
          sections: [{ key: 'description', content: GOOD_DESCRIPTION }],
        },
      });
    }
  });

  it('lets a scalar-only edit through with no token', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: TASK_ID, type: 'STANDARD', sections: [] });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      { targetEntityId: TASK_ID, status: 'ACTIVE' } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    expect((result as any).status).toBe('proposed');
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });
});

describe('FEATURE requirement authoring — proof-of-read token gate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('gates a create carrying initialRequirements with no token', async () => {
    // The token gate runs before field validation, so an initialRequirements
    // payload trips the gate first — even without the description/AC sections a
    // FEATURE create would also need. This isolates the requirement-prose lane.
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      {
        type: 'FEATURE',
        name: 'Plans',
        tag: 'product',
        initialRequirements: [{ requirement: 'The system does X' }],
        // no token
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'get_tool_guidance({ toolName: "create_work_item", workItemType: "FEATURE" })',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('gates an edit carrying requirementOps with no token', async () => {
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: TASK_ID, type: 'FEATURE', sections: [] });
    const { provider, proposalCreate } = createProvider({ taskFindOne });

    const result = await provider.editWorkItem(
      {
        targetEntityId: TASK_ID,
        requirementOps: [
          { op: 'add', value: { requirement: 'The system does Y' } },
        ],
        authoringRootProof: AUTHORING_ROOT_PROOF,
        // no token
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'get_tool_guidance({ toolName: "edit_work_item", workItemType: "FEATURE" })',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects a topology-bearing create before checking the scoped token when the root proof is missing', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      {
        type: 'STANDARD',
        name: 'Add the field',
        parentTaskId: PARENT_ID,
        sections: [{ key: 'description', content: GOOD_DESCRIPTION }],
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'get_authoring_guidance()',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects a topology-bearing create with a mismatched root proof', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      {
        type: 'STANDARD',
        name: 'Add the field',
        parentTaskId: PARENT_ID,
        sections: [{ key: 'description', content: GOOD_DESCRIPTION }],
        authoringRootProof: 'stale-root-proof',
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('does not match');
    expect(proposalCreate).not.toHaveBeenCalled();
  });
});

describe('non-work-item proposal topology root proof gate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects create_design_doc when it assigns a parent without the root proof', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createDesignDoc(
      {
        name: 'Design doc',
        content: GOOD_DESCRIPTION,
        parentEntityId: PARENT_ID,
        parentEntityType: 'TASK',
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'get_authoring_guidance()',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects edit_design_doc when it changes parentage without the root proof', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.editDesignDoc(
      {
        targetEntityId: TASK_ID,
        sections: [{ key: 'content', content: GOOD_DESCRIPTION }],
        parentEntityId: null,
        parentEntityType: null,
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'get_authoring_guidance()',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects update_proposal when it changes a pending work-item parent without the root proof', async () => {
    const { provider, proposalUpdate } = createProvider();

    const result = await provider.updateProposal(
      {
        proposalId: PROPOSAL_ID,
        updates: { parentTaskId: PARENT_ID },
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'get_authoring_guidance()',
    );
    expect(proposalUpdate).not.toHaveBeenCalled();
  });
});
