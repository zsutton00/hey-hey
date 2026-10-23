import {
  MachineExecutionReadinessState,
  type ConversationStartRunRequestDto,
  type ProjectReportRequestDto,
} from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import { AgentSessionService } from 'src/services/agent-session.service';
import { MachineExecutionReadinessService } from 'src/services/machine-pairing/machine-execution-readiness.service';
import { ProjectReportLaunchService } from '../project-report-launch.service';
import { ProjectReportRequestService } from '../project-report-request.service';
import type { MachinePresenceService } from 'src/core/websockets/machine-presence.service';

const organizationId = '11111111-1111-4111-8111-111111111111' as OrganizationId;
const projectId = '22222222-2222-4222-8222-222222222222' as ProjectId;
const userId = '33333333-3333-4333-8333-333333333333' as UserId;
const machineId = '44444444-4444-4444-8444-444444444444';
const sessionId = '55555555-5555-4555-8555-555555555555';
const conversationId = '66666666-6666-4666-8666-666666666666';
const attemptId = '77777777-7777-4777-8777-777777777777';
const request = {
  id: '88888888-8888-4888-8888-888888888888',
  organizationId,
  projectId,
  userId,
  kind: 'PROJECT_REPORT',
  submission: {
    question: 'What changed?',
    scope: {
      projectId,
      windowStart: '2026-09-20T00:00:00Z',
      windowEnd: '2026-09-29T00:00:00Z',
      timeZone: 'UTC',
    },
    exclusions: [],
    launch: {
      machineId,
      provider: 'codex',
      model: 'selected-model',
      effort: 'high',
    },
    idempotencyKey: 'first',
  },
  status: 'QUEUED',
  attempts: [
    {
      id: attemptId,
      attemptNumber: 1,
      status: 'QUEUED',
      idempotencyKey: 'first',
      createdAt: '2026-09-29T00:00:00Z',
    },
  ],
  createdAt: '2026-09-29T00:00:00Z',
  updatedAt: '2026-09-29T00:00:00Z',
} as ProjectReportRequestDto;

