import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
import {
  BadRequestException,
  ConflictException,
  ParseBoolPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AgentSessionController } from '../agent-session.controller';
import { AgentSessionService } from '../../services/agent-session.service';
import { TriggerEmitter } from '../../core/websockets/trigger-emitter.service';
import { WorkItemPlanGenerationService } from '../../services/plan/work-item-plan-generation.service';
import { CliReadEmitter } from '../../core/websockets/cli-read-emitter.service';
import { CliReadErrorCode } from '../../generated';
import { ExecutionGrantService } from '../../services/controller-authorization/execution-grant.service';
import { SESSION_CLI_READ_OPERATIONS } from '../../core/websockets/cli-read-operation-registry';
import { MachinePresenceService } from '../../core/websockets/machine-presence.service';

jest.mock('../../core/websockets/websocket.gateway', () => ({
  WebsocketGateway: class {},
}));
jest.mock('../../services/plan/work-item-plan-generation.service', () => ({
  WorkItemPlanGenerationService: class {},
}));
jest.mock('../../services/workflows/conversation-workflow.service', () => ({
  ConversationWorkflowService: class {},
}));
jest.mock('../../services/reports/report.service', () => ({
  ReportService: class {},
}));

const sessionId1 = '11111111-1111-4111-8111-111111111111';
const sessionId2 = '22222222-2222-4222-8222-222222222222';
const projectId = '33333333-3333-4333-8333-333333333333';
const agentSessionId = '44444444-4444-4444-8444-444444444444';
const grantAuthorization = {
  kind: 'bounded_grant' as const,
  grantId: '55555555-5555-4555-8555-555555555555',
};
const includeServiceQueryMetadata = {
  type: 'query',
  metatype: Boolean,
  data: 'includeService',
} as const;
const includeUserQueryMetadata = {
  type: 'query',
  metatype: Boolean,
  data: 'includeUser',
} as const;

