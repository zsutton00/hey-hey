import { BadRequestException } from '@nestjs/common';
import { ProposalApprovalService } from '../proposal-approval.service';
import { ProjectApprovalPolicyService } from '../project-approval-policy.service';
import { WorkItemChangeSetMaterializerService } from '../work-item-change-set-materializer.service';
import { WorkItemChangeSetProjectorService } from '../work-item-change-set-projector.service';
import { WorkItemParentageValidator } from '../../tasks/work-item-parentage-validator.service';
import { WorkItemTypeLifecycleService } from '../../tasks/work-item-type-lifecycle.service';
import { TaskService } from '../../tasks/task.service';
import {
  createWarmWorkItemTypeRegistryWithCustomTypes,
  type CustomTypeRowSpec,
} from '../../../../test/setup/work-item-type-registry.fixture';
import { PrismaService } from '../../../prisma/prisma.service';
import * as TestUtils from '../../../utils/testUtils';

function reconciliationStub(completedEffects = new Set<string>()) {
  return {
    guardTaskEffect: jest.fn(
      async (
        _tx: unknown,
        _proposal: unknown,
        materializationId: string,
        taskId: string,
        operationIndex: number,
        _creates: boolean,
        write: () => Promise<unknown>,
      ) => {
        const key = `${materializationId}:${taskId}:${operationIndex}`;
        if (completedEffects.has(key)) return;
        const result = await write();
        completedEffects.add(key);
        return result;
      },
    ),
    recordEdgeEffect: jest.fn(),
    reviewedEdgeBasis: jest.fn().mockResolvedValue({ version: '' }),
    edgeBasis: jest.fn().mockResolvedValue({ version: '' }),
    publishTaskEffects: jest.fn(
      async (
        _tx: unknown,
        _proposal: unknown,
        _materializationId: string,
        write: () => Promise<unknown>,
      ) => write(),
    ),
  } as never;
}

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_ID = '10000000-0000-4000-8000-000000000002';
const APPROVER_ID = '10000000-0000-4000-8000-000000000003';
const PROPOSAL_ID = '10000000-0000-4000-8000-000000000004';
const MODE_ID = '10000000-0000-4000-8000-000000000005';
const MODE_PARENT_ID = '10000000-0000-4000-8000-000000000007';

const MODE_FILES_SCHEMA_REF = '#/components/schemas/ProjectModeFiles';
const MODE_SETTINGS_SCHEMA_REF = '#/components/schemas/ProjectModeSettings';

function modeDefinition(focalTypeKey = 'STANDARD'): CustomTypeRowSpec {
  return {
    typeKey: 'MODE',
    projectId: PROJECT_ID,
    sectionDefinitions: [
      { key: 'description', label: 'Catalog description' },
      {
        key: 'files',
        label: 'Files',
        kind: 'json',
        schemaRef: MODE_FILES_SCHEMA_REF,
      },
      {
        key: 'settings',
        label: 'Session settings',
        kind: 'json',
        schemaRef: MODE_SETTINGS_SCHEMA_REF,
      },
    ],
    allowedParentTypes: ['FEATURE'],
    allowedParentEntityTypes: ['TASK'],
    capabilities: { requiresParent: true },
    agentGuidance: {
      overview: 'A selectable project coding discipline.',
      contexts: [
        {
          focalTypeKeys: [focalTypeKey],
          guidance: 'Use this mode for the selected work-item type.',
        },
      ],
    } as any,
  };
}

function makeProposal(files: unknown, settings?: unknown) {
  return {
    id: PROPOSAL_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    type: 'SINGLE',
    action: 'CREATE',
    status: 'DRAFT',
    targetEntityId: MODE_ID,
    targetEntityType: 'TASK',
    updates: {
      name: 'Review discipline',
      type: 'MODE',
      parentTaskId: MODE_PARENT_ID,
      sections: [
        {
          key: 'description',
          content: 'Choose this mode for careful review work.',
        },
        { key: 'files', content: files },
        ...(settings === undefined
          ? []
          : [{ key: 'settings', content: settings }]),
      ],
    },
    requestorId: '10000000-0000-4000-8000-000000000006',
    requestorContext: {
      source: 'agent',
      userId: '10000000-0000-4000-8000-000000000006',
      organizationId: ORGANIZATION_ID,
      toolName: 'mcp.create_task',
      timestamp: '2026-09-18T00:00:00.000Z',
    },
    influences: null,
    generatedWithVersion: null,
    validationSessionId: null,
    conversationId: null,
    messageId: null,
    edges: null,
    createdAt: new Date('2026-09-18T00:00:00.000Z'),
    updatedAt: new Date('2026-09-18T00:00:00.000Z'),
  } as any;
}