describe('ProjectReportLaunchService', () => {
  const sessions = {
    create: jest.fn(),
    update: jest.fn(),
    createConversationForSession: jest.fn(),
  };
  const readiness = { resolve: jest.fn() };
  const requests = {
    bindExecution: jest.fn(),
    fail: jest.fn(),
    failQueued: jest.fn(),
  };
  const prisma = {
    db: {
      projectReportAttempt: { findUnique: jest.fn() },
      agentSession: { findUnique: jest.fn() },
      agentOperation: { findUnique: jest.fn() },
      service: { findMany: jest.fn() },
    },
  };
  const presence = { getBindings: jest.fn() };
  const service = new ProjectReportLaunchService(
    sessions as unknown as AgentSessionService,
    readiness as unknown as MachineExecutionReadinessService,
    requests as unknown as ProjectReportRequestService,
    prisma as unknown as PrismaService,
    presence as unknown as MachinePresenceService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    readiness.resolve.mockResolvedValue({
      executionReadiness: MachineExecutionReadinessState.Ready,
    });
    sessions.create.mockResolvedValue({ id: sessionId });
    sessions.update.mockResolvedValue({ id: sessionId });
    sessions.createConversationForSession.mockResolvedValue({
      conversation: { id: conversationId },
    });
    requests.bindExecution.mockResolvedValue(true);
  });

  it('persists selected machine and binds a graph-only session and conversation', async () => {
    await service.prepare(organizationId, projectId, userId, request);
    expect(sessions.create).toHaveBeenCalledWith(
      organizationId,
      projectId,
      userId,
      expect.objectContaining({
        type: 'PROJECT_REPORT',
        provider: 'codex',
        config: expect.objectContaining({
          requestId: request.id,
          attemptId,
          effort: 'high',
        }),
      }),
    );
    const dto = sessions.create.mock.calls[0][3];
    expect(dto).not.toHaveProperty('serviceIds');
    expect(dto).not.toHaveProperty('launchServiceId');
    expect(sessions.update).toHaveBeenCalledWith(organizationId, sessionId, {
      machineId,
    });
    expect(requests.bindExecution).toHaveBeenCalledWith(
      request.id,
      attemptId,
      sessionId,
      conversationId,
    );
    expect(requests.fail).not.toHaveBeenCalled();
    expect(prisma.db.service.findMany).not.toHaveBeenCalled();
    expect(presence.getBindings).not.toHaveBeenCalled();
  });

  it('resumes nothing for a replayed request whose attempt is already prepared', async () => {
    await service.prepare(organizationId, projectId, userId, {
      ...request,
      attempts: [
        { ...request.attempts[0]!, agentSessionId: sessionId, conversationId },
      ],
    });
    expect(readiness.resolve).not.toHaveBeenCalled();
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('does not fail an attempt that a concurrent preparation bound first', async () => {
    requests.bindExecution.mockResolvedValue(false);
    await service.prepare(organizationId, projectId, userId, request);
    expect(requests.bindExecution).toHaveBeenCalled();
    expect(requests.fail).not.toHaveBeenCalled();
  });

  it('fails only a still-queued attempt when a start-run cannot launch it', async () => {
    await service.failLaunch(request.id, attemptId, 'AUTHORIZATION_FAILED');
    expect(requests.failQueued).toHaveBeenCalledWith(
      request.id,
      attemptId,
      expect.objectContaining({
        stage: 'LAUNCH',
        code: 'AUTHORIZATION_FAILED',
        retryable: true,
      }),
    );
    expect(requests.fail).not.toHaveBeenCalled();
  });

  it('keeps a failed launch retryable when the selected machine is unavailable', async () => {
    readiness.resolve.mockResolvedValue({
      executionReadiness: MachineExecutionReadinessState.Disconnected,
    });
    await service.prepare(organizationId, projectId, userId, request);
    expect(sessions.create).not.toHaveBeenCalled();
    expect(requests.fail).toHaveBeenCalledWith(
      request.id,
      attemptId,
      expect.objectContaining({ stage: 'LAUNCH', retryable: true }),
    );
  });

  it('admits only the accepted bounded start-run on its selected machine', async () => {
    prisma.db.projectReportAttempt.findUnique.mockResolvedValue({
      id: attemptId,
      status: 'QUEUED',
      agentSessionId: sessionId,
      conversationId,
      request: {
        id: request.id,
        organizationId,
        projectId,
        userId,
        resolvedScope: request.submission.scope,
        launchConfig: request.submission.launch,
      },
    });
    const config = {
      type: 'PROJECT_REPORT',
      version: 'v1',
      requestId: request.id,
      attemptId,
      model: 'selected-model',
      effort: 'high',
    } as const;
    const dto = {
      attachments: [],
      agentSessionId: sessionId,
      machineId,
      provider: 'codex',
      model: 'selected-model',
      reasoningEffort: 'high',
      handlerPromptType: 'project_report',
      payload: {
        promptType: 'project_report',
        request: { requestId: request.id, attemptId, projectId },
      },
      config,
      contextMetadata: {
        organizationId,
        projectId,
        agentSessionId: sessionId,
        capturedAt: '2026-09-29T00:00:00Z',
        userComments: [],
        fileReferences: { resolved: [], unresolved: [] },
      },
      operationId: '99999999-9999-4999-8999-999999999999',
      operationFingerprint: 'f'.repeat(64),
      authorization: {} as ConversationStartRunRequestDto['authorization'],
    } satisfies ConversationStartRunRequestDto;
    await expect(
      service.assertStartRun({
        organizationId,
        projectId,
        userId,
        conversationId,
        requestDto: dto,
      }),
    ).resolves.toEqual({ requestId: request.id, attemptId });
    await expect(
      service.assertStartRun({
        organizationId,
        projectId,
        userId,
        conversationId,
        requestDto: { ...dto, serviceIds: [] },
      }),
    ).rejects.toThrow('Start-run does not match');
    await expect(
      service.assertStartRun({
        organizationId,
        projectId,
        userId,
        conversationId,
        requestDto: { ...dto, reasoningEffort: 'medium' },
      }),
    ).rejects.toThrow('Start-run does not match');
  });
  it('admits an exact start-run replay for an attempt that already left QUEUED', async () => {
    const operationId = '99999999-9999-4999-8999-999999999999';
    const config = {
      type: 'PROJECT_REPORT',
      version: 'v1',
      requestId: request.id,
      attemptId,
      model: 'selected-model',
      effort: 'high',
    } as const;
    const dto = {
      attachments: [],
      agentSessionId: sessionId,
      machineId,
      provider: 'codex',
      model: 'selected-model',
      reasoningEffort: 'high',
      handlerPromptType: 'project_report',
      payload: {
        promptType: 'project_report',
        request: { requestId: request.id, attemptId, projectId },
      },
      config,
      contextMetadata: {
        organizationId,
        projectId,
        agentSessionId: sessionId,
        capturedAt: '2026-09-29T00:00:00Z',
        userComments: [],
        fileReferences: { resolved: [], unresolved: [] },
      },
      operationId,
      operationFingerprint: 'f'.repeat(64),
      authorization: {} as ConversationStartRunRequestDto['authorization'],
    } satisfies ConversationStartRunRequestDto;
    const input = {
      organizationId,
      projectId,
      userId,
      conversationId,
      requestDto: dto,
    };
    prisma.db.agentOperation.findUnique.mockResolvedValue({
      agentSessionId: sessionId,
      conversationId,
      fingerprint: 'f'.repeat(64),
    });
    for (const status of ['RUNNING', 'FAILED'] as const) {
      prisma.db.projectReportAttempt.findUnique.mockResolvedValue({
        id: attemptId,
        status,
        agentSessionId: sessionId,
        conversationId,
        request: {
          id: request.id,
          organizationId,
          projectId,
          userId,
          resolvedScope: request.submission.scope,
          launchConfig: request.submission.launch,
        },
      });
      await expect(service.assertStartRun(input)).resolves.toEqual({
        requestId: request.id,
        attemptId,
      });
    }
    prisma.db.agentOperation.findUnique.mockResolvedValue(null);
    await expect(service.assertStartRun(input)).rejects.toThrow(
      'Start-run does not match',
    );
  });

  describe('release notes', () => {
    const releaseNotes = {
      ...request,
      kind: 'RELEASE_NOTES',
      submission: {
        ...request.submission,
        serviceIds: [
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        ],
      },
    } as ProjectReportRequestDto;
    const serviceA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const serviceB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    beforeEach(() => {
      prisma.db.service.findMany.mockResolvedValue([
        { id: serviceB, name: 'API' },
        { id: serviceA, name: 'UI' },
      ]);
    });

    it('preserves retryable preparation failures when the binding authority is unavailable', async () => {
      presence.getBindings.mockRejectedValueOnce(
        new Error('Binding store unavailable'),
      );
      await service.prepare(organizationId, projectId, userId, releaseNotes);
      expect(requests.fail).toHaveBeenCalledWith(
        request.id,
        attemptId,
        expect.objectContaining({
          code: 'LAUNCH_PREPARATION_FAILED',
          retryable: true,
        }),
      );
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('prepares only selected repositories even when other project Services are unbound', async () => {
      presence.getBindings.mockResolvedValue({
        bindings: [{ serviceId: serviceA }],
      });
      await service.prepare(organizationId, projectId, userId, {
        ...releaseNotes,
        submission: { ...releaseNotes.submission, serviceIds: [serviceA] },
      });
      expect(sessions.create).toHaveBeenCalled();
      expect(requests.fail).not.toHaveBeenCalled();
    });

    it('names the selected unavailable Service and rejects Services outside the project', async () => {
      presence.getBindings.mockResolvedValue({
        bindings: [{ serviceId: serviceA }],
      });
      await service.prepare(organizationId, projectId, userId, releaseNotes);
      expect(requests.fail).toHaveBeenCalledWith(
        request.id,
        attemptId,
        expect.objectContaining({ message: expect.stringContaining('API') }),
      );
      await expect(
        service.resolveReleaseNotesServiceIds(
          projectId,
          machineId as import('src/types').MachineId,
          ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
        ),
      ).rejects.toThrow('active Services in this project');
    });

    it('fails launch without retry when the machine lacks a project Service repository', async () => {
      presence.getBindings.mockResolvedValue({
        bindings: [{ serviceId: serviceA }],
      });
      await service.prepare(organizationId, projectId, userId, releaseNotes);
      expect(sessions.create).not.toHaveBeenCalled();
      expect(requests.fail).toHaveBeenCalledWith(
        request.id,
        attemptId,
        expect.objectContaining({
          stage: 'LAUNCH',
          code: 'SERVICE_REPOSITORIES_UNAVAILABLE',
          retryable: false,
        }),
      );
    });

    it('prepares a session when the machine holds every project Service repository', async () => {
      presence.getBindings.mockResolvedValue({
        bindings: [{ serviceId: serviceA }, { serviceId: serviceB }],
      });
      await service.prepare(organizationId, projectId, userId, releaseNotes);
      expect(sessions.create).toHaveBeenCalled();
      expect(requests.fail).not.toHaveBeenCalled();
    });

    it('admits only a release_notes start-run bound to every project Service', async () => {
      presence.getBindings.mockResolvedValue({
        bindings: [{ serviceId: serviceA }, { serviceId: serviceB }],
      });
      prisma.db.projectReportAttempt.findUnique.mockResolvedValue({
        id: attemptId,
        status: 'QUEUED',
        agentSessionId: sessionId,
        conversationId,
        request: {
          id: request.id,
          kind: 'RELEASE_NOTES',
          serviceIds: [serviceA, serviceB],
          organizationId,
          projectId,
          userId,
          resolvedScope: request.submission.scope,
          launchConfig: request.submission.launch,
        },
      });
      const dto = {
        attachments: [],
        agentSessionId: sessionId,
        machineId,
        provider: 'codex',
        model: 'selected-model',
        reasoningEffort: 'high',
        handlerPromptType: 'release_notes',
        payload: {
          promptType: 'release_notes',
          request: { requestId: request.id, attemptId, projectId },
        },
        config: {
          type: 'PROJECT_REPORT',
          version: 'v1',
          requestId: request.id,
          attemptId,
          model: 'selected-model',
          effort: 'high',
        },
        serviceIds: [serviceA, serviceB],
        launchServiceId: serviceA,
        contextMetadata: {
          organizationId,
          projectId,
          agentSessionId: sessionId,
          capturedAt: '2026-09-29T00:00:00Z',
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        },
        operationId: '99999999-9999-4999-8999-999999999999',
        operationFingerprint: 'f'.repeat(64),
        authorization: {} as ConversationStartRunRequestDto['authorization'],
      } satisfies ConversationStartRunRequestDto;
      const assert = (requestDto: ConversationStartRunRequestDto) =>
        service.assertStartRun({
          organizationId,
          projectId,
          userId,
          conversationId,
          requestDto,
        });
      await expect(assert(dto)).resolves.toEqual({
        requestId: request.id,
        attemptId,
      });
      await expect(assert({ ...dto, serviceIds: [serviceA] })).rejects.toThrow(
        'Start-run does not match',
      );
      await expect(
        assert({
          ...dto,
          handlerPromptType: 'project_report',
          payload: { ...dto.payload, promptType: 'project_report' },
        }),
      ).rejects.toThrow('Start-run does not match');
    });
  });
});
