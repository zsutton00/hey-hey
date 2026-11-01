import {
  GetFullEntityToolsProvider,
  getFullEntityParameters,
} from '../tools/get-full-entity-tools.provider';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentEdgeClientService } from '../../services/agent-edge-client.service';
import type { TaskService } from '../../services/tasks/task.service';
import { FeatureRequirementsReadError } from '../../services/tasks/feature-requirements-reader';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const ENTITY_ID = '00000000-0000-4000-8000-000000000010';
const ENTITY_ID_2 = '00000000-0000-4000-8000-000000000020';
const SUCCESSOR_ID = '00000000-0000-4000-8000-000000000030';
const SUCCESSOR_ID_2 = '00000000-0000-4000-8000-000000000040';

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
    headers: {
      authorization: 'Bearer tok',
      'x-project-id': PROJECT_ID,
    },
    cookies: {},
    user: makeUser(),
    ip: '127.0.0.1',
  } as any;
}

function makeSection(key: string, order: number, markdown: string) {
  return { key, order, materializedMarkdown: markdown };
}

const mockTask = { findFirst: jest.fn(), findMany: jest.fn() };
const mockInitiative = { findFirst: jest.fn() };
const mockDesignDoc = { findFirst: jest.fn() };
const mockPlan = { findFirst: jest.fn() };
const mockPlanStage = { findFirst: jest.fn() };
const mockService = { findFirst: jest.fn() };
const mockImplementationHint = { findFirst: jest.fn() };

const mockPrisma = {
  db: {
    task: mockTask,
    initiative: mockInitiative,
    designDoc: mockDesignDoc,
    plan: mockPlan,
    planStage: mockPlanStage,
    service: mockService,
    implementationHint: mockImplementationHint,
  },
} as unknown as PrismaService;

const mockTaskService = {
  findOneByOrganization: jest.fn(),
} as unknown as {
  findOneByOrganization: jest.Mock;
};

const mockAgentEdgeClient = {
  findIncident: jest.fn(),
} as unknown as jest.Mocked<AgentEdgeClientService>;

const mockRegistry = {
  getRulesForProject: jest.fn(),
  getDefinitions: jest.fn(),
};

function createProvider() {
  return new GetFullEntityToolsProvider(
    mockPrisma,
    mockTaskService as unknown as TaskService,
    mockAgentEdgeClient,
    mockRegistry as unknown as WorkItemTypeRegistryService,
  );
}

