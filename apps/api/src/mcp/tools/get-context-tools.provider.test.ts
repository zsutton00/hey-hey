import type { Request } from 'express';
import type { Context } from '@rekog/mcp-nest';
import Ajv from 'ajv';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  getContextOutput,
  getContextParameters,
  getContextResultOutput,
  GetContextToolsProvider,
} from './get-context-tools.provider';
import { EntityContextService } from '../../services/entity-context/entity-context.service';
import * as TestUtils from '../../utils/testUtils';
import type { FullEntityContextDto } from '../../generated/model/fullEntityContextDto';

const { testIds } = TestUtils;

const entityId = '123e4567-e89b-42d3-a456-426614174099';
const proposalIdA = '123e4567-e89b-42d3-a456-426614174050';
const proposalIdB = '123e4567-e89b-42d3-a456-426614174051';
const relatedTaskId = '123e4567-e89b-42d3-a456-426614174080';
const relatedPlanId = '123e4567-e89b-42d3-a456-426614174081';
const TEST_TOKEN = 'test-bearer-token';

function makeRequest(token: string | null = TEST_TOKEN): Request {
  const user = {
    id: testIds.user,
    currentOrgId: testIds.organization,
    orgId: testIds.organization,
  };
  return {
    user,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as unknown as Request;
}

function makeParams(overrides?: Record<string, string>) {
  return {
    entityId,
    entityType: 'TASK',
    projectId: testIds.project,
    ...overrides,
  };
}

function makeSeed(
  id: string,
  overrides?: Partial<{ entityType: string; projectId: string }>,
) {
  return {
    entityId: id,
    entityType: 'TASK',
    projectId: testIds.project,
    ...overrides,
  };
}

const featureParentId = '123e4567-e89b-42d3-a456-426614174085';
const featureChildId = '123e4567-e89b-42d3-a456-426614174086';
const parentPlanId = '123e4567-e89b-42d3-a456-426614174087';
const parentStageId = '123e4567-e89b-42d3-a456-426614174088';
const siblingStageId = '123e4567-e89b-42d3-a456-426614174089';

const parentPlan = {
  id: parentPlanId,
  entityType: 'TASK',
  taskType: 'PLAN',
  displayName: 'Context rollout plan',
  status: 'ACTIVE',
};
const parentStage = {
  id: parentStageId,
  entityType: 'TASK',
  taskType: 'PLAN_STAGE',
  displayName: 'Restore MCP parity',
  status: 'ACTIVE',
};
const siblingStage = {
  id: siblingStageId,
  entityType: 'TASK',
  taskType: 'PLAN_STAGE',
  displayName: 'Verify MCP parity',
  status: 'BACKLOG',
};

function makeFullEntityContext(overrides?: Record<string, unknown>) {
  return {
    entityId,
    entityType: 'TASK',
    taskType: 'STANDARD',
    displayName: 'Context task',
    createdAt: '2026-02-15T08:00:00.000Z',
    creatingProposalId: proposalIdA,
    proposalDetail: 'summary',
    olderProposalsOmitted: false,
    featureHierarchy: [
      {
        id: featureParentId,
        name: 'Parent Feature',
        relationshipType: 'structural',
        relationship: 'ancestor',
        distance: 1,
      },
      {
        id: featureChildId,
        name: 'Child Feature',
        relationshipType: 'structural',
        relationship: 'descendant',
        distance: 1,
      },
    ],
    proposals: [
      {
        id: proposalIdA,
        organizationId: testIds.organization,
        projectId: testIds.project,
        type: 'SINGLE',
        action: 'CREATE',
        status: 'APPROVED',
        targetEntityId: entityId,
        targetEntityType: 'TASK',
        title: 'Context task',
        requestorId: testIds.user,
        requiredApprovals: 1,
        approvals: [],
        influences: undefined,
        conversationId: undefined,
        createdAt: '2026-02-15T08:00:00.000Z',
        updatedAt: '2026-02-15T08:00:00.000Z',
        changes: [
          {
            path: 'name',
            type: 'string',
            unavailableReason: 'no-older-proposal',
            searchedProposalCount: 0,
          },
          {
            path: 'sections.description.content',
            type: 'markdown',
            diff: '@@ -1,1 +1,1 @@\n-Old copy\n+New copy',
            diffTruncated: false,
            diffOmittedCharacters: 0,
          },
        ],
      },
    ],
    availableMcpTools: [
      {
        toolName: 'edit_task',
        targetEntityType: 'TASK',
        label: 'Edit Task...',
        description: 'Propose changes to this task',
      },
    ],
    relatedEntities: [
      {
        entityId: relatedTaskId,
        entityType: 'TASK',
        displayName: 'Sibling Task',
        status: 'BACKLOG',
        taskType: 'STANDARD',
        relationship: 'sibling-via-parent',
        via: [
          {
            entityId: featureParentId,
            entityType: 'TASK',
            displayName: 'Parent Feature',
            relationship: 'sibling-via-parent',
          },
        ],
      },
      {
        entityId: relatedPlanId,
        entityType: 'PLAN',
        displayName: 'Initiatives to Features',
        status: 'ACTIVE',
        relationship: 'mentions',
      },
    ],
    agentSessions: [],
    ...overrides,
  };
}

describe('GetContextToolsProvider', () => {
  let provider: GetContextToolsProvider;
  let entityContextService: jest.Mocked<EntityContextService>;
  let agentEdgeClient: { list: jest.Mock };
  let proposalApprovalService: {
    readFutureProposalApprovalStates: jest.Mock;
  };

  beforeEach(() => {
    entityContextService = {
      getFullEntityContext: jest.fn(),
    } as unknown as jest.Mocked<EntityContextService>;
    agentEdgeClient = {
      list: jest.fn().mockResolvedValue({
        content: [],
        page: { number: 0, totalPages: 1 },
      }),
    };
    proposalApprovalService = {
      readFutureProposalApprovalStates: jest.fn().mockResolvedValue([]),
    };

    provider = new GetContextToolsProvider(
      entityContextService,
      agentEdgeClient as any,
      proposalApprovalService as any,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Happy Path ────────────────────────────────────────────────────────

  describe('successful response shape', () => {
    it('returns provenance fields from full entity context', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext() as any,
      );

      const result = await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      );

      expect(result).toEqual(
        expect.objectContaining({
          entityId,
          entityType: 'TASK',
          taskType: 'STANDARD',
          createdAt: '2026-02-15T08:00:00.000Z',
          creatingProposalId: proposalIdA,
        }),
      );
    });

    it('passes the validated FEATURE requirements section through unchanged', async () => {
      const requirementTaskId = '123e4567-e89b-42d3-a456-426614174091';
      const requirementsSection = {
        records: [
          {
            id: '123e4567-e89b-42d3-a456-426614174092',
            statement: 'Grouped requirement',
            group: 'Access control',
            designedBy: [],
            fulfilledBy: [{ entityType: 'TASK', entityId: requirementTaskId }],
            contracts: [],
          },
          {
            id: '123e4567-e89b-42d3-a456-426614174093',
            statement: 'Legacy ungrouped requirement',
            designedBy: [],
            fulfilledBy: [],
            contracts: [],
          },
        ],
      };
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext({
          taskType: 'FEATURE',
          content: {
            sections: {
              requirements: JSON.stringify(requirementsSection),
            },
            requirementsSection,
          },
        }) as any,
      );

      const result = (await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.content.requirementsSection).toEqual(requirementsSection);
      expect(result.content).not.toHaveProperty('requirementsStructured');
    });

    it('passes the shared proposal summary through unchanged', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext() as any,
      );

      const result = (await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.proposals[0]).not.toHaveProperty('updates');
      expect(result.proposals[0]).toMatchObject({
        id: proposalIdA,
        action: 'CREATE',
        status: 'APPROVED',
        targetEntityType: 'TASK',
        createdAt: '2026-02-15T08:00:00.000Z',
        changes: expect.arrayContaining([
          expect.objectContaining({ path: 'name' }),
          expect.objectContaining({
            path: 'sections.description.content',
            diff: '@@ -1,1 +1,1 @@\n-Old copy\n+New copy',
          }),
        ]),
      });
    });

    it('passes relatedEntities and agentSessions through from service response', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext() as any,
      );

      const result = (await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.relatedEntities).toHaveLength(2);
      expect(result.agentSessions).toEqual([]);

      const ids = result.relatedEntities.map((e: any) => e.entityId);
      expect(ids).toContain(relatedTaskId);
      expect(ids).toContain(relatedPlanId);

      const planEntry = result.relatedEntities.find(
        (e: any) => e.entityId === relatedPlanId,
      );
      expect(planEntry.relationship).toBe('mentions');
      const siblingEntry = result.relatedEntities.find(
        (e: any) => e.entityId === relatedTaskId,
      );
      expect(siblingEntry.relationship).toBe('sibling-via-parent');
      expect(siblingEntry.taskType).toBe('STANDARD');
      expect(siblingEntry.via).toHaveLength(1);
      expect(siblingEntry.via[0].entityId).toBe(featureParentId);
    });

    it('validates system and agent related entities against the registered output schema', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext({
          relatedEntities: [
            {
              entityId: relatedTaskId,
              entityType: 'TASK',
              displayName: 'System-derived sibling',
              relationship: 'sibling-via-parent',
              source: 'system',
            },
            {
              entityId: relatedPlanId,
              entityType: 'PLAN',
              displayName: 'Agent-authored dependency',
              relationship: 'depends-on',
              source: 'agent',
              reasoning: 'The plan provides the dependency context.',
            },
          ],
        }) as any,
      );

      const result = await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      );
      const schema = zodToJsonSchema(getContextOutput, {
        target: 'jsonSchema7',
        $refStrategy: 'none',
      });
      const validate = new Ajv({
        allErrors: true,
        strict: false,
        formats: { uuid: true },
      }).compile(schema);

      expect(validate(result)).toBe(true);
      expect(validate.errors).toBeNull();
    });

    it('preserves direction-qualified TRACKS labels and subtypes', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext({
          taskType: 'GOAL',
          relatedEntities: [
            {
              entityId: relatedTaskId,
              entityType: 'TASK',
              displayName: 'Tracked Standard Task',
              relationship: 'tracked-by',
              taskType: 'STANDARD',
            },
          ],
        }) as any,
      );

      const result = (await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.taskType).toBe('GOAL');
      expect(result.relatedEntities).toEqual([
        expect.objectContaining({
          relationship: 'tracked-by',
          taskType: 'STANDARD',
        }),
      ]);
    });

    it('passes agentSessions through as a separate top-level array', async () => {
      const sessionId = '123e4567-e89b-42d3-a456-426614174090';
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext({
          agentSessions: [
            {
              entityId: sessionId,
              entityType: 'AGENT_SESSION',
              displayName: 'Coding session',
              status: 'COMPLETED',
            },
          ],
        }) as any,
      );

      const result = (await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.agentSessions).toHaveLength(1);
      expect(result.agentSessions[0]).toMatchObject({
        entityId: sessionId,
        entityType: 'AGENT_SESSION',
        displayName: 'Coding session',
        status: 'COMPLETED',
      });
      // Agent sessions live in their own field, never in relatedEntities.
      expect(
        result.relatedEntities.some((e: any) => e.entityId === sessionId),
      ).toBe(false);
    });

    it('passes featureHierarchy through from service response', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext() as any,
      );

      const result = (await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.featureHierarchy).toHaveLength(2);
      expect(result.featureHierarchy[0]).toMatchObject({
        id: featureParentId,
        name: 'Parent Feature',
        relationship: 'ancestor',
        distance: 1,
      });
      expect(result.featureHierarchy[1]).toMatchObject({
        id: featureChildId,
        name: 'Child Feature',
        relationship: 'descendant',
        distance: 1,
      });
    });

    it('returns empty featureHierarchy array (not omitted) when entity has no feature hierarchy', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext({ featureHierarchy: [] }) as any,
      );

      const result = (await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      )) as any;

      expect(result).toHaveProperty('featureHierarchy');
      expect(result.featureHierarchy).toEqual([]);
    });

    it('returns populated plan context unchanged and validates it against the registered output schema', async () => {
      const planContext = {
        parentPlan,
        parentStage,
        siblingStages: [parentStage, siblingStage],
      };
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext({ planContext }) as any,
      );

      const result = await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      );
      const schema = zodToJsonSchema(getContextOutput, {
        target: 'jsonSchema7',
        $refStrategy: 'none',
      });
      const validate = new Ajv({
        allErrors: true,
        strict: false,
        formats: { uuid: true },
      }).compile(schema);

      expect(result).toHaveProperty('planContext', planContext);
      expect(validate(result)).toBe(true);
      expect(validate.errors).toBeNull();
      expect(entityContextService.getFullEntityContext).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        'TASK',
        entityId,
        TEST_TOKEN,
        { relatedEntityDepth: 2, proposalDetail: 'summary' },
      );
    });

    it('preserves the shared sibling, dependency and session projection at two hops', async () => {
      const projection: FullEntityContextDto = {
        entityId,
        entityType: 'TASK',
        displayName: 'Implementation',
        createdAt: '2026-10-13T00:00:00Z',
        relatedEntities: [
          {
            entityId: relatedTaskId,
            entityType: 'TASK',
            displayName: 'Sibling implementation',
            relationship: 'sibling-via-parent',
            source: 'system',
            via: [
              {
                entityId: featureParentId,
                entityType: 'TASK',
                displayName: 'Parent capability',
                relationship: 'sibling-via-parent',
              },
            ],
          },
          {
            entityId: relatedPlanId,
            entityType: 'TASK',
            displayName: 'Linked dependency',
            taskType: 'BUG',
            relationship: 'depends-on',
            source: 'agent',
          },
        ],
        agentSessions: [
          {
            entityId: '123e4567-e89b-42d3-a456-426614174084',
            entityType: 'AGENT_SESSION',
            displayName: 'Attached session',
            status: 'IN_PROGRESS',
          },
        ],
      };
      entityContextService.getFullEntityContext.mockResolvedValue(projection);
      const result = await provider.getContext(
        makeParams(),
        {} as Context,
        makeRequest(),
      );
      expect(result).toMatchObject(projection);
      expect(entityContextService.getFullEntityContext).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        'TASK',
        entityId,
        TEST_TOKEN,
        { relatedEntityDepth: 2, proposalDetail: 'summary' },
      );
    });

    it('omits plan context when the shared projection does not provide it', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext() as any,
      );

      const result = await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      );

      expect(result).not.toHaveProperty('planContext');
    });
  });

  // ── Error Handling ──────────────────────────────────────────────────

  describe('future proposal dependencies', () => {
    const futureProposalId = '123e4567-e89b-42d3-a456-426614174201';
    const futureId = '123e4567-e89b-42d3-a456-426614174202';
    const dependentTaskId = '123e4567-e89b-42d3-a456-426614174203';
    const edge = (
      sourceNodeId: string,
      targetNodeId: string,
      type: string,
      targetEntityType: string,
    ) => ({ sourceNodeId, targetNodeId, type, targetEntityType });

    it('reads approval state only for task-sourced DEPENDS_ON proposal edges', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext() as any,
      );
      agentEdgeClient.list.mockResolvedValue({
        content: [
          edge(entityId, futureProposalId, 'DEPENDS_ON', 'PROPOSAL'),
          edge(entityId, dependentTaskId, 'RELATED_TO', 'PROPOSAL'),
          edge(dependentTaskId, entityId, 'DEPENDS_ON', 'PROPOSAL'),
          edge(entityId, dependentTaskId, 'DEPENDS_ON', 'TASK'),
        ],
        page: { number: 0, totalPages: 1 },
      });
      const state = {
        kind: 'future',
        proposalId: futureProposalId,
        proposalTitle: 'Revise API',
        futureId,
        status: 'DRAFT',
        approvalsRecorded: 0,
        requiredApprovals: 1,
      };
      proposalApprovalService.readFutureProposalApprovalStates.mockResolvedValue(
        [state],
      );

      const result = (await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      )) as any;

      expect(
        proposalApprovalService.readFutureProposalApprovalStates,
      ).toHaveBeenCalledWith(
        [futureProposalId],
        expect.any(String),
        expect.any(String),
      );
      expect(agentEdgeClient.list).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        {
          type: 'DEPENDS_ON',
          sourceNodeId: entityId,
          page: 0,
          size: 100,
        },
        TEST_TOKEN,
      );
      expect(result.futureProposalDependencies).toEqual({
        status: 'loaded',
        proposals: [state],
      });
      expect(result.relatedEntities).toHaveLength(2);
    });

    it('reads every dependency page before resolving proposals', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext() as any,
      );
      const proposalIds = Array.from(
        { length: 101 },
        (_, index) =>
          `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`,
      );
      agentEdgeClient.list.mockImplementation(
        async (_org, _project, options) => ({
          content:
            options.page === 0
              ? proposalIds
                  .slice(0, 100)
                  .map((id) => edge(entityId, id, 'DEPENDS_ON', 'PROPOSAL'))
              : [edge(entityId, proposalIds[100]!, 'DEPENDS_ON', 'PROPOSAL')],
          page: { number: options.page, totalPages: 2 },
        }),
      );
      proposalApprovalService.readFutureProposalApprovalStates.mockResolvedValue(
        [],
      );

      const result = (await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      )) as any;

      expect(agentEdgeClient.list).toHaveBeenCalledTimes(2);
      expect(agentEdgeClient.list).toHaveBeenNthCalledWith(
        2,
        testIds.organization,
        testIds.project,
        {
          type: 'DEPENDS_ON',
          sourceNodeId: entityId,
          page: 1,
          size: 100,
        },
        TEST_TOKEN,
      );
      expect(
        proposalApprovalService.readFutureProposalApprovalStates,
      ).toHaveBeenCalledWith(
        proposalIds,
        testIds.organization,
        testIds.project,
      );
      expect(result.futureProposalDependencies).toEqual({
        status: 'loaded',
        proposals: [],
      });
    });

    it('reports graph failures as unavailable', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext() as any,
      );
      agentEdgeClient.list.mockRejectedValue(new Error('Graph unavailable'));

      const result = (await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.futureProposalDependencies).toEqual({
        status: 'unavailable',
        reason: 'Graph unavailable',
      });
      expect(
        proposalApprovalService.readFutureProposalApprovalStates,
      ).not.toHaveBeenCalled();
    });

    it('reports a missing user token as unavailable', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext() as any,
      );

      const result = (await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(null),
      )) as any;

      expect(agentEdgeClient.list).not.toHaveBeenCalled();
      expect(result.futureProposalDependencies).toEqual({
        status: 'unavailable',
        reason: 'A user token is required to read task dependency edges',
      });
    });

    it('omits the field for non-TASK seeds', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext({ entityType: 'DESIGN_DOC' }) as any,
      );

      const result = (await provider.getContext(
        makeParams({ entityType: 'DESIGN_DOC' }),
        {} as any,
        makeRequest(),
      )) as any;

      expect(agentEdgeClient.list).not.toHaveBeenCalled();
      expect(result.futureProposalDependencies).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('returns mcpError when entity context service fails', async () => {
      entityContextService.getFullEntityContext.mockRejectedValue(
        new Error('Entity not found'),
      );

      const result = (await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Entity not found');
    });

    it.each(['FEATURE', 'GOAL', 'BUG', 'STANDARD'])(
      'returns a teaching mcpError when entityType is the task type %s',
      async (taskType) => {
        const result = (await provider.getContext(
          makeParams({ entityType: taskType }),
          {} as any,
          makeRequest(),
        )) as any;

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(
          `'${taskType}' is a task type, not an entity type`,
        );
        expect(result.content[0].text).toContain("entityType: 'TASK'");
        // The task-type guard short-circuits before the service is reached.
        expect(
          entityContextService.getFullEntityContext,
        ).not.toHaveBeenCalled();
      },
    );
  });

  describe('single-or-batch request validation', () => {
    it('rejects neither request form', async () => {
      const result = (await provider.getContext(
        {},
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('exactly one complete singular');
    });

    it('rejects both request forms', async () => {
      const result = (await provider.getContext(
        { ...makeParams(), seeds: [makeSeed(entityId)] },
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.isError).toBe(true);
      expect(entityContextService.getFullEntityContext).not.toHaveBeenCalled();
    });

    it.each([
      { entityId },
      { entityType: 'TASK' },
      { entityId, projectId: testIds.project },
      { entityType: 'TASK', projectId: testIds.project },
    ])('rejects an incomplete singular seed %#', async (params) => {
      const result = (await provider.getContext(
        params,
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.isError).toBe(true);
      expect(entityContextService.getFullEntityContext).not.toHaveBeenCalled();
    });

    it('rejects empty and over-limit batches at runtime', async () => {
      const empty = (await provider.getContext(
        { seeds: [] },
        {} as any,
        makeRequest(),
      )) as any;
      const overLimit = (await provider.getContext(
        { seeds: Array.from({ length: 6 }, () => makeSeed(entityId)) },
        {} as any,
        makeRequest(),
      )) as any;

      expect(empty.isError).toBe(true);
      expect(overLimit.isError).toBe(true);
      expect(overLimit.content[0].text).toContain('at most 5');
    });

    it('registers schemas that accept valid forms and reject invalid batches', () => {
      const parametersSchema = zodToJsonSchema(getContextParameters, {
        target: 'jsonSchema7',
        $refStrategy: 'none',
      });
      const outputSchema = zodToJsonSchema(getContextResultOutput, {
        target: 'jsonSchema7',
        $refStrategy: 'none',
      });
      const ajv = new Ajv({
        allErrors: true,
        strict: false,
        formats: { uuid: true },
      });
      const validateParameters = ajv.compile(parametersSchema);
      const validateOutput = ajv.compile(outputSchema);

      expect(validateParameters(makeParams())).toBe(true);
      expect(validateParameters({ seeds: [makeSeed(entityId)] })).toBe(true);
      expect(validateParameters({ seeds: [] })).toBe(false);
      expect(
        validateParameters({
          seeds: Array.from({ length: 6 }, () => makeSeed(entityId)),
        }),
      ).toBe(false);
      expect(
        validateParameters({
          seeds: [makeSeed(entityId), { entityId: 'not-a-uuid' }],
        }),
      ).toBe(true);
      expect(
        validateOutput({
          items: [{ seed: makeSeed(entityId), error: 'Entity not found' }],
        }),
      ).toBe(true);
    });
  });

  describe('batch execution', () => {
    const entityIdB = '123e4567-e89b-42d3-a456-426614174100';
    const entityIdC = '123e4567-e89b-42d3-a456-426614174101';

    it('preserves the existing singular response shape', async () => {
      const context = makeFullEntityContext();
      entityContextService.getFullEntityContext.mockResolvedValue(
        context as any,
      );

      const result = await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      );

      expect(result).toEqual(
        expect.objectContaining({
          entityId,
          displayName: 'Context task',
        }),
      );
      expect(result).not.toHaveProperty('items');
    });

    it('keeps input order when reads finish out of order', async () => {
      const resolvers = new Map<string, (value: any) => void>();
      entityContextService.getFullEntityContext.mockImplementation(
        (_organizationId, _projectId, _entityType, id) =>
          new Promise((resolve) => resolvers.set(id, resolve)),
      );
      const promise = provider.getContext(
        { seeds: [makeSeed(entityId), makeSeed(entityIdB)] },
        {} as any,
        makeRequest(),
      );
      await Promise.resolve();
      resolvers.get(entityIdB)!(
        makeFullEntityContext({ entityId: entityIdB, displayName: 'Second' }),
      );
      resolvers.get(entityId)!(makeFullEntityContext({ displayName: 'First' }));

      const result = (await promise) as any;
      expect(result.items.map((item: any) => item.seed.entityId)).toEqual([
        entityId,
        entityIdB,
      ]);
      expect(result.items.map((item: any) => item.result.displayName)).toEqual([
        'First',
        'Second',
      ]);
    });

    it('isolates failures and preserves successful siblings', async () => {
      entityContextService.getFullEntityContext.mockImplementation(
        async (_organizationId, _projectId, _entityType, id) => {
          if (id === entityIdB) throw new Error('Entity not found');
          return makeFullEntityContext() as any;
        },
      );

      const result = (await provider.getContext(
        { seeds: [makeSeed(entityId), makeSeed(entityIdB)] },
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.items[0].result.entityId).toBe(entityId);
      expect(result.items[0]).not.toHaveProperty('error');
      expect(result.items[1].error).toContain('Entity not found');
      expect(result.items[1]).not.toHaveProperty('result');
    });

    it('isolates malformed seeds before loading valid siblings', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext() as any,
      );

      const malformedSeed = { entityId: 'not-a-uuid', entityType: 'TASK' };
      const result = (await provider.getContext(
        { seeds: [malformedSeed, makeSeed(entityId)] },
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.items[0]).toEqual({
        seed: malformedSeed,
        error: 'Invalid context seed',
      });
      expect(result.items[1].result.entityId).toBe(entityId);
      expect(entityContextService.getFullEntityContext).toHaveBeenCalledTimes(
        1,
      );
    });

    it('isolates unexpected per-item failures', async () => {
      entityContextService.getFullEntityContext
        .mockResolvedValueOnce(
          makeFullEntityContext({ proposals: [{}] }) as any,
        )
        .mockResolvedValueOnce(makeFullEntityContext() as any);

      const result = (await provider.getContext(
        { seeds: [makeSeed(entityId), makeSeed(entityIdB)] },
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.items[0].error).toContain(
        'Context summary mode returned a full proposal payload',
      );
      expect(result.items[1].result.entityId).toBe(entityId);
    });

    it('does not deduplicate repeated seeds', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext() as any,
      );

      const result = (await provider.getContext(
        { seeds: [makeSeed(entityId), makeSeed(entityId)] },
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.items).toHaveLength(2);
      expect(entityContextService.getFullEntityContext).toHaveBeenCalledTimes(
        2,
      );
    });

    it('limits batch reads to two in flight', async () => {
      let inFlight = 0;
      let maximumInFlight = 0;
      const releases: Array<() => void> = [];
      entityContextService.getFullEntityContext.mockImplementation(
        async (_organizationId, _projectId, _entityType, id) => {
          inFlight += 1;
          maximumInFlight = Math.max(maximumInFlight, inFlight);
          await new Promise<void>((resolve) => releases.push(resolve));
          inFlight -= 1;
          return makeFullEntityContext({ entityId: id }) as any;
        },
      );
      const promise = provider.getContext(
        {
          seeds: [makeSeed(entityId), makeSeed(entityIdB), makeSeed(entityIdC)],
        },
        {} as any,
        makeRequest(),
      );
      await Promise.resolve();
      expect(inFlight).toBe(2);
      releases.splice(0).forEach((release) => release());
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(maximumInFlight).toBe(2);
      releases.splice(0).forEach((release) => release());
      await promise;

      expect(maximumInFlight).toBe(2);
    });

    it('uses the two-hop summary projection for every seed', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext() as any,
      );

      await provider.getContext(
        { seeds: [makeSeed(entityId), makeSeed(entityIdB)] },
        {} as any,
        makeRequest(),
      );

      expect(entityContextService.getFullEntityContext).toHaveBeenCalledTimes(
        2,
      );
      for (const call of entityContextService.getFullEntityContext.mock.calls) {
        expect(call[5]).toEqual({
          relatedEntityDepth: 2,
          proposalDetail: 'summary',
        });
      }
    });

    it('logs comparative telemetry calculated from the batch response', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext({
          proposals: [],
          relatedEntities: [],
          agentSessions: [],
          featureHierarchy: [],
        }) as any,
      );
      const now = jest
        .spyOn(performance, 'now')
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(1)
        .mockReturnValueOnce(2)
        .mockReturnValueOnce(11)
        .mockReturnValueOnce(22)
        .mockReturnValueOnce(30);
      const logger = (provider as any).logger;
      const log = jest.spyOn(logger, 'log').mockImplementation();

      const response = (await provider.getContext(
        { seeds: [makeSeed(entityId), makeSeed(entityIdB)] },
        {} as any,
        makeRequest(),
      )) as any;

      expect(log).toHaveBeenCalledWith('get_context batch completed', {
        mode: 'batch',
        seedCount: 2,
        successfulCount: 2,
        failedCount: 0,
        omittedCount: 0,
        wallTimeMs: 30,
        serverWorkMs: 30,
        responseBytes: Buffer.byteLength(JSON.stringify(response), 'utf8'),
        resultSize: 2,
      });
      now.mockRestore();
    });
  });

  describe('batch response size budget', () => {
    const ids = [
      '123e4567-e89b-42d3-a456-426614174200',
      '123e4567-e89b-42d3-a456-426614174201',
      '123e4567-e89b-42d3-a456-426614174202',
    ];

    function serveSizes(sizes: number[]) {
      entityContextService.getFullEntityContext.mockImplementation(
        async (_organizationId, _projectId, _entityType, id) =>
          makeFullEntityContext({
            entityId: id,
            displayName: 'x'.repeat(sizes[ids.indexOf(id)]!),
          }) as any,
      );
    }

    async function read(count = ids.length) {
      const response = (await provider.getContext(
        { seeds: ids.slice(0, count).map((id) => makeSeed(id)) },
        {} as any,
        makeRequest(),
      )) as any;
      return { items: response.items, length: JSON.stringify(response).length };
    }

    it('returns every seed whole when under budget', async () => {
      serveSizes([100, 100, 100]);
      const { items } = await read();
      expect(items.map((item: any) => item.result.entityId)).toEqual(ids);
    });

    it('marks the seed that does not fit and every later seed as omitted', async () => {
      serveSizes([15_000, 15_000, 15_000]);
      const { items, length } = await read();
      expect(items[0].result.displayName).toHaveLength(15_000);
      expect(items[1]).toEqual({
        seed: makeSeed(ids[1]!),
        omitted: true,
        reason: 'SIZE_BUDGET',
      });
      expect(items[2]).toEqual({
        seed: makeSeed(ids[2]!),
        omitted: true,
        reason: 'SIZE_BUDGET',
      });
      expect(length).toBeLessThanOrEqual(32_000);
    });

    it('returns an oversized first seed whole', async () => {
      serveSizes([40_000, 1]);
      const { items } = await read(2);
      expect(items[0].result.displayName).toHaveLength(40_000);
      expect(items[1].omitted).toBe(true);
    });

    it('keeps a failed seed in place between returned seeds', async () => {
      entityContextService.getFullEntityContext.mockImplementation(
        async (_organizationId, _projectId, _entityType, id) => {
          if (id === ids[1]) throw new Error('Entity not found');
          return makeFullEntityContext({ entityId: id }) as any;
        },
      );
      const { items } = await read(3);
      expect(items[1].error).toContain('Entity not found');
      expect(items[2].result.entityId).toBe(ids[2]);
    });
  });

  // ── Service Call Parameters ──────────────────────────────────────────

  describe('service call parameters', () => {
    it('passes correct parameters to getFullEntityContext', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext() as any,
      );

      await provider.getContext(makeParams(), {} as any, makeRequest());

      expect(entityContextService.getFullEntityContext).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        'TASK',
        entityId,
        TEST_TOKEN,
        { relatedEntityDepth: 2, proposalDetail: 'summary' },
      );
    });

    it('passes the correct entityType for DESIGN_DOC', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext({ entityType: 'DESIGN_DOC' }) as any,
      );

      await provider.getContext(
        makeParams({ entityType: 'DESIGN_DOC' }),
        {} as any,
        makeRequest(),
      );

      expect(entityContextService.getFullEntityContext).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        'DESIGN_DOC',
        entityId,
        TEST_TOKEN,
        { relatedEntityDepth: 2, proposalDetail: 'summary' },
      );
    });

    it('passes null token when no auth token is present', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext({
          relatedEntities: [],
          agentSessions: [],
        }) as any,
      );

      const result = (await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(null),
      )) as any;

      expect(entityContextService.getFullEntityContext).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        'TASK',
        entityId,
        null,
        { relatedEntityDepth: 2, proposalDetail: 'summary' },
      );

      expect(result.relatedEntities).toEqual([]);
      expect(result.agentSessions).toEqual([]);
    });
  });

  // ── Empty State ───────────────────────────────────────────────────────

  describe('empty state handling', () => {
    it('returns empty proposals and no creatingProposalId when none exist', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext({
          proposals: [],
          creatingProposalId: undefined,
          relatedEntities: [],
          agentSessions: [],
        }) as any,
      );

      const result = (await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.proposals).toEqual([]);
      expect(result.creatingProposalId).toBeUndefined();
      expect(result.relatedEntities).toEqual([]);
      expect(result.agentSessions).toEqual([]);
    });

    it('returns multiple proposal summaries preserving order', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext({
          proposals: [
            {
              id: proposalIdB,
              changes: [],
              action: 'UPDATE',
              status: 'APPROVED',
              targetEntityType: 'TASK',
              influences: null,
              conversationId: undefined,
              createdAt: '2026-03-02T10:00:00.000Z',
              updates: { status: 'IN_PROGRESS' },
            },
            {
              id: proposalIdA,
              changes: [],
              action: 'CREATE',
              status: 'APPROVED',
              targetEntityType: 'TASK',
              influences: null,
              conversationId: undefined,
              createdAt: '2026-02-15T08:00:00.000Z',
              updates: { name: 'My Task' },
            },
          ],
        }) as any,
      );

      const result = (await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.proposals).toHaveLength(2);
      expect(result.proposals[0].id).toBe(proposalIdB);
      expect(result.proposals[1].id).toBe(proposalIdA);
    });
  });

  // ── Content body + backedBy ───────────────────────────────────────────

  describe('content body and backedBy', () => {
    const backingTaskId = '123e4567-e89b-42d3-a456-426614174c01';

    it('passes the content body through from the service response', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext({
          content: {
            sections: {
              description: 'Task description',
              acceptanceCriteria: 'Task AC',
            },
            status: 'ACTIVE',
            priority: 'HIGH',
            assigneeId: '123e4567-e89b-42d3-a456-426614174c08',
            dueDate: '2026-06-01T00:00:00.000Z',
          },
        }) as any,
      );

      const result = (await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.content).toEqual({
        sections: {
          description: 'Task description',
          acceptanceCriteria: 'Task AC',
        },
        status: 'ACTIVE',
        priority: 'HIGH',
        assigneeId: '123e4567-e89b-42d3-a456-426614174c08',
        dueDate: '2026-06-01T00:00:00.000Z',
      });
    });

    it('omits content and backedBy when the service response carries neither', async () => {
      entityContextService.getFullEntityContext.mockResolvedValue(
        makeFullEntityContext() as any,
      );

      const result = (await provider.getContext(
        makeParams(),
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.content).toBeUndefined();
      expect(result).not.toHaveProperty('backedBy');
    });
  });
});
