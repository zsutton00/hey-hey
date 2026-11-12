import { createTestProjectApprovalPolicyService } from 'src/utils/testUtils';
import { ProposalReconciliationService } from '../proposal-reconciliation.service';
import { ProposalReconciliationGroupService } from '../proposal-reconciliation-group.service';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProposalService } from '../proposal.service';
import { ProjectApprovalPolicyService } from '../project-approval-policy.service';
import { ProposalApprovalService } from '../proposal-approval.service';
import { PendingEdgeService } from '../pending-edge.service';
import { ProposalValidationEngine } from '../proposal-validation.engine';
import {
  rootChildrenView,
  WorkItemChangeSetProjectorService,
} from '../work-item-change-set-projector.service';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../../core/events/tokens';
import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import * as TestUtils from '../../../utils/testUtils';
import { ProjectAccessService } from 'src/auth/services/project-access.service';

const { testIds } = TestUtils;

const proposalId = '123e4567-e89b-42d3-a456-426614174099';

function makeStoredProposal(overrides?: Record<string, unknown>) {
  return {
    id: proposalId,
    organizationId: testIds.organization,
    projectId: testIds.project,
    type: 'SINGLE',
    action: 'UPDATE',
    status: 'DRAFT',
    targetEntityId: testIds.task,
    targetEntityType: 'TASK',
    updates: { name: 'Updated name' },
    requestorId: testIds.user,
    requestorContext: null,
    validationSessionId: null,
    conversationId: null,
    messageId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ProposalService.validateProposal', () => {
  let service: ProposalService;
  let mockPrisma: ReturnType<typeof TestUtils.createMockPrismaService>;
  let mockEngine: { validate: jest.Mock };
  let mockProjector: { project: jest.Mock };

  beforeEach(async () => {
    mockPrisma = TestUtils.createMockPrismaService();
    (mockPrisma.db as any).proposal = {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    };
    (mockPrisma.db as any).proposalGroupMember = {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    };

    mockEngine = {
      validate: jest.fn(),
    };
    mockProjector = {
      project: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ProjectAccessService,
          useValue: { assertProjectRole: jest.fn() },
        },
        {
          provide: ProposalReconciliationService,
          useValue: { captureAuthoring: jest.fn() },
        },
        { provide: ProposalReconciliationGroupService, useValue: {} },
        ProposalService,
        {
          provide: ProjectApprovalPolicyService,
          useValue: createTestProjectApprovalPolicyService(),
        },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ProposalValidationEngine, useValue: mockEngine },
        { provide: WorkItemChangeSetProjectorService, useValue: mockProjector },
        {
          provide: WorkItemTypeRegistryService,
          useValue: { getDefinitions: jest.fn().mockReturnValue([]) },
        },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: TestUtils.createMockDomainEventPublisher(),
        },
        {
          provide: ProposalApprovalService,
          useValue: {
            approve: jest.fn(),
            applyInTransaction: jest.fn(),
          },
        },
        {
          provide: PendingEdgeService,
          useValue: {
            materializeEdges: jest.fn(),
            processDeclaredEdges: jest.fn().mockResolvedValue([]),
            cleanupForProposal: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ProposalService>(ProposalService);
    jest.clearAllMocks();
  });

  it('should project a supplied generic work-item change set', async () => {
    const stored = makeStoredProposal();
    const projection = {
      valid: true,
      projectedRoot: {
        identity: { refType: 'temporary', tempId: 'root' },
        label: 'Root',
        type: 'STANDARD',
        name: 'Root',
        sections: [],
        deleted: false,
      },
      children: [],
      sections: [],
      incidentRelationships: [],
      identityLabels: { 'temporary:root': 'Root' },
      issues: [],
    };
    const changeSet = {
      root: { refType: 'temporary' as const, tempId: 'root' },
      operations: [],
    };
    (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(stored);
    mockProjector.project.mockResolvedValue(projection);

    const result = await service.validateProposal(
      proposalId,
      testIds.organization,
      testIds.project,
      TestUtils.createMockAuthenticatedUser(),
      changeSet,
    );

    expect(result).toBe(projection);
    expect(mockProjector.project).toHaveBeenCalledWith({
      organizationId: testIds.organization,
      projectId: testIds.project,
      request: changeSet,
      view: rootChildrenView,
    });
    expect(mockEngine.validate).not.toHaveBeenCalled();
  });

  it('reviews a grouped change set against the Mockups its group will create', async () => {
    const groupId = '123e4567-e89b-42d3-a456-426614174077';
    const plainMockupId = '79a624eb-b89b-4a45-9a22-bd63bcdfd1a8';
    const changeSetMockupId = '3bb01337-db79-4db2-a26c-e2280c41f524';
    const changeSet = {
      root: { refType: 'existing' as const, id: testIds.task },
      operations: [],
    };
    (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(
      makeStoredProposal({ updates: changeSet }),
    );
    (mockPrisma.db as any).proposalGroupMember.findUnique.mockResolvedValue({
      groupId,
    });
    (mockPrisma.db as any).proposalGroupMember.findMany.mockResolvedValue([
      {
        reservedTargetEntityId: plainMockupId,
        proposal: {
          targetEntityType: 'TASK',
          updates: { type: 'mockup', name: 'Edit Book Dialog' },
        },
      },
      {
        reservedTargetEntityId: changeSetMockupId,
        proposal: {
          targetEntityType: 'TASK',
          updates: {
            root: { refType: 'temporary', tempId: 'root' },
            operations: [
              {
                op: 'workItem.create',
                ref: { refType: 'temporary', tempId: 'root' },
                type: 'mockup',
                name: 'Remove Book Confirmation',
              },
            ],
          },
        },
      },
    ]);
    mockProjector.project.mockResolvedValue({ valid: true, issues: [] });

    await service.validateProposal(
      proposalId,
      testIds.organization,
      testIds.project,
      TestUtils.createMockAuthenticatedUser(),
      changeSet,
    );

    expect(
      (mockPrisma.db as any).proposalGroupMember.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ groupId }),
      }),
    );
    expect(mockProjector.project).toHaveBeenCalledWith(
      expect.objectContaining({
        reservedEntities: [
          {
            entityId: plainMockupId,
            entityType: 'TASK',
            workItemType: 'mockup',
          },
          {
            entityId: changeSetMockupId,
            entityType: 'TASK',
            workItemType: 'mockup',
          },
        ],
      }),
    );
  });

  it('should fetch proposal by id and run validation', async () => {
    const stored = makeStoredProposal();
    (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(stored);
    mockEngine.validate.mockResolvedValue({
      valid: true,
      proposals: [{ index: 0, valid: true, errors: [], warnings: [] }],
    });

    const user = TestUtils.createMockAuthenticatedUser();
    const result = await service.validateProposal(
      proposalId,
      testIds.organization,
      testIds.project,
      user,
    );

    expect(result.valid).toBe(true);
    expect(result.proposals).toHaveLength(1);

    expect(mockEngine.validate).toHaveBeenCalledWith({
      proposals: [
        {
          type: 'SINGLE',
          action: 'UPDATE',
          targetEntityId: testIds.task,
          targetEntityType: 'TASK',
          updates: { name: 'Updated name' },
          requestorContext: undefined,
          influences: undefined,
          generatedWithVersion: undefined,
          validationSessionId: undefined,
          conversationId: undefined,
        },
      ],
      context: {
        organizationId: testIds.organization,
        projectId: testIds.project,
        requestor: user,
      },
    });
  });

  it('should throw NotFoundException when proposal does not exist', async () => {
    (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(null);

    const user = TestUtils.createMockAuthenticatedUser();
    await expect(
      service.validateProposal(
        proposalId,
        testIds.organization,
        testIds.project,
        user,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(mockEngine.validate).not.toHaveBeenCalled();
  });

  it('should pass authoring fields while omitting server-owned Message identity', async () => {
    const stored = makeStoredProposal({
      requestorContext: { source: 'agent_proposal' },
      validationSessionId: '123e4567-e89b-42d3-a456-426614174050',
      conversationId: testIds.conversation,
      messageId: '123e4567-e89b-42d3-a456-426614174051',
    });
    (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(stored);
    mockEngine.validate.mockResolvedValue({
      valid: true,
      proposals: [{ index: 0, valid: true, errors: [], warnings: [] }],
    });

    const user = TestUtils.createMockAuthenticatedUser();
    await service.validateProposal(
      proposalId,
      testIds.organization,
      testIds.project,
      user,
    );

    const calledWith = mockEngine.validate.mock.calls[0][0];
    expect(calledWith.proposals[0].requestorContext).toEqual({
      source: 'agent_proposal',
    });
    expect(calledWith.proposals[0].validationSessionId).toBe(
      '123e4567-e89b-42d3-a456-426614174050',
    );
    expect(calledWith.proposals[0].conversationId).toBe(testIds.conversation);
    expect(calledWith.proposals[0]).not.toHaveProperty('messageId');
  });

  it('should return validation errors from the engine', async () => {
    const stored = makeStoredProposal({
      updates: {},
    });
    (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(stored);
    mockEngine.validate.mockResolvedValue({
      valid: false,
      proposals: [
        {
          index: 0,
          valid: false,
          errors: [
            {
              field: 'proposals[0].updates',
              code: 'too_small',
              reason: 'At least one update field is required',
              layer: 'structural',
            },
          ],
          warnings: [],
        },
      ],
    });

    const user = TestUtils.createMockAuthenticatedUser();
    const result = await service.validateProposal(
      proposalId,
      testIds.organization,
      testIds.project,
      user,
    );

    expect(result.valid).toBe(false);
    expect(result.proposals[0]!.errors).toHaveLength(1);
    expect(result.proposals[0]!.errors[0]!.code).toBe('too_small');
  });

  it('should return permission warnings from the engine', async () => {
    const stored = makeStoredProposal();
    (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(stored);
    mockEngine.validate.mockResolvedValue({
      valid: true,
      proposals: [
        {
          index: 0,
          valid: true,
          errors: [],
          warnings: [
            {
              field: 'proposals[0]',
              code: 'insufficient_role',
              reason: "Requestor role 'VIEWER' does not have write access.",
              layer: 'permission',
              suggestion: 'Request elevated permissions or ask an org member.',
            },
          ],
        },
      ],
    });

    const user = TestUtils.createMockAuthenticatedUser();
    const result = await service.validateProposal(
      proposalId,
      testIds.organization,
      testIds.project,
      user,
    );

    expect(result.valid).toBe(true);
    expect(result.proposals[0]!.warnings).toHaveLength(1);
    expect(result.proposals[0]!.warnings[0]!.layer).toBe('permission');
  });

  it('should default updates to empty object when null in database', async () => {
    const stored = makeStoredProposal({ updates: null });
    (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(stored);
    mockEngine.validate.mockResolvedValue({
      valid: false,
      proposals: [
        {
          index: 0,
          valid: false,
          errors: [
            {
              field: 'proposals[0].updates',
              code: 'invalid_type',
              reason: 'Expected object, received null',
              layer: 'structural',
            },
          ],
          warnings: [],
        },
      ],
    });

    const user = TestUtils.createMockAuthenticatedUser();
    await service.validateProposal(
      proposalId,
      testIds.organization,
      testIds.project,
      user,
    );

    const calledWith = mockEngine.validate.mock.calls[0][0];
    expect(calledWith.proposals[0].updates).toEqual({});
  });

  it('should scope proposal lookup by organizationId and projectId', async () => {
    (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(null);

    const user = TestUtils.createMockAuthenticatedUser();
    await expect(
      service.validateProposal(
        proposalId,
        testIds.organization,
        testIds.project,
        user,
      ),
    ).rejects.toThrow(NotFoundException);

    expect((mockPrisma.db as any).proposal.findFirst).toHaveBeenCalledWith({
      where: {
        id: proposalId,
        organizationId: testIds.organization,
        projectId: testIds.project,
        NOT: {
          groupMembership: {
            is: {
              group: {
                is: { status: 'BUILDING' },
              },
            },
          },
        },
      },
    });
  });
});