async function createApprovalHarness(
  focalTypeKey = 'STANDARD',
  settings?: unknown,
  extraTypes: CustomTypeRowSpec[] = [],
) {
  const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
    modeDefinition(focalTypeKey),
    ...extraTypes,
    ...(focalTypeKey === 'ARCHIVED_TARGET'
      ? [
          {
            typeKey: 'ARCHIVED_TARGET',
            projectId: PROJECT_ID,
            lifecycleStatus: 'archived',
          } satisfies CustomTypeRowSpec,
        ]
      : []),
  ]);
  const prisma = TestUtils.createMockPrismaService();
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: PROPOSAL_ID }]),
    proposal: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    proposalApprovalRecord: {
      create: jest.fn().mockResolvedValue({ id: 'approval-1' }),
      count: jest.fn().mockResolvedValue(1),
    },
    projectMember: {
      findMany: jest.fn().mockResolvedValue([{ userId: APPROVER_ID }]),
    },
    task: prisma.db.task,
  };
  prisma.db.$transaction.mockImplementation(async (callback: any) =>
    callback(tx),
  );
  prisma.db.task.findMany.mockResolvedValue([]);
  prisma.db.task.findFirst.mockResolvedValue({
    id: MODE_PARENT_ID,
    type: 'FEATURE',
  });

  let canonicalWorkItem: any;
  const taskService = {
    createInTransaction: jest.fn().mockResolvedValue({ id: MODE_ID }),
  };
  const eventPublisher = {
    publishInTransaction: jest.fn().mockResolvedValue(undefined),
  };
  const agentEdgeClient = { findIncident: jest.fn().mockResolvedValue([]) };
  const projector = new WorkItemChangeSetProjectorService(
    prisma as any,
    registry,
    new WorkItemParentageValidator(registry),
    agentEdgeClient as any,
    jest.fn(() => 'service-token'),
  );
  const materializerAdapter = new WorkItemChangeSetMaterializerService(
    prisma as any,
    projector,
    taskService as any,
    agentEdgeClient as any,
    eventPublisher as any,
    jest.fn(),
    reconciliationStub(),
    registry,
    {} as any,
    { extractAndValidate: jest.fn().mockResolvedValue([]) } as any,
  );
  const storedProposal = makeProposal(
    {
      schemaVersion: 'project-mode-files.v1',
      files: {
        'references/checklist.md': 'Check the list.',
        'MODE.md': 'Read this first.',
      },
    },
    settings,
  );
  let preparedRequest: any;
  const materializer = {
    isWorkItemChangeSetValidationRequest:
      materializerAdapter.isWorkItemChangeSetValidationRequest.bind(
        materializerAdapter,
      ),
    taskProposalChangeSet:
      materializerAdapter.taskProposalChangeSet.bind(materializerAdapter),
    validationRevision:
      materializerAdapter.validationRevision.bind(materializerAdapter),
    projectPreparation:
      materializerAdapter.projectPreparation.bind(materializerAdapter),
    enqueuePreparedIntent: jest.fn().mockImplementation(async (_tx, params) => {
      preparedRequest = params.prepared.operationSet;
      return { id: 'materialization-1', rootWorkItemId: MODE_ID };
    }),
    materializeApprovedChangeSet: jest.fn().mockImplementation(async () => {
      const sections = (preparedRequest?.operations ?? [])
        .filter((operation: any) => operation.op === 'section.replace')
        .map((operation: any) => ({
          key: operation.key,
          materializedMarkdown: operation.content,
        }));
      await taskService.createInTransaction(
        tx,
        ORGANIZATION_ID,
        null,
        {
          name: 'Review discipline',
          type: 'MODE',
          parentTaskId: MODE_PARENT_ID,
          sections,
        },
        PROJECT_ID,
        MODE_ID,
        'materialization-1',
      );
      canonicalWorkItem = {
        id: MODE_ID,
        type: 'MODE',
        parentTaskId: MODE_PARENT_ID,
        sections,
      };
      return {
        proposal: { ...storedProposal, status: 'APPROVED' },
        rootWorkItemId: MODE_ID,
        status: 'PUBLISHED',
        enacted: true,
      };
    }),
  };
  const pendingEdgeService = {
    rollbackMaterializedEdges: jest.fn().mockResolvedValue(undefined),
  };

  tx.proposal.findFirst.mockResolvedValue(storedProposal);
  // approve() projects from an unlocked read before taking the row lock.
  prisma.db.proposal.findFirst.mockImplementation(
    (args: unknown): Promise<unknown> => tx.proposal.findFirst(args),
  );
  tx.proposal.update.mockImplementation(async ({ data }: any) => ({
    ...storedProposal,
    ...data,
  }));

  const service = new ProposalApprovalService(
    prisma as unknown as PrismaService,
    eventPublisher as any,
    taskService as unknown as TaskService,
    registry,
    {} as WorkItemTypeLifecycleService,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    pendingEdgeService as any,
    materializer as any,
    {} as any,
    new ProjectApprovalPolicyService(),
    { assertProjectRole: jest.fn() } as never,
    { assertApplicable: jest.fn() } as never,
    undefined,
    undefined,
  );
  (service as any).toResponseDto = jest.fn(
    async (proposal: unknown) => proposal,
  );

  return {
    service,
    tx,
    registry,
    materializer,
    taskService,
    get preparedOperations(): any[] {
      return preparedRequest?.operations ?? [];
    },
    get canonicalWorkItem() {
      return canonicalWorkItem;
    },
  };
}

