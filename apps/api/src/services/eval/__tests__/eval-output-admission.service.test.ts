import { Test } from '@nestjs/testing';
import type { WorkItemType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MESSAGE_BUS_TOKEN } from '../../../core/events/tokens';
import { InMemoryMessageBus } from '../../../core/events/in-memory-message-bus.service';
import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import { testIds } from '../../../utils/testUtils';
import {
  EvalOutputAdmissionService,
  ORDINARY_EVAL_OUTPUT_STAMP,
} from '../eval-output-admission.service';

const ORG = 'org-1' as never;
const PROJECT = 'project-1' as never;
const SESSION = 'session-1';

function build(attempt: unknown) {
  const findFirst = jest.fn().mockResolvedValue(attempt);
  const tx = { report: { findFirst } };
  return {
    service: new EvalOutputAdmissionService(),
    tx: tx as never,
    findFirst,
  };
}

describe('EvalOutputAdmissionService', () => {
  it('captures the effective work-item-type definition before later registry edits', async () => {
    const stored = {
      id: '99999999-9999-4999-8999-999999999999',
      typeKey: 'CUSTOM',
      projectId: testIds.project,
      lifecycleStatus: 'active',
      name: 'Custom',
      role: 'project-info',
      colorKey: null,
      iconKey: null,
      description: 'Historical guidance',
      sectionDefinitions: [
        { key: 'description', label: 'Description', kind: 'markdown' },
      ],
      allowedParentTypes: [],
      edgeTargets: [],
      allowedStatuses: ['NOT_STARTED'],
      requiredScalars: [],
      forbiddenScalars: [],
      parentage: { allowedParentEntityTypes: ['PROJECT'] },
      tracking: { allowedSourceEntityTypes: [], allowedSourceTaskTypes: [] },
      agentSettableStatuses: [],
      anchorableReportTypes: [],
      writingStandards: { create: '', edit: '' },
      sessionRoleGuidance: null,
      maintenanceGuidance: null,
      acceptedConfigKinds: [],
      capabilities: {},
      graphConfiguration: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies WorkItemType;
    const module = await Test.createTestingModule({
      providers: [
        EvalOutputAdmissionService,
        WorkItemTypeRegistryService,
        { provide: MESSAGE_BUS_TOKEN, useValue: new InMemoryMessageBus() },
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn().mockResolvedValue([]),
            project: {
              findMany: jest.fn().mockResolvedValue([{ id: testIds.project }]),
            },
            workItemType: { findMany: jest.fn(async () => [{ ...stored }]) },
            workItemTypeTemplate: { findMany: jest.fn().mockResolvedValue([]) },
          },
        },
      ],
    }).compile();
    try {
      const registry = module.get(WorkItemTypeRegistryService);
      await registry.refresh();
      const { tx } = build(null);
      const result = await module
        .get(EvalOutputAdmissionService)
        .resolveProposal(tx, {
          organizationId: testIds.organization,
          projectId: testIds.project,
          proposal: {
            action: 'UPDATE',
            targetEntityType: 'WORK_ITEM_TYPE',
            targetEntityId: stored.typeKey,
            updates: { definition: { description: 'Proposed guidance' } },
            ragEnabled: false,
            applicationEligible: false,
          },
        });
      stored.description = 'Later live change';
      await registry.refresh();
      expect(
        registry.getDefinition(testIds.project, stored.typeKey)?.definition
          .description,
      ).toBe('Later live change');
      expect(result.data).toMatchObject({
        retainedOriginalTargetContent: {
          definition: { description: 'Historical guidance' },
        },
      });
    } finally {
      await module.close();
    }
  });

  it.each([
    'QUEUED',
    'PREPARING',
    'RUNNING',
    'JUDGING',
    'COMPLETED',
    'ERROR',
    'STOPPED',
  ])(
    'preserves supplied properties without consulting attempt status %s',
    async (status) => {
      const { service, tx, findFirst } = build({ id: 'attempt-1', status });
      await expect(
        service.resolve(tx, {
          organizationId: ORG,
          projectId: PROJECT,
          writingSessionId: SESSION,
          ragEnabled: false,
          applicationEligible: false,
        }),
      ).resolves.toEqual({
        ragEnabled: false,
        applicationEligible: false,
        isEvalOutput: true,
      });
      expect(findFirst).not.toHaveBeenCalled();
    },
  );

  it('stores output ordinarily when no in-flight attempt names the writing session', async () => {
    const { service, tx } = build(null);
    await expect(
      service.resolve(tx, {
        organizationId: ORG,
        projectId: PROJECT,
        writingSessionId: SESSION,
      }),
    ).resolves.toEqual(ORDINARY_EVAL_OUTPUT_STAMP);
  });

  it('returns the ordinary stamp without a lookup when the writer has no session', async () => {
    const { service, tx, findFirst } = build(null);
    await expect(
      service.resolve(tx, { organizationId: ORG, projectId: PROJECT }),
    ).resolves.toEqual(ORDINARY_EVAL_OUTPUT_STAMP);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
