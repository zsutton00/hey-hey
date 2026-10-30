import { ProposalToolsProvider } from '../tools/proposal-tools.provider';
import type { LintRecoveryStore } from '../tools/lint-recovery.store';
import type { ProposalService } from '../../services/proposal/proposal.service';
import type { TaskService } from '../../services/tasks/task.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { createWarmWorkItemTypeRegistry } from '../../../test/setup/work-item-type-registry.fixture';
import { guidanceTokenForType } from '../tools/work-item-guidance-token';
import { AUTHORING_ROOT_PROOF } from '../tools/authoring-guidance';

let workItemTypeRegistry: WorkItemTypeRegistryService;
beforeAll(async () => {
  workItemTypeRegistry = await createWarmWorkItemTypeRegistry();
});

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const TASK_ID = '00000000-0000-4000-8000-000000000010';
const FEATURE_ID = '00000000-0000-4000-8000-000000000011';
const PARENT_ID = '00000000-0000-4000-8000-000000000012';
const DESIGN_DOC_ID = '00000000-0000-4000-8000-000000000013';
const GOAL_ID = '00000000-0000-4000-8000-000000000014';
const BUG_ID = '00000000-0000-4000-8000-000000000015';
const PROPOSAL_ID = '00000000-0000-4000-8000-000000000020';

const SHORT_CONTENT = 'A tight, single-paragraph description.';
const FOUR_PARAGRAPHS = [
  'First paragraph here.',
  'Second paragraph here.',
  'Third paragraph here.',
  'Fourth paragraph that should trip the lint.',
].join('\n\n');

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
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    ...overrides,
  };
}

function createProvider(
  opts: {
    proposalCreate?: jest.Mock;
    taskFindOne?: jest.Mock;
    markNeedsRevision?: jest.Mock;
    consumeRecovery?: jest.Mock;
  } = {},
) {
  const proposalCreate = opts.proposalCreate ?? jest.fn();
  const taskFindOne = opts.taskFindOne ?? jest.fn();
  const proposalService = {
    create: proposalCreate,
    findOne: jest.fn(),
  } as unknown as ProposalService;
  const taskService = {
    findOne: taskFindOne,
  } as unknown as TaskService;
  // Default stub is Map-backed so the recovery test exercises the real
  // mark → consume sequence without touching Redis. Tests can override
  // either spy by passing it in.
  const recoveryMap = new Map<string, true>();
  const markNeedsRevision =
    opts.markNeedsRevision ??
    jest.fn(async (key: string) => {
      recoveryMap.set(key, true);
    });
  const consumeRecovery =
    opts.consumeRecovery ??
    jest.fn(async (key: string) => recoveryMap.delete(key));
  const lintRecovery = {
    markNeedsRevision,
    consumeRecovery,
  } as unknown as LintRecoveryStore;
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
    taskFindOne,
    markNeedsRevision,
    consumeRecovery,
  };
}