describe('AgentSessionController', () => {
  let controller: AgentSessionController;
  const mockService = {
    create: jest.fn(),
    resolveWorkItemCoordinator: jest.fn(),
    findAll: jest.fn(),
    findPaginated: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    grantServices: jest.fn(),
    remove: jest.fn(),
    createConversationForSession: jest.fn(),
  };
  const mockTriggerEmitter = {
    emitStopRunControl: jest.fn(),
    emitCompactRunControl: jest.fn(),
    emitPermissionDecisionControl: jest.fn(),
    emitQuestionAnswerControl: jest.fn(),
  };
  const mockRestartService = {
    reset: jest.fn(),
    prepare: jest.fn(),
  };
  const mockCliReadEmitter = {
    read: jest.fn(),
    error: jest.fn(),
  };
  const mockExecutionGrantService = {
    assertAgentSessionAuthorized: jest.fn().mockResolvedValue({
      authorizationId: '66666666-6666-4666-8666-666666666666',
      envelopeAuthorization: grantAuthorization,
      action: {},
    }),
  };
  const mockMachinePresenceService = {
    getBindings: jest.fn(),
  };
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentSessionController],
      providers: [
        {
          provide: AgentSessionService,
          useValue: mockService,
        },
        {
          provide: TriggerEmitter,
          useValue: mockTriggerEmitter,
        },
        {
          provide: WorkItemPlanGenerationService,
          useValue: mockRestartService,
        },
        {
          provide: CliReadEmitter,
          useValue: mockCliReadEmitter,
        },
        {
          provide: ExecutionGrantService,
          useValue: mockExecutionGrantService,
        },
        {
          provide: MachinePresenceService,
          useValue: mockMachinePresenceService,
        },
      ],
    })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AgentSessionController>(AgentSessionController);
    jest.clearAllMocks();
  });

  it('delegates create to the service', async () => {
    mockService.create.mockResolvedValue({ id: 'cs-1' });

    const result = await controller.create(
      {
        projectId: projectId as any,
        sessionDate: new Date().toISOString(),
        serviceIds: ['service-1'],
        launchServiceId: 'service-1',
        provider: 'claude',
        agentSessionId: 'run-1',
        type: 'CODING',
      },
      projectId as any,
      'org-1' as any,
      'user-1' as any,
    );

    expect(mockService.create).toHaveBeenCalledWith(
      'org-1',
      projectId,
      'user-1',
      expect.objectContaining({
        projectId,
        serviceIds: ['service-1'],
        launchServiceId: 'service-1',
        provider: 'claude',
        agentSessionId: 'run-1',
      }),
      null,
    );
    expect(result.id).toBe('cs-1');
  });

  it('passes live machine bindings to the additive Service grant boundary', async () => {
    const machineId = '66666666-6666-4666-8666-666666666666';
    const serviceId = '77777777-7777-4777-8777-777777777777';
    const grant = {
      machineId,
      launchServiceId: serviceId,
      serviceIds: [serviceId],
    };
    mockMachinePresenceService.getBindings.mockResolvedValue({
      organizationId: 'org-1',
      sourcingSocketId: 'socket-1',
      bindings: [{ serviceId, path: '/repo' }],
    });
    mockService.grantServices.mockResolvedValue({ id: agentSessionId });

    await expect(
      controller.grantServices(
        agentSessionId,
        projectId as any,
        grant as any,
        'org-1' as any,
        'user-1' as any,
      ),
    ).resolves.toEqual({ id: agentSessionId });
    expect(mockService.grantServices).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId,
      agentSessionId,
      userId: 'user-1',
      grant,
      liveBoundServiceIds: [serviceId],
    });
  });

  it('rejects a Service grant when the live machine belongs to another organization', async () => {
    const serviceId = '77777777-7777-4777-8777-777777777777';
    mockMachinePresenceService.getBindings.mockResolvedValue({
      organizationId: 'other-org',
      sourcingSocketId: 'socket-1',
      bindings: [{ serviceId, path: '/repo' }],
    });

    await expect(
      controller.grantServices(
        agentSessionId,
        projectId as any,
        {
          machineId: '66666666-6666-4666-8666-666666666666',
          launchServiceId: serviceId,
          serviceIds: [serviceId],
        },
        'org-1' as any,
        'user-1' as any,
      ),
    ).rejects.toThrow(
      'The authenticated machine has no live bindings for this organization',
    );
    expect(mockService.grantServices).not.toHaveBeenCalled();
  });

  it('delegates work-item coordinator resolution to the service', async () => {
    const dto = {
      sessionDate: '2026-07-18T12:00:00.000Z',
      type: 'CODING' as const,
      workItemType: 'TASK_MONITOR',
      workItemId: '55555555-5555-4555-8555-555555555555',
      title: 'Task Monitor coordinator',
    };
    mockService.resolveWorkItemCoordinator.mockResolvedValue({
      agentSession: { id: agentSessionId },
      created: false,
    });

    const result = await controller.resolveWorkItemCoordinator(
      dto,
      projectId as any,
      'org-1' as any,
      'user-1' as any,
    );

    expect(mockService.resolveWorkItemCoordinator).toHaveBeenCalledWith(
      'org-1',
      projectId,
      'user-1',
      dto,
    );
    expect(result).toEqual({
      agentSession: { id: agentSessionId },
      created: false,
    });
  });

  it('forwards a typed config blob on create through to the service', async () => {
    mockService.create.mockResolvedValue({
      id: 'cs-config',
      config: { type: 'CODING_SESSION_V1', version: 'v1', method: 'plan' },
    });

    const result = await controller.create(
      {
        projectId: projectId as any,
        sessionDate: new Date().toISOString(),
        type: 'CODING',
        config: { type: 'CODING_SESSION_V1', version: 'v1', method: 'plan' },
      },
      projectId as any,
      'org-1' as any,
      'user-1' as any,
    );

    expect(mockService.create).toHaveBeenCalledWith(
      'org-1',
      projectId,
      'user-1',
      expect.objectContaining({
        config: { type: 'CODING_SESSION_V1', version: 'v1', method: 'plan' },
      }),
      null,
    );
    expect(result.config).toEqual({
      type: 'CODING_SESSION_V1',
      version: 'v1',
      method: 'plan',
    });
  });

  it('forwards VALIDATION type on create through to the service', async () => {
    mockService.create.mockResolvedValue({
      id: 'cs-validation-1',
      type: 'VALIDATION',
    });

    const result = await controller.create(
      {
        projectId: projectId as any,
        sessionDate: new Date().toISOString(),
        title: 'Validation Walkthrough',
        type: 'VALIDATION',
        entityType: 'TASK',
        entityId: 'task-1',
      },
      projectId as any,
      'org-1' as any,
      'user-1' as any,
    );

    expect(mockService.create).toHaveBeenCalledWith(
      'org-1',
      projectId,
      'user-1',
      expect.objectContaining({
        type: 'VALIDATION',
        entityType: 'TASK',
        entityId: 'task-1',
      }),
      null,
    );
    expect(result.type).toBe('VALIDATION');
  });

  it('delegates findAll to the service', async () => {
    mockService.findAll.mockResolvedValue([]);
    await controller.findAll(
      projectId as any,
      'org-1' as any,
      `${sessionId1}, ${sessionId2}`,
      'user-1',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(mockService.findAll).toHaveBeenCalledWith(
      'org-1',
      projectId,
      {
        ids: [sessionId1, sessionId2],
        userId: 'user-1',
        conversationId: undefined,
        initiativeId: undefined,
        taskId: undefined,
        designDocId: undefined,
        planId: undefined,
        serviceId: undefined,
      },
      false,
    );
  });

  it('supports repeated ids query values', async () => {
    mockService.findAll.mockResolvedValue([]);

    await controller.findAll(
      projectId as any,
      'org-1' as any,
      [sessionId1, sessionId2],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(mockService.findAll).toHaveBeenCalledWith(
      'org-1',
      projectId,
      {
        ids: [sessionId1, sessionId2],
        userId: undefined,
        conversationId: undefined,
        initiativeId: undefined,
        taskId: undefined,
        designDocId: undefined,
        planId: undefined,
        serviceId: undefined,
      },
      false,
    );
  });

  it('throws for empty ids values', async () => {
    await expect(
      controller.findAll(
        projectId as any,
        'org-1' as any,
        'cs-1,',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ),
    ).rejects.toThrow('ids must contain non-empty values');
  });

  it('throws for invalid uuid ids values', async () => {
    await expect(
      controller.findAll(
        projectId as any,
        'org-1' as any,
        `${sessionId1},not-a-uuid`,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ),
    ).rejects.toThrow('ids must contain valid UUID values');
  });

  it('forwards includeService for list', async () => {
    mockService.findAll.mockResolvedValue([]);

    await controller.findAll(
      projectId as any,
      'org-1' as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );

    expect(mockService.findAll).toHaveBeenCalledWith(
      'org-1',
      projectId,
      expect.objectContaining({
        ids: undefined,
      }),
      true,
    );
  });

  it('forwards serviceId for list filter', async () => {
    mockService.findAll.mockResolvedValue([]);

    await controller.findAll(
      projectId as any,
      'org-1' as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'service-1',
      undefined,
    );

    expect(mockService.findAll).toHaveBeenCalledWith(
      'org-1',
      projectId,
      expect.objectContaining({
        serviceId: 'service-1',
      }),
      false,
    );
  });

  it('forwards entityType/entityId for list filter', async () => {
    mockService.findAll.mockResolvedValue([]);

    await controller.findAll(
      projectId as any,
      'org-1' as any,
      undefined,
      undefined,
      undefined,
      'TASK',
      'plan-1',
      undefined,
      undefined,
    );

    expect(mockService.findAll).toHaveBeenCalledWith(
      'org-1',
      projectId,
      expect.objectContaining({
        entityType: 'TASK',
        entityId: 'plan-1',
      }),
      false,
    );
  });

  it('parses and delegates the paginated list query', async () => {
    mockService.findPaginated.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    await controller.findPaginated(
      projectId as any,
      'org-1' as any,
      'CODING',
      ['IN_PROGRESS', 'COMPLETED'],
      'LAST_MESSAGE',
      '25',
      'opaque-cursor',
      '77777777-7777-4777-8777-777777777777',
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666',
    );

    expect(mockService.findPaginated).toHaveBeenCalledWith('org-1', projectId, {
      type: 'CODING',
      statuses: ['COMPLETED', 'IN_PROGRESS'],
      sort: 'LAST_MESSAGE',
      limit: 25,
      userId: '77777777-7777-4777-8777-777777777777',
      serviceId: '55555555-5555-4555-8555-555555555555',
      taskId: '66666666-6666-4666-8666-666666666666',
      cursor: 'opaque-cursor',
    });
  });

  it('uses contract defaults for an unfiltered paginated list', async () => {
    mockService.findPaginated.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    await controller.findPaginated(projectId as any, 'org-1' as any);

    expect(mockService.findPaginated).toHaveBeenCalledWith('org-1', projectId, {
      type: undefined,
      statuses: [],
      sort: 'LAST_MESSAGE',
      limit: 20,
    });
  });

  it('rejects invalid paginated list query values before delegation', async () => {
    await expect(
      controller.findPaginated(projectId as any, 'org-1' as any, 'CODING', [
        'IN_PROGRESS',
        'UNKNOWN',
      ]),
    ).rejects.toThrow('status must contain only');
    await expect(
      controller.findPaginated(
        projectId as any,
        'org-1' as any,
        undefined,
        undefined,
        'LAST_MESSAGE',
        '101',
      ),
    ).rejects.toThrow('limit must be an integer between 1 and 100');
    await expect(
      controller.findPaginated(
        projectId as any,
        'org-1' as any,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'not-a-uuid',
      ),
    ).rejects.toThrow('userId must be a valid UUID');
    await expect(
      controller.findPaginated(
        projectId as any,
        'org-1' as any,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'not-a-uuid',
      ),
    ).rejects.toThrow('serviceId must be a valid UUID');
    await expect(
      controller.findPaginated(
        projectId as any,
        'org-1' as any,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'not-a-uuid',
      ),
    ).rejects.toThrow('taskId must be a valid UUID');

    expect(mockService.findPaginated).not.toHaveBeenCalled();
  });

  it('delegates findOne to the service', async () => {
    mockService.findOne.mockResolvedValue({ id: 'cs-1' });
    const result = await controller.findOne(
      'cs-1',
      projectId as any,
      'org-1' as any,
      true,
      true,
    );
    expect(result.id).toBe('cs-1');
    expect(mockService.findOne).toHaveBeenCalledWith('org-1', 'cs-1', {
      includeService: true,
      includeUser: true,
    });
  });

  it('delegates update to the service', async () => {
    mockService.update.mockResolvedValue({ id: 'cs-1', title: 'updated' });
    const result = await controller.update(
      'cs-1',
      projectId as any,
      {
        title: 'updated',
        agentSessionId: 'run-new',
        machineId: 'machine-1',
      },
      'org-1' as any,
    );
    expect(mockService.update).toHaveBeenCalledWith(
      'org-1',
      'cs-1',
      expect.objectContaining({ agentSessionId: 'run-new' }),
      null,
    );
    expect(result.title).toBe('updated');
  });

  it('rejects an update without the required machine binding', async () => {
    await expect(
      controller.update(
        'cs-1',
        projectId as any,
        { title: 'updated' } as Parameters<typeof controller.update>[2],
        'org-1' as any,
      ),
    ).rejects.toThrow('machineId is required');
    expect(mockService.update).not.toHaveBeenCalled();
  });

  it('forwards autoDecide=true through the PATCH path to the service', async () => {
    mockService.update.mockResolvedValue({ id: 'cs-1', autoDecide: true });
    const result = await controller.update(
      'cs-1',
      projectId as any,
      { autoDecide: true, machineId: 'machine-1' },
      'org-1' as any,
    );
    expect(mockService.update).toHaveBeenCalledWith(
      'org-1',
      'cs-1',
      expect.objectContaining({ autoDecide: true }),
      null,
    );
    expect(result.autoDecide).toBe(true);
  });

  it('forwards autoDecide=false through the PATCH path to the service', async () => {
    mockService.update.mockResolvedValue({ id: 'cs-1', autoDecide: false });
    const result = await controller.update(
      'cs-1',
      projectId as any,
      { autoDecide: false, machineId: 'machine-1' },
      'org-1' as any,
    );
    expect(mockService.update).toHaveBeenCalledWith(
      'org-1',
      'cs-1',
      expect.objectContaining({ autoDecide: false }),
      null,
    );
    expect(result.autoDecide).toBe(false);
  });

  it('delegates remove to the service', async () => {
    mockService.remove.mockResolvedValue(undefined);
    await controller.remove('cs-1', projectId as any, 'org-1' as any);
    expect(mockService.remove).toHaveBeenCalledWith('org-1', 'cs-1');
  });

  it('parses includeService query values using ParseBoolPipe semantics', async () => {
    const pipe = new ParseBoolPipe({ optional: true });

    await expect(
      pipe.transform('true', includeServiceQueryMetadata),
    ).resolves.toBe(true);
    await expect(
      pipe.transform('false', includeServiceQueryMetadata),
    ).resolves.toBe(false);
    await expect(
      pipe.transform(
        undefined as unknown as string,
        includeServiceQueryMetadata,
      ),
    ).resolves.toBeUndefined();
  });

  it('parses includeUser query values using ParseBoolPipe semantics', async () => {
    const pipe = new ParseBoolPipe({ optional: true });

    await expect(
      pipe.transform('true', includeUserQueryMetadata),
    ).resolves.toBe(true);
    await expect(
      pipe.transform('false', includeUserQueryMetadata),
    ).resolves.toBe(false);
    await expect(
      pipe.transform(undefined as unknown as string, includeUserQueryMetadata),
    ).resolves.toBeUndefined();
  });

  it('rejects invalid includeService query values', async () => {
    const pipe = new ParseBoolPipe({ optional: true });

    await expect(
      pipe.transform('yes', includeServiceQueryMetadata),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('createConversation', () => {
    const mockResponse = {
      agentSession: { id: agentSessionId, conversationId: 'conv-1' },
      conversation: { id: 'conv-1' },
    };

    it('delegates to service and returns composite result on happy path', async () => {
      mockService.createConversationForSession.mockResolvedValue(mockResponse);

      const result = await controller.createConversation(
        agentSessionId as any,
        projectId as any,
        { workflowType: 'feature-sync' as any },
        'org-1' as any,
      );

      expect(mockService.createConversationForSession).toHaveBeenCalledWith(
        'org-1',
        projectId,
        agentSessionId,
        expect.objectContaining({ workflowType: 'feature-sync' }),
      );
      expect(result).toBe(mockResponse);
    });

    it('throws 400 when workflowType is missing', async () => {
      await expect(
        controller.createConversation(
          agentSessionId as any,
          projectId as any,
          {} as any,
          'org-1' as any,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockService.createConversationForSession).not.toHaveBeenCalled();
    });

    it('throws 400 with acceptable values listed when workflowType is unknown', async () => {
      await expect(
        controller.createConversation(
          agentSessionId as any,
          projectId as any,
          { workflowType: 'not-a-real-workflow' as any },
          'org-1' as any,
        ),
      ).rejects.toThrow(/Acceptable values/);
      expect(mockService.createConversationForSession).not.toHaveBeenCalled();
    });

    it('propagates 409 from service when session already has a conversation', async () => {
      mockService.createConversationForSession.mockRejectedValue(
        new ConflictException('Agent session already has a conversation'),
      );

      await expect(
        controller.createConversation(
          agentSessionId as any,
          projectId as any,
          { workflowType: 'agent-session' as any },
          'org-1' as any,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('propagates 400 from service on cross-project/org mismatch', async () => {
      mockService.createConversationForSession.mockRejectedValue(
        new BadRequestException('Agent session not found in this project'),
      );

      await expect(
        controller.createConversation(
          agentSessionId as any,
          projectId as any,
          { workflowType: 'agent-session' as any },
          'org-2' as any,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('compactRun', () => {
    it('emits a compact control envelope and returns 204 on the happy path', async () => {
      mockService.findOne.mockResolvedValue({
        id: agentSessionId,
        userId: 'user-1',
        conversationId: 'conv-1',
        projectId,
        machineId: '77777777-7777-4777-8777-777777777777',
      });
      mockTriggerEmitter.emitCompactRunControl.mockResolvedValue({
        emitted: true,
      });

      await expect(
        controller.compactRun(
          agentSessionId as any,
          projectId as any,
          'org-1' as any,
          'user-1' as any,
          { authorization: grantAuthorization },
        ),
      ).resolves.toBeUndefined();

      expect(mockTriggerEmitter.emitCompactRunControl).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: agentSessionId,
          conversationId: 'conv-1',
          actingUserId: 'user-1',
          organizationId: 'org-1',
          projectId,
        }),
      );
    });

    it('returns 204 without emitting when no conversation is bound', async () => {
      mockService.findOne.mockResolvedValue({
        id: agentSessionId,
        userId: 'user-1',
        conversationId: null,
        projectId,
      });

      await expect(
        controller.compactRun(
          agentSessionId as any,
          projectId as any,
          'org-1' as any,
          'user-1' as any,
          { authorization: grantAuthorization },
        ),
      ).resolves.toBeUndefined();

      expect(mockTriggerEmitter.emitCompactRunControl).not.toHaveBeenCalled();
    });

    it('throws 403 on a cross-user compact attempt before emitting', async () => {
      mockService.findOne.mockResolvedValue({
        id: agentSessionId,
        userId: 'owner-user',
        conversationId: 'conv-1',
        projectId,
      });

      await expect(
        controller.compactRun(
          agentSessionId as any,
          projectId as any,
          'org-1' as any,
          'acting-user' as any,
          { authorization: grantAuthorization },
        ),
      ).rejects.toMatchObject({ status: 403 });

      expect(mockTriggerEmitter.emitCompactRunControl).not.toHaveBeenCalled();
    });

    it('translates an emitter owner_mismatch into a 403', async () => {
      mockService.findOne.mockResolvedValue({
        id: agentSessionId,
        userId: 'user-1',
        conversationId: 'conv-1',
        projectId,
        machineId: '77777777-7777-4777-8777-777777777777',
      });
      mockTriggerEmitter.emitCompactRunControl.mockResolvedValue({
        emitted: false,
        reason: 'owner_mismatch',
      });

      await expect(
        controller.compactRun(
          agentSessionId as any,
          projectId as any,
          'org-1' as any,
          'user-1' as any,
          { authorization: grantAuthorization },
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('permissionDecision', () => {
    const decisionDto = {
      decision: 'approve',
      requestId: 'req-1',
      sessionId: 'provider-session-1',
      agentType: 'claude',
      reason: 'looks safe',
      idempotencyToken: 'idem-1',
      authorization: grantAuthorization,
    } as any;

    it('emits a permission-decision control envelope and returns 204 on the happy path', async () => {
      mockService.findOne.mockResolvedValue({
        id: agentSessionId,
        userId: 'user-1',
        conversationId: 'conv-1',
        projectId,
        machineId: '77777777-7777-4777-8777-777777777777',
      });
      mockTriggerEmitter.emitPermissionDecisionControl.mockResolvedValue({
        emitted: true,
      });

      await expect(
        controller.permissionDecision(
          agentSessionId as any,
          projectId as any,
          decisionDto,
          'org-1' as any,
          'user-1' as any,
        ),
      ).resolves.toBeUndefined();

      expect(
        mockTriggerEmitter.emitPermissionDecisionControl,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          actingUserId: 'user-1',
          organizationId: 'org-1',
          projectId,
          decision: 'approve',
          requestId: 'req-1',
          sessionId: 'provider-session-1',
          agentType: 'claude',
          reason: 'looks safe',
          idempotencyToken: 'idem-1',
        }),
      );
    });

    it('returns 204 without emitting when no conversation is bound', async () => {
      mockService.findOne.mockResolvedValue({
        id: agentSessionId,
        userId: 'user-1',
        conversationId: null,
        projectId,
      });

      await expect(
        controller.permissionDecision(
          agentSessionId as any,
          projectId as any,
          decisionDto,
          'org-1' as any,
          'user-1' as any,
        ),
      ).resolves.toBeUndefined();

      expect(
        mockTriggerEmitter.emitPermissionDecisionControl,
      ).not.toHaveBeenCalled();
    });

    it('throws 403 on a cross-user decision attempt before emitting', async () => {
      mockService.findOne.mockResolvedValue({
        id: agentSessionId,
        userId: 'owner-user',
        conversationId: 'conv-1',
        projectId,
      });

      await expect(
        controller.permissionDecision(
          agentSessionId as any,
          projectId as any,
          decisionDto,
          'org-1' as any,
          'acting-user' as any,
        ),
      ).rejects.toMatchObject({ status: 403 });

      expect(
        mockTriggerEmitter.emitPermissionDecisionControl,
      ).not.toHaveBeenCalled();
    });

    it('translates an emitter owner_mismatch into a 403', async () => {
      mockService.findOne.mockResolvedValue({
        id: agentSessionId,
        userId: 'user-1',
        conversationId: 'conv-1',
        projectId,
      });
      mockTriggerEmitter.emitPermissionDecisionControl.mockResolvedValue({
        emitted: false,
        reason: 'owner_mismatch',
      });

      await expect(
        controller.permissionDecision(
          agentSessionId as any,
          projectId as any,
          decisionDto,
          'org-1' as any,
          'user-1' as any,
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('questionAnswer', () => {
    const answerDto = {
      requestId: 'question-1',
      sessionId: 'provider-session-1',
      agentType: 'claude',
      answers: { 'Which database?': 'Postgres' },
      idempotencyToken: 'idem-q1',
      authorization: grantAuthorization,
    } as any;

    it('emits a question-answer control envelope on the happy path', async () => {
      mockService.findOne.mockResolvedValue({
        id: agentSessionId,
        userId: 'user-1',
        conversationId: 'conv-1',
        projectId,
        machineId: '77777777-7777-4777-8777-777777777777',
      });
      mockTriggerEmitter.emitQuestionAnswerControl.mockResolvedValue({
        emitted: true,
      });

      await expect(
        controller.questionAnswer(
          agentSessionId as any,
          projectId as any,
          answerDto,
          'org-1' as any,
          'user-1' as any,
        ),
      ).resolves.toBeUndefined();

      expect(mockTriggerEmitter.emitQuestionAnswerControl).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          actingUserId: 'user-1',
          requestId: 'question-1',
          sessionId: 'provider-session-1',
          agentType: 'claude',
          answers: { 'Which database?': 'Postgres' },
          idempotencyToken: 'idem-q1',
        }),
      );
    });

    it('throws 403 on a cross-user answer attempt before emitting', async () => {
      mockService.findOne.mockResolvedValue({
        id: agentSessionId,
        userId: 'owner-user',
        conversationId: 'conv-1',
        projectId,
      });

      await expect(
        controller.questionAnswer(
          agentSessionId as any,
          projectId as any,
          answerDto,
          'org-1' as any,
          'acting-user' as any,
        ),
      ).rejects.toMatchObject({ status: 403 });

      expect(
        mockTriggerEmitter.emitQuestionAnswerControl,
      ).not.toHaveBeenCalled();
    });
  });

  describe('restartPlanGeneration', () => {
    it('returns the relaunched conversation id on the happy path', async () => {
      mockService.findOne.mockResolvedValue({
        id: agentSessionId,
        userId: 'user-1',
        conversationId: 'conv-1',
        projectId,
        entityType: 'TASK',
        entityId: 'plan-task',
      });
      mockRestartService.prepare.mockResolvedValue({
        conversationId: 'conv-2',
      });

      const result = await controller.restartPlanGeneration(
        agentSessionId as any,
        projectId as any,
        'org-1' as any,
        'user-1' as any,
      );

      expect(mockRestartService.prepare).toHaveBeenCalledWith(
        'org-1',
        projectId,
        'plan-task',
        'user-1',
      );
      expect(result).toEqual({
        restarted: true,
        conversationId: 'conv-2',
      });
    });

    it('throws 403 on a cross-user restart attempt before delegating', async () => {
      mockService.findOne.mockResolvedValue({
        id: agentSessionId,
        userId: 'owner-user',
        conversationId: 'conv-1',
        projectId,
        entityType: 'TASK',
        entityId: 'plan-task',
      });

      await expect(
        controller.restartPlanGeneration(
          agentSessionId as any,
          projectId as any,
          'org-1' as any,
          'acting-user' as any,
        ),
      ).rejects.toMatchObject({ status: 403 });

      expect(mockRestartService.prepare).not.toHaveBeenCalled();
    });
  });

  describe('readCliState', () => {
    it.each(SESSION_CLI_READ_OPERATIONS)(
      'rejects %s with absent controller authority before read delivery',
      async (operation) => {
        const request =
          operation === 'project.session_costs.list'
            ? { operation, projectId, limit: 25 }
            : operation === 'run.changed_files.detail'
              ? {
                  operation,
                  runId: agentSessionId,
                  file: {
                    serviceId: '77777777-7777-4777-8777-777777777777',
                    repoPath: '/workspace/repository',
                    filePath: 'src/example.ts',
                  },
                }
              : { operation, runId: agentSessionId };
        mockService.findOne.mockResolvedValue({
          id: agentSessionId,
          userId: 'user-1',
          conversationId: '55555555-5555-4555-8555-555555555555',
          projectId,
          machineId: '66666666-6666-4666-8666-666666666666',
        });
        mockExecutionGrantService.assertAgentSessionAuthorized.mockRejectedValueOnce(
          new Error('Exact controller authorization is required'),
        );

        await expect(
          controller.readCliState(
            agentSessionId,
            projectId as any,
            request as any,
            'org-1' as any,
            'user-1' as any,
          ),
        ).rejects.toThrow('Exact controller authorization is required');
        expect(mockCliReadEmitter.read).not.toHaveBeenCalled();
      },
    );

    it('routes an authorized changed-file inventory read to the durably bound machine', async () => {
      mockService.findOne.mockResolvedValue({
        id: agentSessionId,
        userId: 'user-1',
        conversationId: '55555555-5555-4555-8555-555555555555',
        projectId,
        machineId: '66666666-6666-4666-8666-666666666666',
      });
      mockCliReadEmitter.read.mockResolvedValue({
        requestId: '77777777-7777-4777-8777-777777777777',
        operation: 'run.changed_files.inventory',
        status: 'success',
        result: { runId: agentSessionId, entries: [] },
      });

      const result = await controller.readCliState(
        agentSessionId,
        projectId as any,
        {
          operation: 'run.changed_files.inventory',
          runId: agentSessionId,
          authorization: grantAuthorization,
        },
        'org-1' as any,
        'user-1' as any,
      );

      expect(result.status).toBe('success');
      expect(mockCliReadEmitter.read).toHaveBeenCalledWith(
        expect.objectContaining({
          machineId: '66666666-6666-4666-8666-666666666666',
          conversationId: '55555555-5555-4555-8555-555555555555',
        }),
      );
    });

    it('routes an authorized selected-session context read through the same protected boundary', async () => {
      mockService.findOne.mockResolvedValue({
        id: agentSessionId,
        userId: 'user-1',
        conversationId: '55555555-5555-4555-8555-555555555555',
        projectId,
        machineId: '66666666-6666-4666-8666-666666666666',
      });
      mockCliReadEmitter.read.mockResolvedValue({
        requestId: '77777777-7777-4777-8777-777777777777',
        operation: 'run.context_usage.get',
        status: 'error',
        error: { code: CliReadErrorCode.Timeout, message: 'timed out' },
      });
      const request = {
        operation: 'run.context_usage.get' as const,
        runId: agentSessionId,
        providerSessionId: 'provider-session-1',
        authorization: grantAuthorization,
      };

      await expect(
        controller.readCliState(
          agentSessionId,
          projectId as any,
          request,
          'org-1' as any,
          'user-1' as any,
        ),
      ).resolves.toMatchObject({ operation: 'run.context_usage.get' });
      expect(mockCliReadEmitter.read).toHaveBeenCalledWith(
        expect.objectContaining({ request, agentSessionId }),
      );
    });

    it('returns a typed error without emitting when no machine is bound', async () => {
      const typedError = {
        status: 'error',
        error: { code: 'MACHINE_NOT_BOUND' },
      };
      mockService.findOne.mockResolvedValue({
        id: agentSessionId,
        userId: 'user-1',
        conversationId: '55555555-5555-4555-8555-555555555555',
        projectId,
        machineId: null,
      });
      mockCliReadEmitter.error.mockReturnValue(typedError);

      await expect(
        controller.readCliState(
          agentSessionId,
          projectId as any,
          {
            operation: 'run.changed_files.count',
            runId: agentSessionId,
            authorization: grantAuthorization,
          },
          'org-1' as any,
          'user-1' as any,
        ),
      ).resolves.toBe(typedError);
      expect(mockCliReadEmitter.read).not.toHaveBeenCalled();
    });

    it('forwards a project-session cost collection unchanged to the bound machine', async () => {
      const request = {
        operation: 'project.session_costs.list' as const,
        projectId,
        activityFrom: '2026-07-01T00:00:00.000Z',
        activityTo: '2026-07-28T23:59:59.000Z',
        minKnownCostUsd: 0.25,
        limit: 25,
        cursor: 'next-page',
        authorization: grantAuthorization,
      };
      mockService.findOne.mockResolvedValue({
        id: agentSessionId,
        userId: 'user-1',
        conversationId: '55555555-5555-4555-8555-555555555555',
        projectId,
        machineId: '66666666-6666-4666-8666-666666666666',
      });
      mockCliReadEmitter.read.mockResolvedValue({
        requestId: '77777777-7777-4777-8777-777777777777',
        operation: 'project.session_costs.list',
        status: 'success',
        result: {
          items: [],
          nextCursor: null,
          sourceAvailability: 'unavailable',
          costReadAt: '2026-07-28T20:00:00.000Z',
        },
      });

      await expect(
        controller.readCliState(
          agentSessionId,
          projectId as any,
          request,
          'org-1' as any,
          'user-1' as any,
        ),
      ).resolves.toMatchObject({
        operation: 'project.session_costs.list',
        status: 'success',
      });

      expect(mockCliReadEmitter.read).toHaveBeenCalledWith(
        expect.objectContaining({
          request,
          agentSessionId,
          machineId: '66666666-6666-4666-8666-666666666666',
          userId: 'user-1',
          organizationId: 'org-1',
          projectId,
          conversationId: '55555555-5555-4555-8555-555555555555',
          admission: {
            authorizationId: '66666666-6666-4666-8666-666666666666',
            envelopeAuthorization: grantAuthorization,
            actionPayloadHash: expect.any(String),
          },
        }),
      );
    });

    it('rejects a cost collection for a project outside the route context', async () => {
      const request = {
        operation: 'project.session_costs.list' as const,
        projectId: '88888888-8888-4888-8888-888888888888',
        limit: 25,
        authorization: grantAuthorization,
      };
      const typedError = {
        requestId: '77777777-7777-4777-8777-777777777777',
        operation: 'project.session_costs.list',
        status: 'error',
        error: { code: CliReadErrorCode.InvalidProjectContext, message: 'bad' },
      };
      mockService.findOne.mockResolvedValue({
        id: agentSessionId,
        userId: 'user-1',
        conversationId: '55555555-5555-4555-8555-555555555555',
        projectId,
        machineId: '66666666-6666-4666-8666-666666666666',
      });
      mockCliReadEmitter.error.mockReturnValue(typedError);

      await expect(
        controller.readCliState(
          agentSessionId,
          projectId as any,
          request,
          'org-1' as any,
          'user-1' as any,
        ),
      ).resolves.toBe(typedError);

      expect(mockCliReadEmitter.error).toHaveBeenCalledWith(
        request,
        CliReadErrorCode.InvalidProjectContext,
        'The requested project does not match the route project.',
      );
      expect(mockCliReadEmitter.read).not.toHaveBeenCalled();
    });
  });
});