describe('agent-authored MODE approval and canonical persistence', () => {
  it('approves once and retains the canonical description and sorted files section', async () => {
    const harness = await createApprovalHarness();

    const result = await harness.service.approve(
      PROPOSAL_ID,
      ORGANIZATION_ID as any,
      PROJECT_ID as any,
      APPROVER_ID as any,
    );

    expect(result.resultingEntityId).toBe(MODE_ID);
    expect(result.enacted).toBe(true);
    expect(harness.materializer.enqueuePreparedIntent).toHaveBeenCalledTimes(1);
    expect(harness.taskService.createInTransaction).toHaveBeenCalledTimes(1);
    expect(harness.canonicalWorkItem).toEqual({
      id: MODE_ID,
      type: 'MODE',
      parentTaskId: MODE_PARENT_ID,
      sections: [
        {
          key: 'description',
          materializedMarkdown: 'Choose this mode for careful review work.',
        },
        {
          key: 'files',
          materializedMarkdown: JSON.stringify({
            schemaVersion: 'project-mode-files.v1',
            files: {
              'MODE.md': 'Read this first.',
              'references/checklist.md': 'Check the list.',
            },
          }),
        },
      ],
    });
    expect(harness.tx.proposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'APPROVED' } }),
    );
  });

  it('validates and canonicalizes the Project Assistant setting with the MODE', async () => {
    const harness = await createApprovalHarness('STANDARD', {
      projectAssistant: { enabled: false },
      schemaVersion: 'project-mode-settings.v1',
    });

    await harness.service.approve(
      PROPOSAL_ID,
      ORGANIZATION_ID as any,
      PROJECT_ID as any,
      APPROVER_ID as any,
    );

    expect(harness.canonicalWorkItem.sections).toContainEqual({
      key: 'settings',
      materializedMarkdown:
        '{"schemaVersion":"project-mode-settings.v1","projectAssistant":{"enabled":false}}',
    });
  });

  it('retains a per-MODE eligible type list through approval', async () => {
    const harness = await createApprovalHarness('STANDARD', {
      schemaVersion: 'project-mode-settings.v1',
      projectAssistant: { enabled: true },
      eligibleWorkItemTypeKeys: ['STANDARD', 'BUG'],
    });

    await harness.service.approve(
      PROPOSAL_ID,
      ORGANIZATION_ID as any,
      PROJECT_ID as any,
      APPROVER_ID as any,
    );

    expect(harness.canonicalWorkItem.sections).toContainEqual({
      key: 'settings',
      materializedMarkdown:
        '{"schemaVersion":"project-mode-settings.v1","projectAssistant":{"enabled":true},"eligibleWorkItemTypeKeys":["BUG","STANDARD"]}',
    });
  });

  it('enables a custom type for one MODE through its own settings without touching shared MODE guidance', async () => {
    const harness = await createApprovalHarness(
      'STANDARD',
      {
        schemaVersion: 'project-mode-settings.v1',
        projectAssistant: { enabled: true },
        eligibleWorkItemTypeKeys: ['JOB_APPLICATION_RECORD'],
      },
      [{ typeKey: 'JOB_APPLICATION_RECORD', projectId: PROJECT_ID }],
    );
    const sharedGuidanceBefore = structuredClone(
      harness.registry.getDefinition(PROJECT_ID, 'MODE')?.definition
        .agentGuidance,
    );

    await harness.service.approve(
      PROPOSAL_ID,
      ORGANIZATION_ID as any,
      PROJECT_ID as any,
      APPROVER_ID as any,
    );

    expect(harness.canonicalWorkItem.sections).toContainEqual({
      key: 'settings',
      materializedMarkdown:
        '{"schemaVersion":"project-mode-settings.v1","projectAssistant":{"enabled":true},"eligibleWorkItemTypeKeys":["JOB_APPLICATION_RECORD"]}',
    });
    expect(harness.preparedOperations.map((operation) => operation.op)).toEqual(
      [
        'workItem.create',
        'section.replace',
        'section.replace',
        'section.replace',
      ],
    );
    expect(
      harness.registry.getDefinition(PROJECT_ID, 'MODE')?.definition
        .agentGuidance,
    ).toEqual(sharedGuidanceBefore);
    expect(
      harness.registry.getDefinition(PROJECT_ID, 'MODE')?.definition
        .agentGuidance?.contexts?.[0]?.focalTypeKeys,
    ).toEqual(['STANDARD']);
  });

  it('rejects an eligible type list naming a type outside the effective registry', async () => {
    const harness = await createApprovalHarness('STANDARD', {
      schemaVersion: 'project-mode-settings.v1',
      projectAssistant: { enabled: true },
      eligibleWorkItemTypeKeys: ['STANDARD', 'NOT_A_TYPE'],
    });

    await expect(
      harness.service.approve(
        PROPOSAL_ID,
        ORGANIZATION_ID as any,
        PROJECT_ID as any,
        APPROVER_ID as any,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(harness.materializer.enqueuePreparedIntent).not.toHaveBeenCalled();
    expect(harness.canonicalWorkItem).toBeUndefined();
  });

  it('rejects a Project Assistant setting that tries to grant authority', async () => {
    const harness = await createApprovalHarness('STANDARD', {
      schemaVersion: 'project-mode-settings.v1',
      projectAssistant: { enabled: true, workItemProposalMode: 'all' },
    });

    await expect(
      harness.service.approve(
        PROPOSAL_ID,
        ORGANIZATION_ID as any,
        PROJECT_ID as any,
        APPROVER_ID as any,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(harness.materializer.enqueuePreparedIntent).not.toHaveBeenCalled();
    expect(harness.canonicalWorkItem).toBeUndefined();
  });

  it.each([
    [
      'unknown applicability',
      'NOT_A_TYPE',
      {
        schemaVersion: 'project-mode-files.v1',
        files: { 'MODE.md': 'Read this first.' },
      },
    ],
    [
      'archived applicability',
      'ARCHIVED_TARGET',
      {
        schemaVersion: 'project-mode-files.v1',
        files: { 'MODE.md': 'Read this first.' },
      },
    ],
    [
      'unsafe files',
      'STANDARD',
      {
        schemaVersion: 'project-mode-files.v1',
        files: { 'MODE.md': 'Read this first.', '../escape.md': 'No.' },
      },
    ],
    [
      'malformed files',
      'STANDARD',
      {
        schemaVersion: 'project-mode-files.v1',
        files: { 'MODE.md': 7 },
      },
    ],
  ] as const)(
    '%s fails before canonical persistence',
    async (_case, focalTypeKey, files) => {
      const harness = await createApprovalHarness(focalTypeKey);
      const storedProposal = makeProposal(files);
      harness.tx.proposal.findFirst.mockResolvedValue(storedProposal);

      await expect(
        harness.service.approve(
          PROPOSAL_ID,
          ORGANIZATION_ID as any,
          PROJECT_ID as any,
          APPROVER_ID as any,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(harness.tx.proposal.update).not.toHaveBeenCalled();
      expect(harness.tx.proposalApprovalRecord.create).not.toHaveBeenCalled();
      expect(harness.materializer.enqueuePreparedIntent).not.toHaveBeenCalled();
      expect(harness.canonicalWorkItem).toBeUndefined();
    },
  );
});