describe('proposal-tool lint v1 — clean path returns status:"proposed"', () => {
  beforeEach(() => jest.clearAllMocks());

  it('create_work_item (STANDARD): clean content persists and returns proposalId', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(makeProposal());
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'STANDARD',
        name: 'Tight task',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [
          { key: 'description', content: SHORT_CONTENT },
          { key: 'acceptanceCriteria', content: 'AC.' },
        ],
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect(result).toMatchObject({
      status: 'proposed',
      lintFindings: [],
      proposalId: PROPOSAL_ID,
    });
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });

  it('create_work_item (STANDARD): five AC bullets remain advisory and are not linted', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(makeProposal());
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'STANDARD',
        name: 'Task with extra criteria',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [
          { key: 'description', content: SHORT_CONTENT },
          {
            key: 'acceptanceCriteria',
            content: [
              '- First outcome.',
              '- Second outcome.',
              '- Third outcome.',
              '- Fourth outcome.',
              '- Fifth outcome.',
            ].join('\n'),
          },
        ],
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect(result).toMatchObject({
      status: 'proposed',
      lintFindings: [],
      proposalId: PROPOSAL_ID,
    });
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });

  it('create_work_item (FEATURE): clean content persists', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ targetEntityId: FEATURE_ID }));
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'FEATURE',
        name: 'Tight feature',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        tag: 'product',
        sections: [{ key: 'description', content: SHORT_CONTENT }],
        initialRequirements: [{ statement: 'A requirement.' }],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect(result).toMatchObject({
      status: 'proposed',
      lintFindings: [],
      proposalId: PROPOSAL_ID,
    });
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });

  it('edit_work_item (STANDARD target): clean content persists', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: TASK_ID, type: 'STANDARD', sections: [] });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: TASK_ID,
        sections: [{ key: 'description', content: SHORT_CONTENT }],
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect(result).toMatchObject({
      status: 'proposed',
      lintFindings: [],
      proposalId: PROPOSAL_ID,
    });
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });

  it('edit_work_item (FEATURE target): clean content persists', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: FEATURE_ID, type: 'FEATURE' });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: FEATURE_ID,
        sections: [{ key: 'description', content: SHORT_CONTENT }],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect(result).toMatchObject({
      status: 'proposed',
      lintFindings: [],
      proposalId: PROPOSAL_ID,
    });
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });

  it('create_design_doc: clean content persists', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ targetEntityType: 'DESIGN_DOC' }));
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createDesignDoc(
      {
        eli5: 'Explains the proposed change.',
        name: 'A doc',
        content: SHORT_CONTENT,
      },
      {} as any,
      makeRequest(),
    );

    expect(result).toMatchObject({
      status: 'proposed',
      lintFindings: [],
      proposalId: PROPOSAL_ID,
    });
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });

  it('edit_design_doc: clean content persists', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(
      makeProposal({
        action: 'UPDATE',
        targetEntityType: 'DESIGN_DOC',
        targetEntityId: DESIGN_DOC_ID,
      }),
    );
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.editDesignDoc(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: DESIGN_DOC_ID,
        sections: [{ key: 'content', content: SHORT_CONTENT }],
      },
      {} as any,
      makeRequest(),
    );

    expect(result).toMatchObject({
      status: 'proposed',
      lintFindings: [],
      proposalId: PROPOSAL_ID,
    });
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });
});

describe('proposal-tool lint v1 — dirty path returns status:"needs_revision" and does NOT persist', () => {
  beforeEach(() => jest.clearAllMocks());

  it('create_work_item (STANDARD): 4-paragraph section blocks persistence', async () => {
    const proposalCreate = jest.fn();
    const { provider } = createProvider({ proposalCreate });

    const result = (await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'STANDARD',
        name: 'Over-long task',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [
          { key: 'description', content: FOUR_PARAGRAPHS },
          { key: 'acceptanceCriteria', content: 'AC.' },
        ],
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    )) as any;

    expect(result.status).toBe('needs_revision');
    expect(result.proposalId).toBeUndefined();
    expect(result.lintFindings).toHaveLength(1);
    expect(result.lintFindings[0]).toMatchObject({
      rule: 'paragraph_count',
      severity: 'error',
      sectionKey: 'description',
    });
    expect(result.lintFindings[0].suggestion).toContain('create_work_item');
    // The proposal table must see zero new rows on a needs_revision call.
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('edit_work_item (STANDARD target): 4-paragraph section blocks persistence', async () => {
    const proposalCreate = jest.fn();
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: TASK_ID, type: 'STANDARD', sections: [] });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = (await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: TASK_ID,
        sections: [{ key: 'description', content: FOUR_PARAGRAPHS }],
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    )) as any;

    expect(result.status).toBe('needs_revision');
    // The needs_revision branch still echoes the server-resolved type, so
    // the revise-and-retry loop keeps the agent's type belief corrected.
    expect(result.workItemType).toBe('STANDARD');
    expect(result.proposalId).toBeUndefined();
    expect(result.lintFindings[0].sectionKey).toBe('description');
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('edit_work_item (BUG target): 4-paragraph section blocks persistence', async () => {
    // BUG is in the paragraph rule's per-type scope — parity with the
    // retired edit_task, which reached BUG targets.
    const proposalCreate = jest.fn();
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: BUG_ID, type: 'BUG', sections: [] });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = (await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: BUG_ID,
        sections: [{ key: 'description', content: FOUR_PARAGRAPHS }],
        guidanceToken: guidanceTokenForType('BUG', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    )) as any;

    expect(result.status).toBe('needs_revision');
    expect(result.proposalId).toBeUndefined();
    expect(proposalCreate).not.toHaveBeenCalled();
  });
});