describe('GetFullEntityToolsProvider', () => {
  let provider: GetFullEntityToolsProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAgentEdgeClient.findIncident.mockResolvedValue([]);
    mockTask.findMany.mockResolvedValue([]);
    mockRegistry.getRulesForProject.mockImplementation((key, projectId) =>
      projectId === PROJECT_ID && ['CONTRACT', 'custom_review'].includes(key)
        ? {}
        : undefined,
    );
    mockRegistry.getDefinitions.mockReturnValue(
      ['CONTRACT', 'custom_review'].map((key) => ({ definition: { key } })),
    );
    provider = createProvider();
  });

  describe('work-item type aliases', () => {
    it.each(['TASK', 'CONTRACT', 'custom_review'])(
      'reads the stored type and replacement metadata using %s',
      async (entityType) => {
        mockTaskService.findOneByOrganization.mockResolvedValue({
          id: ENTITY_ID,
          type: 'CONTRACT',
          projectId: PROJECT_ID,
          status: 'ACTIVE',
          sections: [makeSection('description', 0, 'Provider promise')],
        });
        const params = getFullEntityParameters.parse({
          entities: [{ entityType, entityId: ENTITY_ID }],
        });
        const result = await provider.getFullEntity(
          params,
          {} as any,
          makeRequest(),
        );
        const record = JSON.parse((result as any).content[0].text)[ENTITY_ID];
        expect(record.type).toBe('CONTRACT');
        expect(record.sections.description).toBe('Provider promise');
        expect(record.replacement).toEqual({
          state: 'NOT_SUPERSEDED',
          replacedBy: [],
        });
        expect(mockTaskService.findOneByOrganization).toHaveBeenCalledWith(
          ORG_ID,
          ENTITY_ID,
        );
        if (entityType !== 'TASK') {
          expect(mockRegistry.getRulesForProject).toHaveBeenCalledWith(
            entityType,
            PROJECT_ID,
          );
        }
      },
    );

    it.each(['CONTRACT', 'custom_review'])(
      'preserves inaccessible and wrong-project null results for %s',
      async (entityType) => {
        mockTaskService.findOneByOrganization
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: ENTITY_ID_2,
            projectId: 'another-project',
            sections: [],
          });
        const result = await provider.getFullEntity(
          {
            entities: [
              { entityType, entityId: ENTITY_ID },
              { entityType, entityId: ENTITY_ID_2 },
            ],
          },
          {} as any,
          makeRequest(),
        );
        const records = JSON.parse((result as any).content[0].text);
        expect(records[ENTITY_ID]).toBeNull();
        expect(records[ENTITY_ID_2]).toBeNull();
        expect(mockAgentEdgeClient.findIncident).not.toHaveBeenCalled();
      },
    );

    it('rejects a non-work-item type for the whole call with the accepted vocabulary', async () => {
      const result = await provider.getFullEntity(
        {
          entities: [
            { entityType: 'TASK', entityId: ENTITY_ID },
            { entityType: 'MESSAGE', entityId: ENTITY_ID_2 },
          ],
        },
        {} as any,
        makeRequest(),
      );
      expect(result.isError).toBe(true);
      const text = (result as any).content[0].text;
      for (const key of [
        'TASK',
        'INITIATIVE',
        'DESIGN_DOC',
        'SERVICE',
        'IMPLEMENTATION_HINT',
        'CONTRACT',
        'custom_review',
      ]) {
        expect(text).toContain(key);
      }
      expect(mockTaskService.findOneByOrganization).not.toHaveBeenCalled();
    });
  });

  describe('response budgeting', () => {
    const ids = [ENTITY_ID, ENTITY_ID_2, SUCCESSOR_ID];
    const pairs = ids.map((entityId) => ({
      entityType: 'SERVICE' as const,
      entityId,
    }));

    function setRecords(lengths: number[]) {
      mockService.findFirst.mockImplementation(({ where: { id } }) =>
        Promise.resolve({
          id,
          description: 'x'.repeat(lengths[ids.indexOf(id)]!),
        }),
      );
    }

    async function read(entities = pairs) {
      const result = await provider.getFullEntity(
        { entities },
        {} as any,
        makeRequest(),
      );
      const text = (result as any).content[0].text as string;
      return { text, records: JSON.parse(text) };
    }

    it('returns an under-budget batch whole in request order', async () => {
      setRecords([100, 200, 300]);
      const { text, records } = await read();
      expect(Object.keys(records)).toEqual(ids);
      ids.forEach((id, index) =>
        expect(records[id].description).toBe('x'.repeat((index + 1) * 100)),
      );
      expect(text.length).toBeLessThanOrEqual(32_000);
    });

    it('omits the entire suffix and recovers exactly those identities on retry', async () => {
      setRecords([20_000, 15_000, 1]);
      const { text, records } = await read();
      expect(records[ENTITY_ID].description).toHaveLength(20_000);
      const retryPairs = pairs.slice(1);
      retryPairs.forEach(({ entityType, entityId }) => {
        expect(records[entityId]).toEqual({
          omitted: true,
          reason: 'SIZE_BUDGET',
          entityType,
          entityId,
        });
      });
      expect(text.length).toBeLessThanOrEqual(32_000);
      const retry = await read(retryPairs);
      expect(retry.records[ENTITY_ID_2].description).toHaveLength(15_000);
      expect(retry.records[SUCCESSOR_ID].description).toBe('x');
    });

    it('returns a single oversized record whole', async () => {
      setRecords([40_000]);
      const { records } = await read(pairs.slice(0, 1));
      expect(records[ENTITY_ID].description).toBe('x'.repeat(40_000));
    });

    it('returns an oversized first record and marks all later records', async () => {
      setRecords([40_000, 1, 1]);
      const { records } = await read();
      expect(records[ENTITY_ID].description).toHaveLength(40_000);
      expect(records[ENTITY_ID_2].omitted).toBe(true);
      expect(records[SUCCESSOR_ID].omitted).toBe(true);
    });

    it('includes records exactly at the budget boundary and omits at one character over', async () => {
      setRecords([1, 1, 1]);
      const baseline = await read(pairs.slice(0, 2));
      const remaining = 32_000 - baseline.text.length;
      setRecords([1, remaining + 1, 1]);
      const exact = await read(pairs.slice(0, 2));
      expect(exact.text).toHaveLength(32_000);
      expect(exact.records[ENTITY_ID_2].description).toHaveLength(
        remaining + 1,
      );
      setRecords([1, remaining + 2, 1]);
      expect((await read(pairs.slice(0, 2))).records[ENTITY_ID_2].reason).toBe(
        'SIZE_BUDGET',
      );
    });

    it('reserves suffix marker space when admitting an otherwise fitting record', async () => {
      setRecords([1, 1, 40_000]);
      const baseline = await read(pairs.slice(0, 2));
      setRecords([1, 32_000 - baseline.text.length + 1, 40_000]);
      const { records, text } = await read();
      expect(records[ENTITY_ID_2].omitted).toBe(true);
      expect(records[SUCCESSOR_ID].omitted).toBe(true);
      expect(text.length).toBeLessThanOrEqual(32_000);
    });
  });

  describe('authentication', () => {
    it('returns error when not authenticated', async () => {
      const req = makeRequest();
      req.user = undefined;

      const result = await provider.getFullEntity(
        { entities: [{ entityType: 'TASK', entityId: ENTITY_ID }] },
        {} as any,
        req,
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        'Authentication required',
      );
    });
  });

  describe('TASK', () => {
    it('returns full task with formatted sections', async () => {
      mockTaskService.findOneByOrganization.mockResolvedValue({
        id: ENTITY_ID,
        name: 'My Task',
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        status: 'ACTIVE',
        sections: [
          makeSection('description', 1, '# Description\nFull content here'),
          makeSection('acceptance_criteria', 2, '- [ ] Criterion A'),
        ],
      });

      const result = await provider.getFullEntity(
        { entities: [{ entityType: 'TASK', entityId: ENTITY_ID }] },
        {} as any,
        makeRequest(),
      );

      expect((result as any).isError).toBeUndefined();
      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed[ENTITY_ID].id).toBe(ENTITY_ID);
      expect(parsed[ENTITY_ID].name).toBe('My Task');
      expect(parsed[ENTITY_ID].sections.description).toBe(
        '# Description\nFull content here',
      );
      expect(parsed[ENTITY_ID].sections.acceptance_criteria).toBe(
        '- [ ] Criterion A',
      );
      expect(parsed[ENTITY_ID].replacement).toEqual({
        state: 'NOT_SUPERSEDED',
        replacedBy: [],
      });
    });

    it('includes the validated requirement records and omits the legacy projection', async () => {
      const requirementTaskId = '00000000-0000-4000-8000-000000000011';
      const requirementsSection = {
        records: [
          {
            id: '00000000-0000-4000-8000-000000000012',
            statement: 'Grouped requirement',
            group: 'Access control',
            designedBy: [],
            fulfilledBy: [
              {
                entityType: 'TASK',
                entityId: requirementTaskId,
                entityTitle: 'Requirement task',
              },
            ],
            contracts: [],
          },
          {
            id: '00000000-0000-4000-8000-000000000013',
            statement: 'Legacy ungrouped requirement',
            designedBy: [],
            fulfilledBy: [],
            contracts: [],
          },
        ],
      };
      mockTaskService.findOneByOrganization.mockResolvedValue({
        id: ENTITY_ID,
        name: 'Requirements Feature',
        type: 'FEATURE',
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        sections: [
          makeSection('requirements', 0, JSON.stringify(requirementsSection)),
        ],
      });

      const result = await provider.getFullEntity(
        { entities: [{ entityType: 'TASK', entityId: ENTITY_ID }] },
        {} as any,
        makeRequest(),
      );

      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed[ENTITY_ID].requirementsSection).toEqual(
        requirementsSection,
      );
      expect(parsed[ENTITY_ID]).not.toHaveProperty('requirementsStructured');
      expect(mockTaskService.findOneByOrganization).toHaveBeenCalledTimes(1);
    });

    it('returns deterministic direct successor metadata without replacing the requested entity', async () => {
      mockTaskService.findOneByOrganization.mockResolvedValue({
        id: ENTITY_ID,
        name: 'Original Task',
        type: 'STANDARD',
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        status: 'SUPERSEDED',
        sections: [makeSection('description', 0, 'Original content')],
      });
      mockAgentEdgeClient.findIncident.mockResolvedValue([
        {
          type: 'SUPERSEDES',
          sourceNodeId: ENTITY_ID,
          targetNodeId: SUCCESSOR_ID_2,
          targetEntityType: 'TASK',
        },
        {
          type: 'EVOLVES',
          sourceNodeId: ENTITY_ID,
          targetNodeId: '00000000-0000-4000-8000-000000000050',
          targetEntityType: 'TASK',
        },
        {
          type: 'SUPERSEDES',
          sourceNodeId: SUCCESSOR_ID,
          targetNodeId: ENTITY_ID,
          targetEntityType: 'TASK',
        },
        {
          type: 'SUPERSEDES',
          sourceNodeId: ENTITY_ID,
          targetNodeId: SUCCESSOR_ID,
          targetEntityType: 'TASK',
        },
      ] as any);
      mockTask.findMany.mockResolvedValue([
        {
          id: SUCCESSOR_ID_2,
          name: 'Second Successor',
          status: 'ACTIVE',
        },
        {
          id: SUCCESSOR_ID,
          name: 'First Successor',
          status: 'COMPLETED',
        },
      ]);

      const result = await provider.getFullEntity(
        { entities: [{ entityType: 'TASK', entityId: ENTITY_ID }] },
        {} as any,
        makeRequest(),
      );

      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed[ENTITY_ID]).toEqual(
        expect.objectContaining({
          id: ENTITY_ID,
          name: 'Original Task',
          sections: { description: 'Original content' },
          replacement: {
            state: 'SUPERSEDED',
            replacedBy: [
              {
                entityType: 'TASK',
                entityId: SUCCESSOR_ID,
                title: 'First Successor',
                status: 'COMPLETED',
              },
              {
                entityType: 'TASK',
                entityId: SUCCESSOR_ID_2,
                title: 'Second Successor',
                status: 'ACTIVE',
              },
            ],
          },
        }),
      );
      expect(mockAgentEdgeClient.findIncident).toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        {
          nodeIds: new Set([ENTITY_ID]),
          types: new Set(['SUPERSEDES']),
        },
        'tok',
      );
      expect(mockTask.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: [SUCCESSOR_ID_2, SUCCESSOR_ID] },
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
        },
        select: { id: true, name: true, status: true },
      });
    });

    it.each([
      {
        status: 'SUPERSEDED',
        edges: [],
        successors: [],
        label: 'lifecycle state has no direct successor',
      },
      {
        status: 'ACTIVE',
        edges: [
          {
            type: 'SUPERSEDES',
            sourceNodeId: ENTITY_ID,
            targetNodeId: SUCCESSOR_ID,
            targetEntityType: 'TASK',
          },
        ],
        successors: [{ id: SUCCESSOR_ID, name: 'Successor', status: 'ACTIVE' }],
        label: 'direct successor exists without superseded lifecycle state',
      },
    ])(
      'returns INCONSISTENT when $label',
      async ({ status, edges, successors }) => {
        mockTaskService.findOneByOrganization.mockResolvedValue({
          id: ENTITY_ID,
          name: 'Task',
          projectId: PROJECT_ID,
          organizationId: ORG_ID,
          status,
          sections: [],
        });
        mockAgentEdgeClient.findIncident.mockResolvedValue(edges as any);
        mockTask.findMany.mockResolvedValue(successors as any);

        const result = await provider.getFullEntity(
          { entities: [{ entityType: 'TASK', entityId: ENTITY_ID }] },
          {} as any,
          makeRequest(),
        );

        const parsed = JSON.parse((result as any).content[0].text);
        expect(parsed[ENTITY_ID].replacement.state).toBe('INCONSISTENT');
      },
    );

    it.each(['archived', 'wrong-organization', 'unknown'])(
      'returns null for a %s task rejected by TaskService',
      async () => {
        mockTaskService.findOneByOrganization.mockResolvedValue(null);

        const result = await provider.getFullEntity(
          { entities: [{ entityType: 'TASK', entityId: ENTITY_ID }] },
          {} as any,
          makeRequest(),
        );

        expect((result as any).isError).toBeUndefined();
        const parsed = JSON.parse((result as any).content[0].text);
        expect(parsed[ENTITY_ID]).toBeNull();
        expect(mockTaskService.findOneByOrganization).toHaveBeenCalledWith(
          ORG_ID,
          ENTITY_ID,
        );
        expect(mockAgentEdgeClient.findIncident).not.toHaveBeenCalled();
      },
    );

    it('returns null when the authorized task belongs to another project', async () => {
      mockTaskService.findOneByOrganization.mockResolvedValue({
        id: ENTITY_ID,
        name: 'Other Project Task',
        projectId: '00000000-0000-4000-8000-000000000099',
        organizationId: ORG_ID,
        status: 'ACTIVE',
        sections: [],
      });

      const result = await provider.getFullEntity(
        { entities: [{ entityType: 'TASK', entityId: ENTITY_ID }] },
        {} as any,
        makeRequest(),
      );

      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed[ENTITY_ID]).toBeNull();
      expect(mockAgentEdgeClient.findIncident).not.toHaveBeenCalled();
    });

    it('returns NOT_SUPERSEDED when lifecycle and direct topology agree', async () => {
      mockTaskService.findOneByOrganization.mockResolvedValue({
        id: ENTITY_ID,
        name: 'Canonical Task',
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        status: 'ACTIVE',
        sections: [],
      });

      const result = await provider.getFullEntity(
        { entities: [{ entityType: 'TASK', entityId: ENTITY_ID }] },
        {} as any,
        makeRequest(),
      );

      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed[ENTITY_ID].replacement).toEqual({
        state: 'NOT_SUPERSEDED',
        replacedBy: [],
      });
      expect(mockTask.findMany).not.toHaveBeenCalled();
    });

    it('returns GOAL-typed task with dueDate, sections, and metadata intact', async () => {
      const dueDate = new Date('2026-06-15T00:00:00.000Z');
      mockTaskService.findOneByOrganization.mockResolvedValue({
        id: ENTITY_ID,
        name: 'Ship widgets v1',
        type: 'GOAL',
        status: 'ACTIVE',
        dueDate,
        priority: 'HIGH',
        parentTaskId: null,
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        sections: [
          makeSection(
            'description',
            0,
            'Land widgets across web and mobile by June 15.',
          ),
        ],
      });

      const result = await provider.getFullEntity(
        { entities: [{ entityType: 'TASK', entityId: ENTITY_ID }] },
        {} as any,
        makeRequest(),
      );

      expect((result as any).isError).toBeUndefined();
      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed[ENTITY_ID].type).toBe('GOAL');
      expect(parsed[ENTITY_ID].name).toBe('Ship widgets v1');
      // dueDate must round-trip — goals are time-bound by definition.
      expect(parsed[ENTITY_ID].dueDate).toBe(dueDate.toISOString());
      expect(parsed[ENTITY_ID].parentTaskId).toBeNull();
      expect(parsed[ENTITY_ID].sections.description).toBe(
        'Land widgets across web and mobile by June 15.',
      );
    });

    it('uses the canonical organization-scoped task boundary', async () => {
      mockTaskService.findOneByOrganization.mockResolvedValue({
        id: ENTITY_ID,
        projectId: PROJECT_ID,
        sections: [],
      });

      await provider.getFullEntity(
        { entities: [{ entityType: 'TASK', entityId: ENTITY_ID }] },
        {} as any,
        makeRequest(),
      );

      expect(mockTaskService.findOneByOrganization).toHaveBeenCalledWith(
        ORG_ID,
        ENTITY_ID,
      );
    });
  });

  describe('INITIATIVE', () => {
    it('returns full initiative with sections', async () => {
      mockInitiative.findFirst.mockResolvedValue({
        id: ENTITY_ID,
        name: 'My Initiative',
        sections: [makeSection('overview', 0, 'Overview content')],
      });

      const result = await provider.getFullEntity(
        { entities: [{ entityType: 'INITIATIVE', entityId: ENTITY_ID }] },
        {} as any,
        makeRequest(),
      );

      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed[ENTITY_ID].name).toBe('My Initiative');
      expect(parsed[ENTITY_ID].sections.overview).toBe('Overview content');
    });
  });

  describe('DESIGN_DOC', () => {
    it('returns full design doc with sections', async () => {
      mockDesignDoc.findFirst.mockResolvedValue({
        id: ENTITY_ID,
        name: 'ADR-001',
        template: 'ADR',
        sections: [
          makeSection('context', 0, 'We need to decide on auth'),
          makeSection('decision', 1, 'Use JWT'),
        ],
      });

      const result = await provider.getFullEntity(
        { entities: [{ entityType: 'DESIGN_DOC', entityId: ENTITY_ID }] },
        {} as any,
        makeRequest(),
      );

      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed[ENTITY_ID].name).toBe('ADR-001');
      expect(parsed[ENTITY_ID].sections.context).toBe(
        'We need to decide on auth',
      );
      expect(parsed[ENTITY_ID].sections.decision).toBe('Use JWT');
    });
  });

  describe('PLAN', () => {});

  describe('PLAN_STAGE', () => {});

  describe('SERVICE', () => {
    it('returns service with implementation hints', async () => {
      mockService.findFirst.mockResolvedValue({
        id: ENTITY_ID,
        name: 'API Gateway',
        implementationHints: [
          { id: 'h1', featureName: 'Auth', description: 'JWT flow' },
        ],
      });

      const result = await provider.getFullEntity(
        { entities: [{ entityType: 'SERVICE', entityId: ENTITY_ID }] },
        {} as any,
        makeRequest(),
      );

      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed[ENTITY_ID].name).toBe('API Gateway');
      expect(parsed[ENTITY_ID].implementationHints).toHaveLength(1);
    });
  });

  describe('IMPLEMENTATION_HINT', () => {
    it('returns hint with file references', async () => {
      mockImplementationHint.findFirst.mockResolvedValue({
        id: ENTITY_ID,
        featureName: 'Auth Middleware',
        hint: 'Use passport.js',
        fileReferences: [
          { filePath: 'src/auth/middleware.ts', startLine: 10, endLine: 50 },
        ],
      });

      const result = await provider.getFullEntity(
        {
          entities: [
            { entityType: 'IMPLEMENTATION_HINT', entityId: ENTITY_ID },
          ],
        },
        {} as any,
        makeRequest(),
      );

      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed[ENTITY_ID].featureName).toBe('Auth Middleware');
      expect(parsed[ENTITY_ID].fileReferences[0].filePath).toBe(
        'src/auth/middleware.ts',
      );
    });

    it('scopes query through service.organizationId', async () => {
      mockImplementationHint.findFirst.mockResolvedValue(null);

      await provider.getFullEntity(
        {
          entities: [
            { entityType: 'IMPLEMENTATION_HINT', entityId: ENTITY_ID },
          ],
        },
        {} as any,
        makeRequest(),
      );

      expect(mockImplementationHint.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: ENTITY_ID,
            service: { organizationId: ORG_ID },
          },
        }),
      );
    });
  });

  describe('error handling', () => {
    it('propagates malformed FEATURE requirements instead of treating them as not found', async () => {
      mockTaskService.findOneByOrganization.mockResolvedValue({
        id: ENTITY_ID,
        projectId: PROJECT_ID,
        type: 'FEATURE',
        sections: [makeSection('requirements', 0, '{"records":')],
      });

      await expect(
        provider.getFullEntity(
          { entities: [{ entityType: 'TASK', entityId: ENTITY_ID }] },
          {} as any,
          makeRequest(),
        ),
      ).rejects.toEqual(
        expect.objectContaining<Partial<FeatureRequirementsReadError>>({
          name: 'FeatureRequirementsReadError',
          code: 'invalid_content',
        }),
      );
    });

    it('returns null for that key on prisma failure without failing the batch', async () => {
      mockTaskService.findOneByOrganization.mockRejectedValue(
        new Error('Connection refused'),
      );

      const result = await provider.getFullEntity(
        { entities: [{ entityType: 'TASK', entityId: ENTITY_ID }] },
        {} as any,
        makeRequest(),
      );

      expect((result as any).isError).toBeUndefined();
      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed[ENTITY_ID]).toBeNull();
    });
  });

  describe('section formatting', () => {
    it('sorts sections by order', async () => {
      mockTaskService.findOneByOrganization.mockResolvedValue({
        id: ENTITY_ID,
        projectId: PROJECT_ID,
        sections: [
          makeSection('second', 2, 'B'),
          makeSection('first', 1, 'A'),
          makeSection('third', 3, 'C'),
        ],
      });

      const result = await provider.getFullEntity(
        { entities: [{ entityType: 'TASK', entityId: ENTITY_ID }] },
        {} as any,
        makeRequest(),
      );

      const parsed = JSON.parse((result as any).content[0].text);
      const keys = Object.keys(parsed[ENTITY_ID].sections);
      expect(keys).toEqual(['first', 'second', 'third']);
    });

    it('handles null materializedMarkdown as empty string', async () => {
      mockTaskService.findOneByOrganization.mockResolvedValue({
        id: ENTITY_ID,
        projectId: PROJECT_ID,
        sections: [makeSection('empty', 0, null as any)],
      });

      const result = await provider.getFullEntity(
        { entities: [{ entityType: 'TASK', entityId: ENTITY_ID }] },
        {} as any,
        makeRequest(),
      );

      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed[ENTITY_ID].sections.empty).toBe('');
    });
  });

  describe('batch behavior', () => {
    it('retrieves multiple entities across types in one call', async () => {
      mockTaskService.findOneByOrganization.mockResolvedValue({
        id: ENTITY_ID,
        name: 'Task One',
        projectId: PROJECT_ID,
        sections: [],
      });
      mockInitiative.findFirst.mockResolvedValue({
        id: ENTITY_ID_2,
        name: 'Initiative One',
        sections: [],
      });

      const result = await provider.getFullEntity(
        {
          entities: [
            { entityType: 'TASK', entityId: ENTITY_ID },
            { entityType: 'INITIATIVE', entityId: ENTITY_ID_2 },
          ],
        },
        {} as any,
        makeRequest(),
      );

      expect((result as any).isError).toBeUndefined();
      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed[ENTITY_ID].name).toBe('Task One');
      expect(parsed[ENTITY_ID_2].name).toBe('Initiative One');
    });

    it('returns null for not-found entry without failing the batch', async () => {
      mockTaskService.findOneByOrganization.mockResolvedValue({
        id: ENTITY_ID,
        name: 'Task One',
        projectId: PROJECT_ID,
        sections: [],
      });
      mockInitiative.findFirst.mockResolvedValue(null);

      const result = await provider.getFullEntity(
        {
          entities: [
            { entityType: 'TASK', entityId: ENTITY_ID },
            { entityType: 'INITIATIVE', entityId: ENTITY_ID_2 },
          ],
        },
        {} as any,
        makeRequest(),
      );

      expect((result as any).isError).toBeUndefined();
      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed[ENTITY_ID].name).toBe('Task One');
      expect(parsed[ENTITY_ID_2]).toBeNull();
    });

    it('isolates an inaccessible task from a valid task in the same batch', async () => {
      mockTaskService.findOneByOrganization.mockImplementation(
        (_organizationId, id) =>
          Promise.resolve(
            id === ENTITY_ID
              ? null
              : {
                  id,
                  name: 'Visible Neighbor',
                  projectId: PROJECT_ID,
                  organizationId: ORG_ID,
                  status: 'ACTIVE',
                  sections: [],
                },
          ),
      );

      const result = await provider.getFullEntity(
        {
          entities: [
            { entityType: 'TASK', entityId: ENTITY_ID },
            { entityType: 'TASK', entityId: ENTITY_ID_2 },
          ],
        },
        {} as any,
        makeRequest(),
      );

      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed[ENTITY_ID]).toBeNull();
      expect(parsed[ENTITY_ID_2]).toEqual(
        expect.objectContaining({
          id: ENTITY_ID_2,
          name: 'Visible Neighbor',
          replacement: { state: 'NOT_SUPERSEDED', replacedBy: [] },
        }),
      );
    });

    it('isolates a replacement lookup failure to the affected batch entry', async () => {
      mockTaskService.findOneByOrganization.mockImplementation((_orgId, id) =>
        Promise.resolve({
          id,
          name: id === ENTITY_ID ? 'Broken Neighbor' : 'Valid Neighbor',
          projectId: PROJECT_ID,
          organizationId: ORG_ID,
          status: 'ACTIVE',
          sections: [],
        }),
      );
      mockAgentEdgeClient.findIncident.mockImplementation(
        (_organizationId, _projectId, request) =>
          request.nodeIds.has(ENTITY_ID)
            ? Promise.reject(new Error('Graph unavailable for one entity'))
            : Promise.resolve([]),
      );

      const result = await provider.getFullEntity(
        {
          entities: [
            { entityType: 'TASK', entityId: ENTITY_ID },
            { entityType: 'TASK', entityId: ENTITY_ID_2 },
          ],
        },
        {} as any,
        makeRequest(),
      );

      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed[ENTITY_ID]).toBeNull();
      expect(parsed[ENTITY_ID_2]).toEqual(
        expect.objectContaining({
          id: ENTITY_ID_2,
          name: 'Valid Neighbor',
          replacement: { state: 'NOT_SUPERSEDED', replacedBy: [] },
        }),
      );
    });

    it('rejects batches with more than 10 pairs', () => {
      const pairs = Array.from({ length: 11 }, (_, i) => ({
        entityType: 'TASK' as const,
        entityId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      }));

      const result = getFullEntityParameters.safeParse({ entities: pairs });
      expect(result.success).toBe(false);
    });
  });
});
