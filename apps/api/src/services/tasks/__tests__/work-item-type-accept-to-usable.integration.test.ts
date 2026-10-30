import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProposalApprovalService } from '../../proposal/proposal-approval.service';
import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { ProjectApprovalPolicyService } from '../../proposal/project-approval-policy.service';
import { TaskService } from '../task.service';
import { WorkItemTypeImpactService } from '../work-item-type-impact.service';
import { WorkItemTypeRegistryService } from '../work-item-type-registry.service';
import { WorkItemTypeLifecycleService } from '../work-item-type-lifecycle.service';
import { DesignDocService } from '../../design-doc/design-doc.service';
import { InitiativeService } from '../../initiatives/initiative.service';
import { InfluenceService } from '../../influence/influence.service';
import { PendingEdgeService } from '../../proposal/pending-edge.service';
import { ConversationWorkflowService } from '../../workflows/conversation-workflow.service';
import { PlanFromDesignDocLauncherService } from '../../plan/plan-from-design-doc-launcher.service';
import { MentionProcessingService } from '../../mentions/mention-processing.service';
import { WorkItemChangeSetMaterializerService } from '../../proposal/work-item-change-set-materializer.service';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../../core/events/tokens';
import { TEMPORAL_CLIENT } from '../../../prisma/temporal.module';
import { RedisMessageBus } from '../../../core/events/redis-message-bus.service';
import { RedisMemoryServer } from 'redis-memory-server';
import { buildBuiltInWorkItemTypeRows } from '../../../../test/setup/work-item-type-registry.fixture';
import { ProposalToolsProvider } from '../../../mcp/tools/proposal-tools.provider';
import { GetToolGuidanceToolsProvider } from '../../../mcp/tools/get-tool-guidance-tools.provider';
import { guidanceTokenForType } from '../../../mcp/tools/work-item-guidance-token';
import type { ProposalService } from '../../proposal/proposal.service';
import type { WorkItemTypeDefinitionDto } from '../../../generated/model/workItemTypeDefinitionDto';
import { EntityType } from '../../../generated/model/entityType';
import { SessionRole } from '../../../generated/model/sessionRole';
import { WorkItemTypeGuidancePurpose } from '../../../generated/model/workItemTypeGuidancePurpose';
import { WorkStatus } from '../../../generated/model/workStatus';
import * as TestUtils from '../../../utils/testUtils';
import { UserId } from '../../../types';
import { Prisma, type WorkItemType } from '@prisma/client';
import { EntityPromptTemplateService } from '../../entity-prompt-template.service';
import { ProposalReconciliationService } from '../../proposal/proposal-reconciliation.service';

// Stable scope for the whole run. The same projectId carries the accepted
// custom type, the create_work_item header, and the get_tool_guidance header —
// the type resolves only inside this project's scope.
const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const PROJECT_ID = '00000000-0000-4000-8000-0000000000a2';
const USER_ID = '00000000-0000-4000-8000-0000000000a4' as UserId;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const PROPOSAL_ID = '00000000-0000-4000-8000-0000000000b1';

// The project-defined type the run accepts. Required dueDate, forbidden tag and
// parentTaskId, description + requirements sections, and its own create/edit
// standards — every axis sourced from this definition so the post-acceptance
// reads prove the live snapshot carries it, not a precomputed map.
const NEW_TYPE_KEY = 'EXPERIMENT';
const CREATE_STANDARDS =
  'Frame the experiment as a falsifiable hypothesis with an explicit decision rule.';
const EDIT_STANDARDS =
  'Revise the hypothesis only; never rewrite the recorded outcome after the fact.';