// The paragraph_count rule is scoped per work-item type: it fires for
// STANDARD and BUG (the plain-task scope the retired create_task /
// edit_task covered) but never for FEATURE or GOAL authoring, and never
// for the design_doc handlers. All these paths still carry the lint
// envelope — the rule's scope narrows where it fires, not which handlers
// carry the discriminated response.
describe('proposal-tool lint v1 — rule scoped to STANDARD/BUG; feature/goal/design_doc unaffected', () => {
  beforeEach(() => jest.clearAllMocks());

  it('create_work_item (FEATURE): 4-paragraph section still persists (rule out of scope)', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ targetEntityId: FEATURE_ID }));
    const { provider } = createProvider({ proposalCreate });

    const result = (await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'FEATURE',
        name: 'Over-long feature',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        tag: 'product',
        sections: [{ key: 'description', content: FOUR_PARAGRAPHS }],
        initialRequirements: [{ statement: 'A requirement.' }],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    )) as any;

    expect(result).toMatchObject({
      status: 'proposed',
      lintFindings: [],
      proposalId: PROPOSAL_ID,
    });
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });

  it('edit_work_item (FEATURE target): 4-paragraph section still persists (rule out of scope)', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: FEATURE_ID, type: 'FEATURE' });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = (await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: FEATURE_ID,
        sections: [{ key: 'description', content: FOUR_PARAGRAPHS }],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    )) as any;

    expect(result).toMatchObject({
      status: 'proposed',
      lintFindings: [],
      proposalId: PROPOSAL_ID,
    });
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });

  it('create_work_item (GOAL): 4-paragraph section still persists with the lint-aware envelope', async () => {
    // GOAL adopted the unified lint envelope (the legacy id+DRAFT goal
    // envelope is gone) but the paragraph rule stays out of scope for it.
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ targetEntityId: GOAL_ID }));
    const { provider } = createProvider({ proposalCreate });

    const result = (await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'GOAL',
        name: 'A goal',
        dueDate: '2026-06-15T00:00:00.000Z',
        sections: [{ key: 'description', content: FOUR_PARAGRAPHS }],
        guidanceToken: guidanceTokenForType('GOAL', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    )) as any;

    expect(result).toMatchObject({
      status: 'proposed',
      lintFindings: [],
      proposalId: PROPOSAL_ID,
    });
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });

  it('edit_work_item (GOAL target): 4-paragraph section still persists (rule out of scope)', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(
        makeProposal({ action: 'UPDATE', targetEntityId: GOAL_ID }),
      );
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: GOAL_ID, type: 'GOAL' });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = (await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: GOAL_ID,
        sections: [{ key: 'description', content: FOUR_PARAGRAPHS }],
        guidanceToken: guidanceTokenForType('GOAL', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    )) as any;

    expect(result).toMatchObject({
      status: 'proposed',
      lintFindings: [],
      proposalId: PROPOSAL_ID,
    });
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });

  it('create_design_doc: 4-paragraph content still persists (rule out of scope)', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ targetEntityType: 'DESIGN_DOC' }));
    const { provider } = createProvider({ proposalCreate });

    const result = (await provider.createDesignDoc(
      {
        eli5: 'Explains the proposed change.',
        name: 'Big doc',
        content: FOUR_PARAGRAPHS,
      },
      {} as any,
      makeRequest(),
    )) as any;

    expect(result).toMatchObject({
      status: 'proposed',
      lintFindings: [],
      proposalId: PROPOSAL_ID,
    });
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });

  it('edit_design_doc: 4-paragraph section still persists (rule out of scope)', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(
      makeProposal({
        action: 'UPDATE',
        targetEntityType: 'DESIGN_DOC',
        targetEntityId: DESIGN_DOC_ID,
      }),
    );
    const { provider } = createProvider({ proposalCreate });

    const result = (await provider.editDesignDoc(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: DESIGN_DOC_ID,
        sections: [{ key: 'content', content: FOUR_PARAGRAPHS }],
      },
      {} as any,
      makeRequest(),
    )) as any;

    expect(result).toMatchObject({
      status: 'proposed',
      lintFindings: [],
      proposalId: PROPOSAL_ID,
    });
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });
});

