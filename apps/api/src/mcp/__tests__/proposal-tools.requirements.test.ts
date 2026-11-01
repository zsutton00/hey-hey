import {
  ProposalToolsProvider,
  createWorkItemParameters,
  editWorkItemParameters,
} from '../tools/proposal-tools.provider';
import type { ProposalService } from '../../services/proposal/proposal.service';
import type { TaskService } from '../../services/tasks/task.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { createWarmWorkItemTypeRegistry } from '../../../test/setup/work-item-type-registry.fixture';
import { guidanceTokenForType } from '../tools/work-item-guidance-token';
import { AUTHORING_ROOT_PROOF } from '../tools/authoring-guidance';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const FEATURE_ID = '00000000-0000-4000-8000-000000000010';
const PROPOSAL_ID = '00000000-0000-4000-8000-000000000020';
const TASK_ID_A = '11111111-1111-4111-8111-111111111111';
const CONTRACT_ID = '22222222-2222-4222-8222-222222222222';
const DESIGN_DOC_ID = '33333333-3333-4333-8333-333333333333';
const PLAN_ID = '44444444-4444-4444-8444-444444444444';
const REQUIREMENT_ID_X = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUIREMENT_ID_Y = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUIREMENT_ID_Z = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

let workItemTypeRegistry: WorkItemTypeRegistryService;
beforeAll(async () => {
  workItemTypeRegistry = await createWarmWorkItemTypeRegistry();
});

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

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
    targetEntityId: FEATURE_ID,
    targetEntityType: 'TASK',
    updates: {},
    createdAt: '2026-06-19T00:00:00.000Z',
    updatedAt: '2026-06-19T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Build a prisma mock that returns task names, design-doc names, and task types.
 * `taskRows`: [{ id, name, type }]
 * `docRows`: [{ id, name }]
 */
function makePrisma(
  taskRows: { id: string; name: string; type?: string }[] = [],
  docRows: { id: string; name: string }[] = [],
) {
  return {
    db: {
      task: {
        findMany: jest.fn().mockResolvedValue(taskRows),
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          const found = taskRows.find((t) => t.id === where.id);
          return Promise.resolve(
            found ? { type: found.type ?? 'STANDARD' } : null,
          );
        }),
      },
      designDoc: {
        findMany: jest.fn().mockResolvedValue(docRows),
      },
      entityRegistry: {
        findMany: jest.fn().mockResolvedValue([
          ...taskRows.map((row) => ({
            entityId: row.id,
            entityType: 'TASK',
            entityName: row.name,
            deletedAt: null,
          })),
          ...docRows.map((row) => ({
            entityId: row.id,
            entityType: 'DESIGN_DOC',
            entityName: row.name,
            deletedAt: null,
          })),
        ]),
      },
    },
  };
}