const experimentDefinition: WorkItemTypeDefinitionDto = {
  sessionRoleGuidance: {
    implementation: '  Follow the experiment decision rule.  ',
    review: 'Review evidence.',
  },
  key: NEW_TYPE_KEY,
  name: 'Experiment',
  role: 'work-item',
  description: 'A tracked experiment with a hypothesis and a decision rule.',
  sections: [
    {
      key: 'description',
      label: 'Description',
      writingStandard: 'State the hypothesis and what would falsify it.',
    },
    {
      key: 'requirements',
      label: 'Requirements',
      writingStandard: 'List the success metrics and the decision rule.',
    },
  ],
  requiredScalars: ['dueDate'],
  forbiddenScalars: ['tag'],
  allowedStatuses: [
    WorkStatus.Backlog,
    WorkStatus.Active,
    WorkStatus.Completed,
    WorkStatus.Cancelled,
    WorkStatus.Archived,
  ],
  allowedParentTypes: [],
  edgeTargets: [],
  allowedParentEntityTypes: Object.values(EntityType),
  tracking: {
    allowedSourceEntityTypes: [],
    allowedSourceTaskTypes: [],
  },
  agentSettableStatuses: [
    WorkStatus.Backlog,
    WorkStatus.Active,
    WorkStatus.Completed,
  ],
  anchorableReportTypes: [],
  writingStandards: { create: CREATE_STANDARDS, edit: EDIT_STANDARDS },
  capabilities: {
    requiresParent: false,
    planEligible: true,
    hasSetInitialStatus: false,
    showsInExplorerSidebar: true,
  },
};

function makeUser() {
  return {
    userId: USER_ID,
    email: 'agent@example.com',
    name: 'Agent',
    currentOrgId: ORG_ID,
    orgMemberships: [],
    isDevAdmin: false,
    devAdminMode: false,
  };
}

function makeRequest(): any {
  return {
    headers: {
      authorization: 'Bearer tok',
      'x-project-id': PROJECT_ID,
    },
    cookies: {},
    user: makeUser(),
    ip: '127.0.0.1',
  };
}

function guidanceText(result: unknown): { text: string; isError?: boolean } {
  const r = result as { content?: Array<{ text: string }>; isError?: boolean };
  return { text: r.content?.[0]?.text ?? '', isError: r.isError };
}

// A stored WORK_ITEM_TYPE CREATE proposal whose `updates` IS the definition —
// exactly the row tx.proposal.findFirst returns to the approval flow.
function makeWorkItemTypeProposal() {
  return {
    id: PROPOSAL_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    type: 'SINGLE',
    action: 'CREATE',
    status: 'DRAFT',
    targetEntityId: NIL_UUID,
    targetEntityType: 'WORK_ITEM_TYPE',
    updates: experimentDefinition as unknown as Record<string, unknown>,
    requestorId: USER_ID,
    requestorContext: {
      source: 'agent',
      userId: USER_ID,
      organizationId: ORG_ID,
      toolName: 'mcp.create_work_item_type',
      timestamp: '2026-06-14T00:00:00.000Z',
    },
    influences: null,
    generatedWithVersion: null,
    validationSessionId: null,
    conversationId: null,
    messageId: null,
    createdAt: new Date('2026-06-14T00:00:00.000Z'),
    updatedAt: new Date('2026-06-14T00:00:00.000Z'),
  };
}