// Regression for H1: the implementation field is appended to the
// description section as a synthetic `## Implementation` block by
// foldImplementationIntoSections. Lint must run on the agent-authored
// pre-fold sections so that block never counts toward the paragraph
// budget. Without this, an agent who writes 3 tight description
// paragraphs + an implementation field would trip the lint on content
// they didn't write.
describe('proposal-tool lint v1 — pre-fold lint contract (H1)', () => {
  beforeEach(() => jest.clearAllMocks());

  const THREE_PARAGRAPHS = [
    'PM-readable framing paragraph.',
    'Slightly more detail in the middle.',
    'Closing intent paragraph.',
  ].join('\n\n');

  it('create_work_item (STANDARD): 3 description paragraphs + implementation field still passes lint', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(makeProposal());
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'STANDARD',
        name: 'Task with implementation',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [
          { key: 'description', content: THREE_PARAGRAPHS },
          { key: 'acceptanceCriteria', content: 'AC.' },
        ],
        implementation:
          'Look at src/foo.ts; reuse the bar pattern from src/baz.ts.',
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect(result).toMatchObject({
      status: 'proposed',
      lintFindings: [],
      proposalId: PROPOSAL_ID,
    });
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });

  it('edit_work_item (STANDARD target): 3 description paragraphs + implementation field still passes lint', async () => {
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: TASK_ID, type: 'STANDARD', sections: [] });
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = (await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: TASK_ID,
        sections: [{ key: 'description', content: THREE_PARAGRAPHS }],
        implementation: 'Touch src/foo.ts and src/bar.ts.',
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    )) as any;

    expect(result.status).toBe('proposed');
    expect(result.lintFindings).toEqual([]);
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });
});

describe('proposal-tool lint v1 — telemetry', () => {
  beforeEach(() => jest.clearAllMocks());

  it('emits a structured log entry per finding with rule/section/agent/outcome', async () => {
    const proposalCreate = jest.fn();
    const { provider } = createProvider({ proposalCreate });
    const logSpy = jest
      .spyOn((provider as any).logger, 'log')
      .mockImplementation(() => undefined);

    await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'STANDARD',
        name: 'X',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [
          { key: 'description', content: FOUR_PARAGRAPHS },
          { key: 'acceptanceCriteria', content: 'AC.' },
        ],
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    const lintCalls = logSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.startsWith('lint.create_work_item'));
    expect(lintCalls.length).toBeGreaterThan(0);
    const entry = lintCalls[0]!;
    expect(entry).toContain('rule=paragraph_count');
    expect(entry).toContain('section=description');
    expect(entry).toContain('agent=u1');
    expect(entry).toContain('outcome=needs_revision');
  });

  it('emits a recovery=true entry on the next clean call for the same target', async () => {
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: TASK_ID, type: 'STANDARD', sections: [] });
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const { provider } = createProvider({ proposalCreate, taskFindOne });
    const logSpy = jest
      .spyOn((provider as any).logger, 'log')
      .mockImplementation(() => undefined);

    // First call: lint-blocked
    await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: TASK_ID,
        sections: [{ key: 'description', content: FOUR_PARAGRAPHS }],
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );
    // Second call: clean, same target — should mark recovery=true
    await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: TASK_ID,
        sections: [{ key: 'description', content: SHORT_CONTENT }],
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    const cleanEntry = logSpy.mock.calls
      .map((c) => String(c[0]))
      .find(
        (s) =>
          s.startsWith('lint.edit_work_item') && s.includes('outcome=proposed'),
      );
    expect(cleanEntry).toBeDefined();
    expect(cleanEntry).toContain('recovery=true');
  });
});