function createProvider(
  opts: {
    proposalCreate?: jest.Mock;
    taskFindOne?: jest.Mock;
    prisma?: any;
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
  const lintRecovery = {
    markNeedsRevision: jest.fn().mockResolvedValue(undefined),
    consumeRecovery: jest.fn().mockResolvedValue(false),
  } as any;
  const prisma = opts.prisma ?? makePrisma();
  const provider = new ProposalToolsProvider(
    proposalService,
    taskService,
    lintRecovery,
    workItemTypeRegistry,
    prisma,
  );
  return { provider, proposalCreate, taskFindOne };
}

// ---------------------------------------------------------------------------
// create_work_item + initialRequirements
// ---------------------------------------------------------------------------

describe('create_work_item (FEATURE) — initialRequirements', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mints durable IDs and prepares a canonical JSON requirements section', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(makeProposal());
    const prisma = makePrisma(
      [{ id: TASK_ID_A, name: 'Task A', type: 'STANDARD' }],
      [],
    );
    const { provider } = createProvider({ proposalCreate, prisma });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'FEATURE',
        name: 'My Feature',
        tag: 'product',
        sections: [{ key: 'description', content: 'Feature description.' }],
        initialRequirements: [
          {
            statement: 'The system does X',
            group: 'Access control',
            fulfilledBy: [{ entityType: 'TASK', entityId: TASK_ID_A }],
          },
        ],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    // mintedRequirementIds should be returned
    expect((result as any).mintedRequirementIds).toBeDefined();
    const ids = Object.keys((result as any).mintedRequirementIds);
    expect(ids).toHaveLength(1);

    // The proposal should carry a requirements section
    const dto = proposalCreate.mock.calls[0][3];
    const sections = dto.updates.sections as any[];
    const reqSection = sections?.find((s: any) => s.key === 'requirements');
    expect(reqSection).toBeDefined();
    expect(reqSection.content).toEqual({
      records: [
        {
          id: ids[0],
          statement: 'The system does X',
          group: 'Access control',
          designedBy: [],
          fulfilledBy: [
            { entityType: 'TASK', entityId: TASK_ID_A, entityTitle: 'Task A' },
          ],
          contracts: [],
        },
      ],
    });
  });

  it('preserves an explicitly empty initial collection', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(makeProposal());
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'FEATURE',
        name: 'Empty Feature',
        tag: 'product',
        sections: [{ key: 'description', content: 'Feature description.' }],
        initialRequirements: [],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    expect((result as any).mintedRequirementIds).toEqual({});
    const section = (
      proposalCreate.mock.calls[0][3].updates.sections as any[]
    ).find((candidate) => candidate.key === 'requirements');
    expect(section.content).toEqual({ records: [] });
  });

  it('accepts a large collection when any requirement is missing a group', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(makeProposal());
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'FEATURE',
        name: 'My Feature',
        tag: 'product',
        sections: [{ key: 'description', content: 'Feature description.' }],
        initialRequirements: [
          { statement: 'The system does X', group: 'Access control' },
          { statement: 'The system does Y', group: 'Access control' },
          { statement: 'The system does Z' },
        ],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    expect(proposalCreate).toHaveBeenCalled();
  });

  it('accepts a large collection when every requirement shares one group', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(makeProposal());
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'FEATURE',
        name: 'My Feature',
        tag: 'product',
        sections: [{ key: 'description', content: 'Feature description.' }],
        initialRequirements: [
          { statement: 'The system does X', group: 'Access control' },
          { statement: 'The system does Y', group: 'Access control' },
          { statement: 'The system does Z', group: 'Access control' },
        ],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    expect(proposalCreate).toHaveBeenCalled();
  });

  it('rejects sections[requirements] on FEATURE', async () => {
    const proposalCreate = jest.fn();
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'FEATURE',
        name: 'My Feature',
        tag: 'product',
        sections: [{ key: 'requirements', content: 'Direct content' }],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'requirements section cannot be set via sections[]',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects wrong entity type in designedBy slot', async () => {
    const proposalCreate = jest.fn();
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'FEATURE',
        name: 'My Feature',
        tag: 'product',
        sections: [{ key: 'description', content: 'Feature description.' }],
        initialRequirements: [
          {
            statement: 'The system does X',
            designedBy: [{ entityType: 'TASK', entityId: TASK_ID_A } as any],
          },
        ],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      "Expected 'DESIGN_DOC' | 'MOCKUP' | 'DIAGRAM'",
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects wrong entity type in fulfilledBy slot', async () => {
    const proposalCreate = jest.fn();
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'FEATURE',
        name: 'My Feature',
        tag: 'product',
        sections: [{ key: 'description', content: 'Feature description.' }],
        initialRequirements: [
          {
            statement: 'The system does X',
            fulfilledBy: [
              { entityType: 'DESIGN_DOC', entityId: DESIGN_DOC_ID } as any,
            ],
          },
        ],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('Invalid input');
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects a FEATURE without initialRequirements — the requirements section is implicit-required', async () => {
    const proposalCreate = jest.fn();
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'FEATURE',
        name: 'My Feature',
        tag: 'product',
        sections: [{ key: 'description', content: 'Feature description.' }],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'Section "requirements" is required to create a FEATURE work item',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// edit_work_item + requirementOps
// ---------------------------------------------------------------------------

describe('edit_work_item (FEATURE) — requirementOps', () => {
  beforeEach(() => jest.clearAllMocks());

  const baseFeature = {
    id: FEATURE_ID,
    type: 'FEATURE',
    sections: [
      {
        key: 'requirements',
        materializedMarkdown: JSON.stringify({
          records: [
            {
              id: REQUIREMENT_ID_X,
              statement: 'The system does X',
              designedBy: [],
              fulfilledBy: [
                {
                  entityType: 'TASK',
                  entityId: TASK_ID_A,
                  entityTitle: 'Stored Task A',
                },
              ],
              contracts: [],
            },
          ],
        }),
      },
    ],
  };

  it('add op appends a new requirement with a durable ID', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const taskFindOne = jest.fn().mockResolvedValue(baseFeature);
    const prisma = makePrisma(
      [{ id: TASK_ID_A, name: 'Task A', type: 'STANDARD' }],
      [],
    );
    const { provider } = createProvider({
      proposalCreate,
      taskFindOne,
      prisma,
    });

    const result = await provider.editWorkItem(
      {
        targetEntityId: FEATURE_ID,
        eli5: 'Explains the proposed change.',
        authoringRootProof: AUTHORING_ROOT_PROOF,
        requirementOps: [
          {
            op: 'add',
            value: { statement: 'The system also does Y' },
          },
        ],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    const dto = proposalCreate.mock.calls[0][3];
    const sections = dto.updates.sections as any[];
    const reqSection = sections?.find((s: any) => s.key === 'requirements');
    expect(reqSection?.content.records).toEqual([
      {
        id: REQUIREMENT_ID_X,
        statement: 'The system does X',
        designedBy: [],
        fulfilledBy: [
          {
            entityType: 'TASK',
            entityId: TASK_ID_A,
            entityTitle: 'Stored Task A',
          },
        ],
        contracts: [],
      },
      {
        id: expect.any(String),
        statement: 'The system also does Y',
        designedBy: [],
        fulfilledBy: [],
        contracts: [],
      },
    ]);
    expect((result as any).mintedRequirementIds).toEqual({
      [reqSection.content.records[1].id]: 'The system also does Y',
    });
  });

  it('accepts an add that leaves the collection ungrouped', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const taskFindOne = jest.fn().mockResolvedValue({
      ...baseFeature,
      sections: [
        {
          key: 'requirements',
          materializedMarkdown: JSON.stringify({
            records: [
              {
                id: REQUIREMENT_ID_X,
                statement: 'The system does X',
                designedBy: [],
                fulfilledBy: [],
                contracts: [],
              },
              {
                id: REQUIREMENT_ID_Y,
                statement: 'The system does Y',
                designedBy: [],
                fulfilledBy: [],
                contracts: [],
              },
            ],
          }),
        },
      ],
    });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        targetEntityId: FEATURE_ID,
        eli5: 'Explains the proposed change.',
        authoringRootProof: AUTHORING_ROOT_PROOF,
        requirementOps: [
          { op: 'add', value: { statement: 'The system does Z' } },
        ],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    expect(proposalCreate).toHaveBeenCalled();
  });

  it('allows a group-only repair of a mixed collection', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const taskFindOne = jest.fn().mockResolvedValue({
      ...baseFeature,
      sections: [
        {
          key: 'requirements',
          materializedMarkdown: JSON.stringify({
            records: [
              {
                id: REQUIREMENT_ID_X,
                statement: 'The system does X',
                designedBy: [],
                fulfilledBy: [],
                contracts: [],
              },
              {
                id: REQUIREMENT_ID_Y,
                statement: 'The system does Y',
                group: 'Access control',
                designedBy: [],
                fulfilledBy: [],
                contracts: [],
              },
              {
                id: REQUIREMENT_ID_Z,
                statement: 'The system does Z',
                group: 'Access control',
                designedBy: [],
                fulfilledBy: [],
                contracts: [],
              },
            ],
          }),
        },
      ],
    });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        targetEntityId: FEATURE_ID,
        eli5: 'Explains the proposed change.',
        authoringRootProof: AUTHORING_ROOT_PROOF,
        requirementOps: [
          { op: 'update', targetId: REQUIREMENT_ID_X, group: 'Access control' },
        ],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    const dto = proposalCreate.mock.calls[0][3];
    const requirements = (dto.updates.sections as any[]).find(
      (section) => section.key === 'requirements',
    );
    expect(
      requirements.content.records.map((record: any) => record.group),
    ).toEqual(['Access control', 'Access control', 'Access control']);
  });

  it('allows deleting a requirement and prepares the resulting collection', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const taskFindOne = jest.fn().mockResolvedValue({
      ...baseFeature,
      sections: [
        {
          key: 'requirements',
          materializedMarkdown: JSON.stringify({
            records: [
              {
                id: REQUIREMENT_ID_X,
                statement: 'The system does X',
                designedBy: [],
                fulfilledBy: [],
                contracts: [],
              },
              {
                id: REQUIREMENT_ID_Y,
                statement: 'The system does Y',
                designedBy: [],
                fulfilledBy: [],
                contracts: [],
              },
              {
                id: REQUIREMENT_ID_Z,
                statement: 'The system does Z',
                designedBy: [],
                fulfilledBy: [],
                contracts: [],
              },
            ],
          }),
        },
      ],
    });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        targetEntityId: FEATURE_ID,
        eli5: 'Explains the proposed change.',
        authoringRootProof: AUTHORING_ROOT_PROOF,
        requirementOps: [{ op: 'delete', targetId: REQUIREMENT_ID_Y }],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    const dto = proposalCreate.mock.calls[0][3];
    const reqSection = (dto.updates.sections as any[]).find(
      (section) => section.key === 'requirements',
    );
    expect(reqSection.content.records.map((record: any) => record.id)).toEqual([
      REQUIREMENT_ID_X,
      REQUIREMENT_ID_Z,
    ]);
  });

  it('carries group-only updates through the canonical JSON section without rotating identity', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const taskFindOne = jest.fn().mockResolvedValue({
      ...baseFeature,
      sections: [
        {
          key: 'requirements',
          materializedMarkdown: JSON.stringify({
            records: [
              {
                id: REQUIREMENT_ID_X,
                statement: 'The system does X',
                group: 'Access control',
                designedBy: [],
                fulfilledBy: [
                  {
                    entityType: 'TASK',
                    entityId: TASK_ID_A,
                    entityTitle: 'Stored Task A',
                  },
                ],
                contracts: [],
              },
            ],
          }),
        },
      ],
    });
    const prisma = makePrisma(
      [{ id: TASK_ID_A, name: 'Task A', type: 'STANDARD' }],
      [],
    );
    const { provider } = createProvider({
      proposalCreate,
      taskFindOne,
      prisma,
    });

    const result = await provider.editWorkItem(
      {
        targetEntityId: FEATURE_ID,
        eli5: 'Explains the proposed change.',
        authoringRootProof: AUTHORING_ROOT_PROOF,
        requirementOps: [
          {
            op: 'update',
            targetId: REQUIREMENT_ID_X,
            group: 'Authorization',
          },
        ],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    const dto = proposalCreate.mock.calls[0][3];
    const sections = dto.updates.sections as any[];
    const reqSection = sections?.find((s: any) => s.key === 'requirements');
    expect(reqSection?.content).toEqual({
      records: [
        {
          id: REQUIREMENT_ID_X,
          statement: 'The system does X',
          group: 'Authorization',
          designedBy: [],
          fulfilledBy: [
            {
              entityType: 'TASK',
              entityId: TASK_ID_A,
              entityTitle: 'Stored Task A',
            },
          ],
          contracts: [],
        },
      ],
    });
  });

  it('update op adds a cite to fulfilledBy', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const taskFindOne = jest.fn().mockResolvedValue(baseFeature);
    const prisma = makePrisma(
      [
        { id: TASK_ID_A, name: 'Task A', type: 'STANDARD' },
        { id: PLAN_ID, name: 'Plan A', type: 'PLAN' },
      ],
      [],
    );
    const { provider } = createProvider({
      proposalCreate,
      taskFindOne,
      prisma,
    });

    const result = await provider.editWorkItem(
      {
        targetEntityId: FEATURE_ID,
        eli5: 'Explains the proposed change.',
        authoringRootProof: AUTHORING_ROOT_PROOF,
        requirementOps: [
          {
            op: 'update',
            targetId: REQUIREMENT_ID_X,
            fulfilledBy: {
              add: [{ entityType: 'PLAN', entityId: PLAN_ID }],
            },
          },
        ],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    const dto = proposalCreate.mock.calls[0][3];
    const sections = dto.updates.sections as any[];
    const reqSection = sections?.find((s: any) => s.key === 'requirements');
    expect(reqSection?.content.records[0].fulfilledBy).toEqual([
      { entityType: 'TASK', entityId: TASK_ID_A, entityTitle: 'Stored Task A' },
      { entityType: 'PLAN', entityId: PLAN_ID, entityTitle: 'Plan A' },
    ]);
  });

  it('delete op removes the requirement', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const taskFindOne = jest.fn().mockResolvedValue(baseFeature);
    const prisma = makePrisma(
      [{ id: TASK_ID_A, name: 'Task A', type: 'STANDARD' }],
      [],
    );
    const { provider } = createProvider({
      proposalCreate,
      taskFindOne,
      prisma,
    });

    const result = await provider.editWorkItem(
      {
        targetEntityId: FEATURE_ID,
        eli5: 'Explains the proposed change.',
        authoringRootProof: AUTHORING_ROOT_PROOF,
        requirementOps: [{ op: 'delete', targetId: REQUIREMENT_ID_X }],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    const dto = proposalCreate.mock.calls[0][3];
    const sections = dto.updates.sections as any[];
    const reqSection = sections?.find((s: any) => s.key === 'requirements');
    expect(reqSection?.content).toEqual({ records: [] });
  });

  it('preserves the durable ID when a later operation renames the same record', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const taskFindOne = jest.fn().mockResolvedValue({
      ...baseFeature,
      sections: [
        {
          key: 'requirements',
          materializedMarkdown: JSON.stringify({
            records: [
              {
                id: REQUIREMENT_ID_X,
                statement: 'The system does X',
                group: 'Access control',
                designedBy: [],
                fulfilledBy: [
                  {
                    entityType: 'TASK',
                    entityId: TASK_ID_A,
                    entityTitle: 'Stored Task A',
                  },
                ],
                contracts: [],
              },
            ],
          }),
        },
      ],
    });
    const prisma = makePrisma(
      [{ id: TASK_ID_A, name: 'Task A', type: 'STANDARD' }],
      [],
    );
    const { provider } = createProvider({
      proposalCreate,
      taskFindOne,
      prisma,
    });

    const result = await provider.editWorkItem(
      {
        targetEntityId: FEATURE_ID,
        eli5: 'Explains the proposed change.',
        authoringRootProof: AUTHORING_ROOT_PROOF,
        requirementOps: [
          {
            op: 'update',
            targetId: REQUIREMENT_ID_X,
            statement: 'Renamed requirement',
          },
          { op: 'update', targetId: REQUIREMENT_ID_X, group: 'Authorization' },
        ],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    const dto = proposalCreate.mock.calls[0][3];
    const records = (dto.updates.sections as any[]).find(
      (section) => section.key === 'requirements',
    ).content.records;
    expect(records).toEqual([
      expect.objectContaining({
        id: REQUIREMENT_ID_X,
        statement: 'Renamed requirement',
        group: 'Authorization',
      }),
    ]);
  });

  it('rejects an unknown durable target ID', async () => {
    const proposalCreate = jest.fn();
    const taskFindOne = jest.fn().mockResolvedValue(baseFeature);
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        targetEntityId: FEATURE_ID,
        eli5: 'Explains the proposed change.',
        authoringRootProof: AUTHORING_ROOT_PROOF,
        requirementOps: [
          { op: 'delete', targetId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
        ],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('does not exist');
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects sections[requirements] on FEATURE via edit', async () => {
    const proposalCreate = jest.fn();
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: FEATURE_ID, type: 'FEATURE', sections: [] });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        targetEntityId: FEATURE_ID,
        sections: [{ key: 'requirements', content: 'Direct content' }],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'requirements section cannot be set via sections[]',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('requirementOps on non-FEATURE target returns structured error', async () => {
    const proposalCreate = jest.fn();
    const taskFindOne = jest.fn().mockResolvedValue({
      id: FEATURE_ID,
      type: 'STANDARD',
      sections: [],
    });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        targetEntityId: FEATURE_ID,
        eli5: 'Explains the proposed change.',
        authoringRootProof: AUTHORING_ROOT_PROOF,
        requirementOps: [{ op: 'add', value: { statement: 'Some req' } }],
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('FEATURE work items');
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('unfulfilled-requirement lintFindings warning does not block proposed status', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const taskFindOne = jest.fn().mockResolvedValue({
      id: FEATURE_ID,
      type: 'FEATURE',
      sections: [
        {
          key: 'requirements',
          materializedMarkdown: JSON.stringify({ records: [] }),
        },
      ],
    });
    const prisma = makePrisma([], []);
    const { provider } = createProvider({
      proposalCreate,
      taskFindOne,
      prisma,
    });

    const result = await provider.editWorkItem(
      {
        targetEntityId: FEATURE_ID,
        eli5: 'Explains the proposed change.',
        authoringRootProof: AUTHORING_ROOT_PROOF,
        requirementOps: [
          {
            op: 'add',
            value: { statement: 'Requirement with no cites' },
          },
        ],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    // Should be proposed (not error) even with unfulfilled warning
    expect((result as any).isError).toBeUndefined();
    expect((result as any).status).toBe('proposed');
    expect((result as any).requirementLintFindings).toBeDefined();
    expect((result as any).requirementLintFindings.length).toBeGreaterThan(0);
  });

  it('slot validation rejects wrong entity type in add op', async () => {
    const proposalCreate = jest.fn();
    const taskFindOne = jest.fn().mockResolvedValue({
      id: FEATURE_ID,
      type: 'FEATURE',
      sections: [
        {
          key: 'requirements',
          materializedMarkdown: JSON.stringify({ records: [] }),
        },
      ],
    });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        targetEntityId: FEATURE_ID,
        eli5: 'Explains the proposed change.',
        authoringRootProof: AUTHORING_ROOT_PROOF,
        requirementOps: [
          {
            op: 'add',
            value: {
              statement: 'The system does X',
              designedBy: [{ entityType: 'TASK', entityId: TASK_ID_A } as any],
            },
          },
        ],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      "Expected 'DESIGN_DOC' | 'MOCKUP' | 'DIAGRAM'",
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Schema shape assertions
// ---------------------------------------------------------------------------

describe('parameter schema shape', () => {
  it('createWorkItemParameters has initialRequirements', () => {
    expect(createWorkItemParameters.shape.initialRequirements).toBeDefined();
  });

  it('editWorkItemParameters has requirementOps', () => {
    expect(editWorkItemParameters.shape.requirementOps).toBeDefined();
  });
});