describe('Accepted work-item type is immediately usable (live registry snapshot)', () => {
  // The single backing store both seams share: the registry's findMany reads it
  // and the approval tx's workItemType.create appends to it, so an accepted row
  // becomes visible to a refresh exactly as it would against one database.
  let rows: WorkItemType[];
  let registry: WorkItemTypeRegistryService;
  let bus: RedisMessageBus;
  let peerBus: RedisMessageBus;
  let peer: WorkItemTypeRegistryService;
  let server: RedisMemoryServer;
  let stagedRows: WorkItemType[];
  let warmedAt: number;

  beforeAll(async () => {
    server = new RedisMemoryServer({
      spawn: { env: { ...process.env, LC_ALL: 'C' } },
    });
    await server.getPort();
  }, 30000);
  afterEach(async () => {
    await Promise.all([registry?.onModuleDestroy(), peer?.onModuleDestroy()]);
    await Promise.all([bus?.onModuleDestroy(), peerBus?.onModuleDestroy()]);
  });
  afterAll(async () => {
    await server?.stop();
  });
  let approvalService: ProposalApprovalService;
  let proposalTools: ProposalToolsProvider;
  let guidanceTools: GetToolGuidanceToolsProvider;
  let proposalCreate: jest.Mock;
  let txMock: Record<string, any>;

  beforeEach(async () => {
    rows = buildBuiltInWorkItemTypeRows(PROJECT_ID);
    stagedRows = [];

    // Live registry: findMany reads the shared store, so each refresh observes
    // every row created since the last one. onModuleInit warms the snapshot AND
    // subscribes to config_changed — the invalidation path under test.
    const registryPrisma = {
      project: {
        findMany: jest.fn(async () => [{ id: PROJECT_ID }]),
      },
      workItemType: {
        findMany: jest.fn(async () => rows.map((row) => ({ ...row }))),
      },
      workItemTypeTemplate: {
        findMany: jest.fn(async () => []),
      },
    } as unknown as PrismaService;
    const url = `redis://${await server.getHost()}:${await server.getPort()}`;
    bus = new RedisMessageBus(url);
    peerBus = new RedisMessageBus(url);
    registry = new WorkItemTypeRegistryService(registryPrisma, bus);
    peer = new WorkItemTypeRegistryService(registryPrisma, peerBus);
    warmedAt = Date.now();
    await registry.onModuleInit();
    await peer.onModuleInit();

    // The approval flow runs inside one $transaction; the tx surface mirrors the
    // proposal-approval unit harness, plus workItemType.create which appends the
    // accepted definition to the SAME store the registry reads.
    txMock = {
      $queryRaw: jest.fn(),
      proposal: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      proposalApprovalRecord: {
        create: jest.fn().mockResolvedValue({ id: 'vote-1' }),
        count: jest.fn().mockResolvedValue(1),
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ userId: USER_ID }]),
      },
      taskSection: { findMany: jest.fn().mockResolvedValue([]) },
      designDocSection: { findMany: jest.fn().mockResolvedValue([]) },
      workItemType: {
        create: jest.fn(async ({ data }: { data: WorkItemType }) => {
          const persisted = {
            ...data,
            graphConfiguration:
              data.graphConfiguration ===
              (Prisma.JsonNull as unknown as typeof data.graphConfiguration)
                ? null
                : data.graphConfiguration,
          };
          stagedRows.push(persisted);
          return persisted;
        }),
      },
    };

    const mockPrisma = TestUtils.createMockPrismaService();
    jest
      .spyOn(mockPrisma.db as any, '$transaction')
      .mockImplementation(async (fn: any) => {
        const result = await fn(txMock);
        await Promise.all([registry.refresh(), peer.refresh()]);
        expect(
          registry.getDefinition(PROJECT_ID, NEW_TYPE_KEY),
        ).toBeUndefined();
        expect(peer.getDefinition(PROJECT_ID, NEW_TYPE_KEY)).toBeUndefined();
        rows.push(...stagedRows);
        stagedRows = [];
        return result;
      });
    (mockPrisma.db as any).proposal = {
      findFirst: txMock.proposal.findFirst,
      findUnique: txMock.proposal.findUnique,
    };
    (mockPrisma.db as any).projectMember = {
      findMany: txMock.projectMember.findMany,
    };
    const mockEventPublisher = TestUtils.createMockDomainEventPublisher();

    const pendingEdgeService = {
      processDeclaredEdges: jest.fn().mockResolvedValue([]),
      materializeEdges: jest.fn().mockResolvedValue(undefined),
      rollbackMaterializedEdges: jest.fn().mockResolvedValue(undefined),
      cleanupForProposal: jest.fn().mockResolvedValue(undefined),
    };
    const mentionProcessingService = {
      extractAndValidate: jest.fn().mockResolvedValue([]),
      extractMentionTokens: jest.fn().mockReturnValue([]),
      validateMentions: jest.fn().mockResolvedValue([]),
      mapMentionEntityType: jest.fn().mockReturnValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ProjectAccessService,
          useValue: { assertProjectRole: jest.fn() },
        },
        ProposalApprovalService,
        ProjectApprovalPolicyService,
        {
          provide: ProposalReconciliationService,
          useValue: {
            assertApplicable: jest.fn(),
            recordCreatedDelivery: jest.fn(),
          },
        },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DOMAIN_EVENT_PUBLISHER_TOKEN, useValue: mockEventPublisher },
        { provide: TaskService, useValue: {} },
        {
          provide: WorkItemTypeImpactService,
          useValue: {
            clearRevokedTrackingLinksForAcceptedEdit: jest
              .fn()
              .mockResolvedValue({ clearedLinkCount: 0 }),
          },
        },
        { provide: WorkItemTypeRegistryService, useValue: registry },
        {
          provide: WorkItemTypeLifecycleService,
          useValue: new WorkItemTypeLifecycleService(registry),
        },
        {
          provide: EntityPromptTemplateService,
          useValue: {
            provisionCustomWorkItemTypeTemplateInTransaction: jest
              .fn()
              .mockResolvedValue(undefined),
          },
        },
        { provide: DesignDocService, useValue: {} },
        { provide: InitiativeService, useValue: {} },
        { provide: InfluenceService, useValue: { createMany: jest.fn() } },
        { provide: PendingEdgeService, useValue: pendingEdgeService },
        { provide: ConversationWorkflowService, useValue: {} },
        { provide: PlanFromDesignDocLauncherService, useValue: {} },
        {
          provide: WorkItemChangeSetMaterializerService,
          useValue: {
            isWorkItemChangeSetValidationRequest: jest
              .fn()
              .mockReturnValue(false),
            taskProposalChangeSet: jest.fn().mockReturnValue(null),
          },
        },
        {
          provide: MentionProcessingService,
          useValue: mentionProcessingService,
        },
        {
          provide: TEMPORAL_CLIENT,
          useValue: { workflow: { start: jest.fn() } },
        },
      ],
    }).compile();

    approvalService = module.get(ProposalApprovalService);

    // Real proposal/guidance tools over the same live registry.
    proposalCreate = jest.fn().mockResolvedValue({
      id: '00000000-0000-4000-8000-0000000000c1',
      action: 'CREATE',
      targetEntityType: 'TASK',
      targetEntityId: NIL_UUID,
      createdAt: '2026-06-14T00:00:00.000Z',
    });
    const proposalService = {
      create: proposalCreate,
      findOne: jest.fn(),
    } as unknown as ProposalService;
    const taskService = { findOne: jest.fn() } as any;
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
    proposalTools = new ProposalToolsProvider(
      proposalService,
      taskService,
      lintRecovery,
      registry,
      prisma,
    );
    guidanceTools = new GetToolGuidanceToolsProvider(registry);
  });

  // Drive a WORK_ITEM_TYPE CREATE proposal through the real approval flow:
  // enactCreateWorkItemType → registry.insertAcceptedDefinitionInTransaction
  // writes the row into the shared store, then the post-commit config_changed
  // invalidation refreshes the registry. Returns once the bus-triggered refresh
  // has settled, so the new type is live in the snapshot.
  async function acceptExperimentType(): Promise<void> {
    const stored = makeWorkItemTypeProposal();
    const approved = { ...stored, status: 'APPROVED' };
    txMock.$queryRaw.mockResolvedValue([{ id: stored.id }]);
    txMock.proposal.findFirst.mockResolvedValue(stored);
    txMock.proposal.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...approved, ...data }),
    );
    txMock.proposal.findUnique.mockResolvedValue({
      ...approved,
      approvalRecords: [],
    });

    // The bus handler refreshes fire-and-forget; capture the refresh promise so
    // the post-commit invalidation is deterministically settled before reads.
    const refreshSpy = jest.spyOn(registry, 'refresh');

    const result = await approvalService.approve(
      PROPOSAL_ID,
      ORG_ID as any,
      PROJECT_ID as any,
      USER_ID,
    );
    expect(result.enacted).toBe(true);
    // The registry mints the row id; resultingEntityId anchors on that new row.
    const createdRow = rows.find((r) => r.typeKey === NEW_TYPE_KEY);
    expect(createdRow).toBeDefined();
    expect(result.resultingEntityId).toBe(createdRow?.id);

    const deadline = Date.now() + 2000;
    while (
      (!registry.isTypeActiveForProject(NEW_TYPE_KEY, PROJECT_ID) ||
        !peer.isTypeActiveForProject(NEW_TYPE_KEY, PROJECT_ID)) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await Promise.all(refreshSpy.mock.results.map((r) => r.value));
    for (const instance of [registry, peer]) {
      expect(() =>
        instance.assertTypeActive(NEW_TYPE_KEY, PROJECT_ID),
      ).not.toThrow();
      expect(
        instance.getDefinition(PROJECT_ID, NEW_TYPE_KEY)?.definition.name,
      ).toBe('Experiment');
      expect(
        instance.getGuidance(
          PROJECT_ID,
          NEW_TYPE_KEY,
          WorkItemTypeGuidancePurpose.Role,
          SessionRole.Review,
        ).guidance,
      ).toBe('Review evidence.');
    }
    expect(Date.now() - warmedAt).toBeLessThan(5000);
  }

  it('rejects the type before acceptance, then create_work_item and get_tool_guidance accept it after', async () => {
    const { authoringRootProof } = guidanceTools.getAuthoringGuidance();

    // --- Negative: the type is unknown to the live snapshot before acceptance.
    const beforeCreate = await proposalTools.createWorkItem(
      {
        type: NEW_TYPE_KEY,
        name: 'Cache spike',
        dueDate: '2026-09-30T00:00:00.000Z',
        sections: [{ key: 'requirements', content: 'Measure p95 latency.' }],
      } as any,
      {} as any,
      makeRequest(),
    );
    expect((beforeCreate as any).isError).toBe(true);
    expect((beforeCreate as any).content[0].text).toContain(
      `'${NEW_TYPE_KEY}' is not a usable type for this project`,
    );
    expect(proposalCreate).not.toHaveBeenCalled();

    const beforeGuidance = guidanceText(
      await guidanceTools.getToolGuidance(
        {
          toolName: 'create_work_item',
          workItemType: NEW_TYPE_KEY,
          authoringRootProof,
        } as any,
        {} as any,
        makeRequest(),
      ),
    );
    expect(beforeGuidance.isError).toBe(true);
    expect(beforeGuidance.text).toContain(
      'is not a usable type for this project',
    );

    // --- Accept the type through the real proposal-approval enactment seam.
    await acceptExperimentType();

    // The row landed in the shared store as a project-scoped, active row —
    // the shape refresh reads.
    const createdRow = rows.find((r) => r.typeKey === NEW_TYPE_KEY);
    expect(createdRow).toBeDefined();
    expect(createdRow?.projectId).toBe(PROJECT_ID);
    expect(createdRow?.lifecycleStatus).toBe('active');
    expect(createdRow?.capabilities).toMatchObject({
      showsInExplorerSidebar: true,
    });

    // The live snapshot now resolves the new key in this project's scope.
    expect(registry.isTypeActiveForProject(NEW_TYPE_KEY, PROJECT_ID)).toBe(
      true,
    );
    expect(registry.getActiveTypeKeys(PROJECT_ID)).toContain(NEW_TYPE_KEY);
    expect(registry.showsInExplorerSidebar(NEW_TYPE_KEY, PROJECT_ID)).toBe(
      true,
    );
    expect(
      registry.getDefinition(PROJECT_ID, NEW_TYPE_KEY)?.definition.capabilities
        ?.showsInExplorerSidebar,
    ).toBe(true);

    expect(
      registry.getDefinition(PROJECT_ID, NEW_TYPE_KEY)?.definition
        .sessionRoleGuidance,
    ).toEqual(experimentDefinition.sessionRoleGuidance);
    expect(
      registry.getGuidanceBatch(PROJECT_ID, {
        typeKeys: [NEW_TYPE_KEY],
        purpose: 'role',
        sessionRole: 'implementation',
      }),
    ).toEqual({
      results: [
        {
          typeKey: NEW_TYPE_KEY,
          name: 'Experiment',
          sessionRole: 'implementation',
          guidance: experimentDefinition.sessionRoleGuidance!.implementation,
        },
      ],
    });

    // --- create_work_item now succeeds and derives sections from the new entry.
    const afterCreate = await proposalTools.createWorkItem(
      {
        type: NEW_TYPE_KEY,
        name: 'Cache spike',
        dueDate: '2026-09-30T00:00:00.000Z',
        sections: [
          { key: 'description', content: 'Spike on cache hot-path.' },
          { key: 'requirements', content: 'Measure p95 latency.' },
        ],
        guidanceToken: guidanceTokenForType(NEW_TYPE_KEY, PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );
    expect((afterCreate as any).isError).toBeUndefined();
    expect((afterCreate as any).status).toBe('proposed');
    expect(proposalCreate).toHaveBeenCalledTimes(1);
    const dto = proposalCreate.mock.calls[0][3];
    expect(dto.updates.type).toBe(NEW_TYPE_KEY);
    expect(dto.updates.sections).toEqual([
      { key: 'description', content: 'Spike on cache hot-path.' },
      { key: 'requirements', content: 'Measure p95 latency.' },
    ]);

    // --- get_tool_guidance now serves the new type's registry-sourced contract.
    const afterGuidance = guidanceText(
      await guidanceTools.getToolGuidance(
        {
          toolName: 'create_work_item',
          workItemType: NEW_TYPE_KEY,
          authoringRootProof,
        } as any,
        {} as any,
        makeRequest(),
      ),
    );
    expect(afterGuidance.isError).toBeUndefined();
    expect(afterGuidance.text).toContain(
      `# create_work_item (${NEW_TYPE_KEY}) — agent guidance`,
    );
    expect(afterGuidance.text).toContain(
      '- Allowed section keys: description, requirements.',
    );
    expect(afterGuidance.text).toMatch(/- Required fields: name, dueDate\./);
    expect(afterGuidance.text).toContain(
      '- Not accepted for this type: tag, parentTaskId.',
    );
    expect(afterGuidance.text).toContain(CREATE_STANDARDS);

    // And edit-mode guidance serves the type's edit standards.
    const editGuidance = guidanceText(
      await guidanceTools.getToolGuidance(
        {
          toolName: 'edit_work_item',
          workItemType: NEW_TYPE_KEY,
          authoringRootProof,
        } as any,
        {} as any,
        makeRequest(),
      ),
    );
    expect(editGuidance.isError).toBeUndefined();
    expect(editGuidance.text).toContain(EDIT_STANDARDS);
  });

  it('keeps rejecting a section the accepted type does not carry', async () => {
    await acceptExperimentType();

    // acceptanceCriteria is not in the EXPERIMENT definition's sections, so the
    // create gate rejects it from the live registry entry.
    const result = await proposalTools.createWorkItem(
      {
        type: NEW_TYPE_KEY,
        name: 'Cache spike',
        dueDate: '2026-09-30T00:00:00.000Z',
        sections: [{ key: 'acceptanceCriteria', content: 'Should be fast.' }],
        guidanceToken: guidanceTokenForType(NEW_TYPE_KEY, PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      `Section "acceptanceCriteria" is not valid for ${NEW_TYPE_KEY} work items`,
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });
});
