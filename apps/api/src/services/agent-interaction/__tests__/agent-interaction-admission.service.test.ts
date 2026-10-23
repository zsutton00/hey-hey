import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { SubagentInteractionController } from '../../../controllers/agent-interaction.controller';
import { AgentInteractionKind, AgentInteractionMode } from '../../../generated';
import type { PrismaService } from '../../../prisma/prisma.service';
import {
  AgentInteractionAdmissionService,
  parseSessionMessageCommand,
  subagentChildPayloadHash,
} from '../agent-interaction-admission.service';
import { ExecutionGrantAdmissionDeniedException } from '../../controller-authorization/execution-grant.service';
import type { AgentSessionOutputAttentionProjection } from '../../agent-session-output-attention-projection.service';
import type { ExecutionGrantService } from '../../controller-authorization/execution-grant.service';
import { CONTROLLER_BINDING_COOKIE_NAME } from '../../controller-authorization/controller-binding-cookie.service';
import {
  parseAgentInteractionAdmission,
  parseAgentInteractionSettlement,
  parseTurnAdmissionSettlement,
  parseSessionMessageInteractionAdmission,
  parseSubagentInteractionAdmission,
} from '../agent-interaction-boundary.schema';

const SOURCE = '10000000-0000-4000-8000-000000000001';
const TARGET = '10000000-0000-4000-8000-000000000002';
const MACHINE = '10000000-0000-4000-8000-000000000003';

describe('AgentInteractionAdmissionService boundary', () => {
  const transition = jest.fn().mockResolvedValue({ outcome: 'transition' });
  const outputAttention = {
    transition,
  } as unknown as AgentSessionOutputAttentionProjection;
  const transaction = jest.fn();
  const assertAgentSessionAuthorized = jest.fn();
  const executionGrants = {
    assertAgentSessionAuthorized,
  } as unknown as ExecutionGrantService;
  const service = new AgentInteractionAdmissionService(
    {
      $transaction: transaction,
    } as unknown as PrismaService,
    outputAttention,
    executionGrants,
  );
  const request = () => ({
    id: '10000000-0000-4000-8000-000000000004',
    attemptId: '10000000-0000-4000-8000-000000000005',
    kind: AgentInteractionKind.SessionMessage,
    mode: AgentInteractionMode.Foreground,
    sourceSessionId: SOURCE,
    targetSessionId: TARGET,
    destinationSessionId: SOURCE,
    expectedRevision: 0,
    generation: 1,
    idempotencyKey: 'request-one',
    objective: 'Review the target task',
    authority: {
      kind: 'MACHINE_SESSION' as const,
      machineId: MACHINE,
      sourceSessionId: SOURCE,
      targetSessionId: TARGET,
      subagentCapability: 'RESEARCH' as const,
    },
  });

  const GRANT = '10000000-0000-4000-8000-000000000006';
  const AUTHORIZATION = '10000000-0000-4000-8000-000000000007';
  const grantReference = { kind: 'bounded_grant' as const, grantId: GRANT };
  const admittedGrant = () => ({
    authorizationId: AUTHORIZATION,
    envelopeAuthorization: grantReference,
  });

  beforeEach(() => {
    transaction.mockClear();
    assertAgentSessionAuthorized.mockReset();
    assertAgentSessionAuthorized.mockResolvedValue(admittedGrant());
  });

  it('returns recoverable target inputs with absent optional fields omitted', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: request().attemptId,
        agentSessionId: TARGET,
        source: 'AGENT_INTERACTION',
        state: 'QUEUED',
        ordinal: 1,
        generation: 1,
        idempotencyKey: 'request-one',
        authorKind: 'AGENT',
        authorUserId: null,
        inputMessageId: null,
        interactionAttemptId: request().attemptId,
        turnId: null,
        createdAt: new Date('2026-09-27T00:00:00.000Z'),
        sessionMessageInput: {
          sourceSessionId: SOURCE,
          interactionId: request().id,
          attemptId: request().attemptId,
          authorKind: 'AGENT',
          objective: 'Investigate',
          authority: request().authority,
        },
        agentSession: {
          organizationId: SOURCE,
          projectId: TARGET,
          userId: SOURCE,
          machineId: MACHINE,
        },
      },
    ]);
    const admission = new AgentInteractionAdmissionService(
      {
        agentSessionTurnAdmission: { findMany },
      } as unknown as PrismaService,
      outputAttention,
      executionGrants,
    );
    const [target] = await admission.listSessionMessageTargets({
      machineId: MACHINE,
      userId: SOURCE,
    } as never);
    expect(target?.userId).toBe(SOURCE);
    expect(target?.admission.sessionMessageInput?.attemptId).toBe(
      request().attemptId,
    );
    expect(target?.admission.createdAt).toBe('2026-09-27T00:00:00.000Z');
    expect(target?.admission).not.toHaveProperty('authorUserId');
    expect(target?.admission).not.toHaveProperty('inputMessageId');
    expect(target?.admission).not.toHaveProperty('turnId');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          state: { in: ['QUEUED', 'OCCUPIED'] },
        }),
      }),
    );
  });

  it('selects exactly one canonical target only at the command boundary', () => {
    const mention = `@[agent_session:${TARGET}|Target]`;
    expect(
      parseSessionMessageCommand(` /message-agent ${mention} Investigate`),
    ).toEqual({
      targetSessionId: TARGET,
      objective: 'Investigate',
    });
    expect(() =>
      parseSessionMessageCommand(
        `Please /message-agent ${mention} Investigate`,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      parseSessionMessageCommand(`/message-agent ${mention} ask ${mention}`),
    ).toThrow(BadRequestException);
    expect(() =>
      parseSessionMessageCommand(
        '/message-agent @[agent_session:not-a-uuid|Target] Investigate',
      ),
    ).toThrow(BadRequestException);
  });

  it('requires a typed command envelope before session-message admission', () => {
    expect(() =>
      parseSessionMessageInteractionAdmission({
        id: request().id,
        attemptId: request().attemptId,
        sourceSessionId: SOURCE,
        targetSessionId: TARGET,
        commandText: `/message-agent @[agent_session:${TARGET}|Target] Investigate`,
        idempotencyKey: 'request-one',
        expectedRevision: 0,
        authorKind: 'HUMAN',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects session-message authority without the bounded research capability', async () => {
    await expect(
      service.admitInteraction({
        organizationId: SOURCE,
        projectId: TARGET,
        machine: { machineId: MACHINE as never, userId: SOURCE as never },
        userAuthorizedSessionMessage: true,
        request: {
          ...request(),
          authority: { ...request().authority, subagentCapability: undefined },
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('derives a trusted target admission from the canonical mention and owned sessions', async () => {
    const prisma = {
      agentSession: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: SOURCE,
            organizationId: SOURCE,
            projectId: TARGET,
            userId: SOURCE,
            machineId: MACHINE,
          },
          {
            id: TARGET,
            organizationId: SOURCE,
            projectId: TARGET,
            userId: SOURCE,
            machineId: TARGET,
          },
        ]),
      },
      entityRegistry: { count: jest.fn().mockResolvedValue(2) },
    } as unknown as PrismaService;
    const admission = new AgentInteractionAdmissionService(
      prisma,
      outputAttention,
      executionGrants,
    );
    const admitted = jest
      .spyOn(admission, 'admitInteraction')
      .mockResolvedValue({
        interaction: { id: request().id } as never,
        replayed: false,
      });
    const commandText = `/message-agent @[agent_session:${TARGET}|Target] Investigate`;
    await admission.requestSessionMessage({
      organizationId: SOURCE,
      projectId: TARGET,
      sessionId: SOURCE,
      userId: SOURCE as never,
      request: {
        id: request().id,
        attemptId: request().attemptId,
        sourceSessionId: SOURCE,
        targetSessionId: TARGET,
        commandText,
        idempotencyKey: 'request-one',
        expectedRevision: 0,
      },
    });
    expect(admitted).toHaveBeenCalledWith(
      expect.objectContaining({
        machine: { machineId: TARGET, userId: SOURCE },
        userAuthorizedSessionMessage: true,
        request: expect.objectContaining({
          kind: 'SESSION_MESSAGE',
          sourceSessionId: SOURCE,
          targetSessionId: TARGET,
          destinationSessionId: SOURCE,
          objective: 'Investigate',
          authority: expect.objectContaining({ machineId: TARGET }),
        }),
      }),
    );
    await expect(
      admission.requestSessionMessage({
        organizationId: SOURCE,
        projectId: TARGET,
        sessionId: SOURCE,
        userId: SOURCE as never,
        request: {
          id: request().id,
          attemptId: request().attemptId,
          sourceSessionId: SOURCE,
          targetSessionId: SOURCE,
          commandText,
          idempotencyKey: 'request-one',
          expectedRevision: 0,
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(admitted).toHaveBeenCalledTimes(1);
  });

  it('carries verified referenced Message text into an answer admission', async () => {
    const answerId = '10000000-0000-4000-8000-000000000007';
    const prisma = {
      agentSession: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: SOURCE,
            organizationId: SOURCE,
            projectId: TARGET,
            userId: SOURCE,
            machineId: MACHINE,
            conversationId: SOURCE,
          },
          {
            id: TARGET,
            organizationId: SOURCE,
            projectId: TARGET,
            userId: SOURCE,
            machineId: TARGET,
            conversationId: TARGET,
          },
        ]),
      },
      entityRegistry: { count: jest.fn().mockResolvedValue(2) },
      message: {
        findUnique: jest.fn().mockResolvedValue({
          projectId: TARGET,
          conversationId: SOURCE,
          data: { comment: 'What changed?' },
        }),
      },
    } as unknown as PrismaService;
    const admission = new AgentInteractionAdmissionService(
      prisma,
      outputAttention,
      executionGrants,
    );
    const admitted = jest
      .spyOn(admission, 'admitInteraction')
      .mockResolvedValue({
        interaction: { id: request().id } as never,
        replayed: false,
      });
    await admission.requestSessionMessage({
      organizationId: SOURCE,
      projectId: TARGET,
      sessionId: SOURCE,
      userId: SOURCE as never,
      request: {
        id: request().id,
        attemptId: request().attemptId,
        sourceSessionId: SOURCE,
        targetSessionId: TARGET,
        commandText: `/message-agent @[agent_session:${TARGET}|Target] answer @[message:${answerId}|Question]`,
        idempotencyKey: 'answer-one',
        expectedRevision: 0,
      },
    });
    expect(admitted).toHaveBeenCalledWith(
      expect.objectContaining({
        verifiedAnswerText: 'What changed?',
        request: expect.objectContaining({ answerReference: answerId }),
      }),
    );
  });

  it('rejects a machine-only subagent envelope before it can create an attempt', async () => {
    await expect(
      service.admitInteraction({
        organizationId: SOURCE,
        projectId: TARGET,
        machine: { machineId: MACHINE as never, userId: SOURCE as never },
        request: {
          ...request(),
          kind: AgentInteractionKind.Subagent,
          sourceRunId: SOURCE,
          authority: { ...request().authority, subagentCapability: 'RESEARCH' },
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('projects a settled background child with stable message and notification identities', async () => {
    const messageUpsert = jest.fn().mockResolvedValue({});
    const notificationUpsert = jest.fn().mockResolvedValue({});
    const updateInteraction = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      agentInteraction: {
        findUnique: jest.fn().mockResolvedValue({
          id: request().id,
          organizationId: SOURCE,
          projectId: TARGET,
          destinationSessionId: SOURCE,
          projectionId: request().attemptId,
          mode: 'BACKGROUND',
          kind: 'SUBAGENT',
          state: 'RESULT_READY',
          attempts: [
            {
              id: request().attemptId,
              result: {
                outcome: 'SUCCEEDED',
                outputText: 'Research findings',
                settledAt: new Date().toISOString(),
              },
            },
          ],
        }),
      },
      agentSession: {
        findUnique: jest.fn().mockResolvedValue({
          conversationId: SOURCE,
          userId: SOURCE,
          title: 'Research session',
        }),
      },
      message: { upsert: messageUpsert },
      notification: { upsert: notificationUpsert },
    };
    const prisma = {
      agentInteraction: {
        findMany: jest.fn().mockResolvedValue([{ id: request().id }]),
        updateMany: updateInteraction,
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;

    await new AgentInteractionAdmissionService(
      prisma,
      outputAttention,
      executionGrants,
    ).projectSettledSubagents();

    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionId: SOURCE,
        state: 'MESSAGE_READY',
      }),
    );

    expect(messageUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: request().attemptId },
        create: expect.objectContaining({
          id: request().attemptId,
          conversationId: SOURCE,
          data: expect.objectContaining({ response: 'Research findings' }),
        }),
      }),
    );
    expect(notificationUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: request().attemptId },
        create: expect.objectContaining({
          eventType: 'system_message',
          payload: expect.objectContaining({ messageId: request().attemptId }),
        }),
      }),
    );
    expect(updateInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: request().id, state: 'RESULT_READY' },
        data: expect.objectContaining({ state: 'DELIVERED' }),
      }),
    );
  });

  it('projects an attempt-owned session reply to the recorded source destination', async () => {
    const messageUpsert = jest.fn().mockResolvedValue({});
    const updateInteraction = jest.fn().mockResolvedValue({ count: 1 });
    const settledAt = new Date().toISOString();
    const tx = {
      agentInteraction: {
        findUnique: jest.fn().mockResolvedValue({
          id: request().id,
          organizationId: SOURCE,
          projectId: TARGET,
          destinationSessionId: SOURCE,
          projectionId: request().attemptId,
          mode: 'FOREGROUND',
          kind: 'SESSION_MESSAGE',
          state: 'RESULT_READY',
          attempts: [
            {
              id: request().attemptId,
              ordinal: 1,
              result: {
                attemptId: request().attemptId,
                interactionId: request().id,
                generation: 1,
                targetSessionId: TARGET,
                targetTurnId: MACHINE,
                terminalOutcome: 'COMPLETED',
                settledAt,
                completedAssistantMessageId: MACHINE,
                reports: [],
              },
            },
          ],
        }),
      },
      agentSession: {
        findUnique: jest.fn().mockResolvedValue({
          conversationId: SOURCE,
          userId: SOURCE,
          title: 'Source session',
        }),
      },
      message: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ data: { response: 'Target answer' } }),
        upsert: messageUpsert,
      },
    };
    const prisma = {
      agentInteraction: {
        findMany: jest.fn().mockResolvedValue([{ id: request().id }]),
        updateMany: updateInteraction,
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;

    await new AgentInteractionAdmissionService(
      prisma,
      outputAttention,
      executionGrants,
    ).projectSettledSubagents();

    expect(messageUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: request().attemptId },
        create: expect.objectContaining({
          conversationId: SOURCE,
          data: expect.objectContaining({
            response: 'Target answer',
            agentInteractionId: request().id,
            attemptId: request().attemptId,
            outcome: 'SUCCEEDED',
            result: expect.objectContaining({
              targetSessionId: TARGET,
              completedAssistantMessageId: MACHINE,
            }),
          }),
        }),
      }),
    );
    expect(updateInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: request().id, state: 'RESULT_READY' },
      }),
    );
  });

  it('keeps later Turn admissions queued while a foreground child is waiting', async () => {
    const findHead = jest.fn();
    const tx = {
      agentSession: {
        findUnique: jest.fn().mockResolvedValue({
          organizationId: SOURCE,
          projectId: TARGET,
          userId: SOURCE,
          machineId: MACHINE,
        }),
      },
      agentSessionTurnSlot: {
        findUnique: jest.fn().mockResolvedValue({ occupiedAdmissionId: null }),
      },
      agentSessionTurnAdmission: { findFirst: findHead },
      agentInteraction: {
        findFirst: jest.fn().mockResolvedValue({ id: request().id }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const claimed = await new AgentInteractionAdmissionService(
      prisma,
      outputAttention,
      executionGrants,
    ).occupyHead({
      organizationId: SOURCE,
      projectId: TARGET,
      sessionId: SOURCE,
      turnId: request().attemptId,
      machine: { machineId: MACHINE as never, userId: SOURCE as never },
    });
    expect(claimed).toBeNull();
    expect(findHead).not.toHaveBeenCalled();
  });

  it('cancels the foreground wait and unsettled attempt in one transaction', async () => {
    const updateAttempt = jest.fn().mockResolvedValue({});
    const updateEffect = jest.fn().mockResolvedValue({});
    const tx = {
      agentInteraction: {
        findUnique: jest.fn().mockResolvedValue({
          id: request().id,
          organizationId: SOURCE,
          projectId: TARGET,
          sourceSession: { userId: SOURCE },
          kind: 'SUBAGENT',
          state: 'WAITING',
          revision: 2,
          attempts: [
            {
              id: request().attemptId,
              ordinal: 1,
              targetSessionId: SOURCE,
              targetTurnId: TARGET,
              effects: [{ id: MACHINE, kind: 'SPAWN_SUBAGENT' }],
            },
          ],
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      agentInteractionAttempt: { update: updateAttempt },
      agentInteractionEffect: { update: updateEffect },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    expect(
      await new AgentInteractionAdmissionService(
        prisma,
        outputAttention,
        executionGrants,
      ).cancelOwnedSubagent({
        organizationId: SOURCE,
        projectId: TARGET,
        interactionId: request().id,
        userId: SOURCE as never,
        expectedRevision: 2,
      }),
    ).toBe(true);
    expect(tx.agentInteraction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: request().id, revision: 2, state: 'WAITING' },
        data: expect.objectContaining({
          state: 'RESULT_READY',
          cancelledAt: expect.any(Date),
        }),
      }),
    );
    expect(updateAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'CANCELLED',
          result: expect.objectContaining({ outcome: 'CANCELLED' }),
        }),
      }),
    );
    expect(updateEffect).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'CANCELLED' }),
      }),
    );
  });

  it('rejects machine provenance that disagrees with the authenticated credential before a transaction', async () => {
    await expect(
      service.admitInteraction({
        organizationId: SOURCE,
        projectId: TARGET,
        machine: { machineId: SOURCE as never, userId: SOURCE as never },
        request: request(),
        userAuthorizedSessionMessage: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects a target session on another machine before replay or enqueue', async () => {
    const tx = {
      agentSession: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: SOURCE,
            organizationId: SOURCE,
            projectId: TARGET,
            userId: SOURCE,
            machineId: MACHINE,
          },
          {
            id: TARGET,
            organizationId: SOURCE,
            projectId: TARGET,
            userId: SOURCE,
            machineId: TARGET,
          },
        ]),
      },
      agentInteraction: { findFirst: jest.fn() },
      agentSessionTurnAdmission: { create: jest.fn() },
    };
    transaction.mockImplementationOnce(
      async (callback: (client: typeof tx) => unknown) => callback(tx),
    );

    await expect(
      service.admitInteraction({
        organizationId: SOURCE,
        projectId: TARGET,
        machine: { machineId: MACHINE as never, userId: SOURCE as never },
        request: request(),
        userAuthorizedSessionMessage: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.agentInteraction.findFirst).not.toHaveBeenCalled();
    expect(tx.agentSessionTurnAdmission.create).not.toHaveBeenCalled();
  });

  it('commits an eligible dispatch effect with the queued target input', async () => {
    const effectCreate = jest.fn().mockResolvedValue({});
    const interaction = { id: request().id };
    const tx = {
      entityRegistry: { count: jest.fn().mockResolvedValue(2) },
      agentSession: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: SOURCE,
            organizationId: SOURCE,
            projectId: TARGET,
            userId: SOURCE,
            machineId: MACHINE,
          },
          {
            id: TARGET,
            organizationId: SOURCE,
            projectId: TARGET,
            userId: SOURCE,
            machineId: MACHINE,
          },
        ]),
      },
      agentInteraction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(interaction),
      },
      agentInteractionAttempt: { create: jest.fn().mockResolvedValue({}) },
      agentInteractionEffect: { create: effectCreate },
      agentSessionTurnSlot: {
        upsert: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ nextOrdinal: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      agentSessionTurnAdmission: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const admission = new AgentInteractionAdmissionService(
      prisma,
      outputAttention,
      executionGrants,
    );
    Object.defineProperty(admission, 'readInteraction', {
      value: jest.fn().mockResolvedValue(interaction),
    });

    await admission.admitInteraction({
      organizationId: SOURCE,
      projectId: TARGET,
      machine: { machineId: MACHINE as never, userId: SOURCE as never },
      request: { ...request(), kind: AgentInteractionKind.SessionMessage },
      userAuthorizedSessionMessage: true,
    });

    expect(tx.agentInteraction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ state: 'DISPATCHING' }),
    });
    expect(tx.agentSessionTurnAdmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        state: 'QUEUED',
        interactionAttemptId: request().attemptId,
      }),
    });
    expect(effectCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'DISPATCH_ADMITTED_HEAD',
        state: 'PENDING',
      }),
    });
  });

  it('accepts the UI envelope through the controller and persists a claimable child dispatch', async () => {
    const tx = {
      agentSession: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: SOURCE,
            organizationId: SOURCE,
            projectId: TARGET,
            userId: SOURCE,
            machineId: MACHINE,
            provider: 'codex',
            conversationId: SOURCE,
            serviceId: TARGET,
            createdAt: new Date('2026-09-23T00:00:00.000Z'),
          },
        ]),
      },
      serviceAgentSession: { findMany: jest.fn().mockResolvedValue([]) },
      service: { count: jest.fn().mockResolvedValue(2) },
      agentInteraction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: request().id }),
      },
      agentInteractionAttempt: { create: jest.fn().mockResolvedValue({}) },
      agentInteractionEffect: { create: jest.fn().mockResolvedValue({}) },
      agentSessionTurnAdmission: { create: jest.fn() },
    };
    const prisma = {
      agentSession: {
        findUnique: jest.fn(
          async () => ((await tx.agentSession.findMany()) as unknown[])[0],
        ),
      },
      agentInteraction: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const admission = new AgentInteractionAdmissionService(
      prisma,
      outputAttention,
      executionGrants,
    );
    Object.defineProperty(admission, 'readInteraction', {
      value: jest.fn().mockResolvedValue({ id: request().id }),
    });

    await new SubagentInteractionController(admission).request(
      SOURCE,
      TARGET,
      SOURCE,
      SOURCE as never,
      {
        id: request().id,
        attemptId: request().attemptId,
        sourceSessionId: SOURCE,
        sourceRunId: SOURCE,
        mode: 'FOREGROUND',
        capability: 'RESEARCH',
        objective: 'Inspect the implementation',
        serviceIds: [MACHINE, TARGET],
        idempotencyKey: request().idempotencyKey,
        expectedRevision: 0,
        authorization: grantReference,
      },
      {
        cookies: { [CONTROLLER_BINDING_COOKIE_NAME]: 'binding-secret' },
      } as never,
    );
    expect(tx.agentInteraction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceSessionId: SOURCE,
        sourceRunId: SOURCE,
        admittingMachineId: MACHINE,
        mode: 'FOREGROUND',
        state: 'DISPATCHING',
      }),
    });

    expect(tx.agentSessionTurnAdmission.create).not.toHaveBeenCalled();
    expect(tx.agentInteractionAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetTurnId: expect.any(String),
        authority: expect.objectContaining({
          childScope: {
            serviceIds: [MACHINE, TARGET],
            launchServiceId: TARGET,
          },
        }),
      }),
    });
    expect(tx.agentInteractionEffect.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'SPAWN_SUBAGENT',
        state: 'PENDING',
      }),
    });
  });

  it.each([
    [
      'the first submitted Service without the source anchor',
      [MACHINE, SOURCE],
      { serviceIds: [MACHINE, SOURCE], launchServiceId: MACHINE },
    ],
    ['no launch Service for graph-only work', [], { serviceIds: [] }],
  ])(
    'derives %s at subagent admission',
    async (_label, serviceIds, childScope) => {
      const source = {
        id: SOURCE,
        organizationId: SOURCE,
        projectId: TARGET,
        userId: SOURCE,
        machineId: MACHINE,
        provider: 'codex',
        conversationId: SOURCE,
        serviceId: TARGET,
        createdAt: new Date('2026-09-23T00:00:00.000Z'),
      };
      const tx = {
        agentSession: { findMany: jest.fn().mockResolvedValue([source]) },
        serviceAgentSession: { findMany: jest.fn().mockResolvedValue([]) },
        service: { count: jest.fn().mockResolvedValue(serviceIds.length) },
        agentInteraction: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: request().id }),
        },
        agentInteractionAttempt: { create: jest.fn().mockResolvedValue({}) },
        agentInteractionEffect: { create: jest.fn().mockResolvedValue({}) },
      };
      const prisma = {
        agentSession: { findUnique: jest.fn().mockResolvedValue(source) },
        agentInteraction: { findFirst: jest.fn().mockResolvedValue(null) },
        $transaction: jest.fn(
          async (callback: (client: typeof tx) => unknown) => callback(tx),
        ),
      } as unknown as PrismaService;
      const admission = new AgentInteractionAdmissionService(
        prisma,
        outputAttention,
        executionGrants,
      );
      Object.defineProperty(admission, 'readInteraction', {
        value: jest.fn().mockResolvedValue({ id: request().id }),
      });

      await admission.requestSubagent({
        organizationId: SOURCE,
        projectId: TARGET,
        sessionId: SOURCE,
        userId: SOURCE as never,
        request: {
          id: request().id,
          attemptId: request().attemptId,
          sourceSessionId: SOURCE,
          sourceRunId: SOURCE,
          mode: 'BACKGROUND',
          capability: 'RESEARCH',
          objective: 'Inspect the implementation',
          serviceIds,
          idempotencyKey: request().idempotencyKey,
          expectedRevision: 0,
          authorization: grantReference,
        },
        controllerBindingSecret: 'binding-secret',
      });

      expect(tx.agentInteractionAttempt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          authority: expect.objectContaining({ childScope }),
        }),
      });
      expect(tx.service.count).toHaveBeenCalledTimes(serviceIds.length ? 1 : 0);
    },
  );

  it('binds the claimed Turn without gating dispatch eligibility on the claim', async () => {
    const effectUpdate = jest.fn();
    const interactionUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const admission = {
      id: request().attemptId,
      interactionAttemptId: request().attemptId,
      generation: 1,
    };
    const tx = {
      agentSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: TARGET,
          organizationId: SOURCE,
          projectId: TARGET,
          userId: SOURCE,
          machineId: MACHINE,
        }),
      },
      agentSessionTurnSlot: {
        findUnique: jest.fn().mockResolvedValue({ occupiedAdmissionId: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      agentSessionTurnAdmission: {
        findFirst: jest.fn().mockResolvedValue(admission),
        update: jest.fn().mockResolvedValue(admission),
      },
      agentInteractionAttempt: {
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ interactionId: request().id }),
      },
      agentInteractionEffect: { updateMany: effectUpdate },
      agentInteraction: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: interactionUpdate,
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const service = new AgentInteractionAdmissionService(
      prisma,
      outputAttention,
      executionGrants,
    );

    await service.occupyHead({
      organizationId: SOURCE,
      projectId: TARGET,
      sessionId: TARGET,
      turnId: request().id,
      machine: { machineId: MACHINE as never, userId: SOURCE as never },
    });

    expect(effectUpdate).not.toHaveBeenCalled();
    expect(interactionUpdate).toHaveBeenCalledWith({
      where: expect.objectContaining({ state: 'DISPATCHING' }),
      data: expect.objectContaining({ state: 'WAITING' }),
    });
  });

  it('accepts generated envelope shapes and rejects forged or incomplete provenance at the wire boundary', () => {
    expect(parseAgentInteractionAdmission(request()).authority.machineId).toBe(
      MACHINE,
    );
    expect(() =>
      parseAgentInteractionAdmission({
        ...request(),
        authority: {
          ...request().authority,
          kind: 'HUMAN',
        },
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseAgentInteractionAdmission({
        ...request(),
        authority: {
          kind: 'MACHINE_SESSION',
          machineId: MACHINE,
          sourceSessionId: SOURCE,
        },
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseAgentInteractionSettlement({
        attemptId: request().attemptId,
        interactionId: request().id,
        generation: 1,
        targetSessionId: TARGET,
        targetTurnId: SOURCE,
        terminalOutcome: 'COMPLETED',
        settledAt: new Date().toISOString(),
        completedAssistantMessageId: null,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseTurnAdmissionSettlement({
        admissionId: request().id,
        agentSessionId: TARGET,
        generation: 1,
        turnId: SOURCE,
        terminalOutcome: 'COMPLETED',
        settledAt: new Date().toISOString(),
        completedAssistantMessageId: null,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects incomplete settlement evidence before touching the slot', async () => {
    await expect(
      service.settleTurn({
        organizationId: SOURCE,
        projectId: TARGET,
        machine: { machineId: MACHINE as never, userId: SOURCE as never },
        evidence: {
          attemptId: request().attemptId,
          interactionId: request().id,
          generation: 1,
          targetSessionId: TARGET,
          targetTurnId: SOURCE,
          terminalOutcome: 'SUCCEEDED',
          settledAt: new Date().toISOString(),
          completedAssistantMessageId: null,
        } as never,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each(['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'] as const)(
    'persists a %s child with the matching database-valid effect outcome',
    async (outcome) => {
      const updateEffect = jest.fn().mockResolvedValue({});
      const messageUpsert = jest.fn().mockResolvedValue({});
      if (outcome === 'EXPIRED')
        messageUpsert.mockRejectedValueOnce(
          new Error('Projection unavailable'),
        );
      const tx = {
        agentInteractionEffect: {
          findUnique: jest.fn().mockResolvedValue({
            id: MACHINE,
            kind: 'SPAWN_SUBAGENT',
            state: 'CLAIMED',
            claimOwner: SOURCE,
            claimExpiresAt: new Date(Date.now() + 60_000),
            generation: 1,
            attemptId: request().attemptId,
            attempt: {
              targetTurnId: TARGET,
              targetSessionId: SOURCE,
              ordinal: 1,
              state: 'ACCEPTED',
            },
            interaction: {
              id: request().id,
              state: 'WAITING',
              generation: 1,
              organizationId: SOURCE,
              projectId: TARGET,
              admittingMachineId: MACHINE,
            },
          }),
          update: updateEffect,
        },
        agentInteractionAttempt: { update: jest.fn().mockResolvedValue({}) },
        agentInteraction: {
          update: jest.fn().mockResolvedValue({}),
          findUnique: jest.fn().mockResolvedValue({
            id: request().id,
            organizationId: SOURCE,
            projectId: TARGET,
            destinationSessionId: SOURCE,
            projectionId: request().attemptId,
            mode: 'FOREGROUND',
            kind: 'SUBAGENT',
            state: 'RESULT_READY',
            attempts: [
              {
                id: request().attemptId,
                result: {
                  outcome,
                  outputText: 'Research result',
                  settledAt: new Date().toISOString(),
                },
              },
            ],
          }),
        },
        agentSession: {
          findUnique: jest.fn().mockResolvedValue({
            conversationId: SOURCE,
            userId: SOURCE,
            title: 'Research session',
          }),
        },
        message: { upsert: messageUpsert },
      };
      const interactionUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const prisma = {
        agentInteraction: {
          findMany: jest.fn().mockResolvedValue([{ id: request().id }]),
          updateMany: interactionUpdateMany,
        },
        $transaction: jest.fn(
          async (callback: (client: typeof tx) => unknown) => callback(tx),
        ),
      } as unknown as PrismaService;
      const admission = new AgentInteractionAdmissionService(
        prisma,
        outputAttention,
        executionGrants,
      );
      const accepted = await admission.settleSubagentDispatch({
        organizationId: SOURCE,
        projectId: TARGET,
        effectId: MACHINE,
        machine: { machineId: MACHINE as never, userId: SOURCE as never },
        evidence: {
          leaseToken: SOURCE,
          generation: 1,
          targetTurnId: TARGET,
          outcome,
          settledAt: new Date().toISOString(),
          outputText: 'Research result',
        },
      });
      expect(accepted).toBe(true);
      expect(messageUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: request().attemptId } }),
      );
      if (outcome === 'EXPIRED') {
        expect(interactionUpdateMany).not.toHaveBeenCalled();
        await admission.projectSettledSubagents();
        expect(messageUpsert).toHaveBeenCalledTimes(2);
      }
      expect(interactionUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: request().id, state: 'RESULT_READY' },
          data: expect.objectContaining({ state: 'DELIVERED' }),
        }),
      );
      expect(updateEffect).toHaveBeenCalledWith({
        where: { id: MACHINE },
        data: {
          state: outcome === 'EXPIRED' ? 'FAILED' : outcome,
          outcome: expect.objectContaining({
            outcome,
            outputText: 'Research result',
          }),
          claimExpiresAt: null,
        },
      });
      expect(tx.agentInteractionAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: outcome }),
        }),
      );
      expect(tx.agentInteraction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: 'RESULT_READY' }),
        }),
      );
    },
  );

  it('fails an expired dispatch while preserving the attempt expiry reason', async () => {
    const tx = {
      agentInteractionEffect: {
        findFirst: jest.fn().mockResolvedValue({
          id: MACHINE,
          attemptId: request().attemptId,
          interactionId: request().id,
          attempt: {
            targetTurnId: TARGET,
            targetSessionId: SOURCE,
            ordinal: 1,
          },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      agentInteractionAttempt: { update: jest.fn().mockResolvedValue({}) },
      agentInteraction: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    expect(
      await new AgentInteractionAdmissionService(
        prisma,
        outputAttention,
        executionGrants,
      ).claimSubagentDispatch({
        organizationId: SOURCE,
        projectId: TARGET,
        machine: { machineId: MACHINE as never, userId: SOURCE as never },
      }),
    ).toBeNull();
    expect(tx.agentInteractionEffect.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          state: 'FAILED',
          outcome: expect.objectContaining({
            outcome: 'EXPIRED',
            failureCode: 'DISPATCH_LEASE_EXPIRED',
          }),
        },
      }),
    );
    expect(tx.agentInteractionAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'EXPIRED' }),
      }),
    );
  });
  describe('controller-authorized subagent admission', () => {
    const source = {
      id: SOURCE,
      organizationId: SOURCE,
      projectId: TARGET,
      userId: SOURCE,
      machineId: MACHINE,
      provider: 'codex',
      conversationId: TARGET,
      serviceId: null,
      createdAt: new Date('2026-09-23T00:00:00.000Z'),
    };
    const assertion = {
      kind: 'controller_assertion' as const,
      intent: { authorizationId: AUTHORIZATION },
      credentialId: 'credential',
      clientDataJSON: 'client',
      authenticatorData: 'authenticator',
      signature: 'signature',
      userHandle: null,
      grantDescriptor: {},
    };
    const childRequest = (overrides: Record<string, unknown> = {}) => ({
      id: request().id,
      attemptId: request().attemptId,
      sourceSessionId: SOURCE,
      sourceRunId: SOURCE,
      mode: 'FOREGROUND' as const,
      capability: 'RESEARCH' as const,
      objective: 'Inspect the implementation',
      serviceIds: [] as string[],
      idempotencyKey: request().idempotencyKey,
      expectedRevision: 0,
      authorization: grantReference as never,
      ...overrides,
    });
    const harness = (existing: unknown = null) => {
      const tx = {
        agentSession: { findMany: jest.fn().mockResolvedValue([source]) },
        serviceAgentSession: { findMany: jest.fn().mockResolvedValue([]) },
        service: { count: jest.fn().mockResolvedValue(0) },
        agentInteraction: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: request().id }),
        },
        agentInteractionAttempt: { create: jest.fn().mockResolvedValue({}) },
        agentInteractionEffect: { create: jest.fn().mockResolvedValue({}) },
      };
      const transaction = jest.fn(
        async (callback: (client: typeof tx) => unknown) => callback(tx),
      );
      const prisma = {
        agentSession: { findUnique: jest.fn().mockResolvedValue(source) },
        agentInteraction: { findFirst: jest.fn().mockResolvedValue(existing) },
        $transaction: transaction,
      } as unknown as PrismaService;
      const admission = new AgentInteractionAdmissionService(
        prisma,
        outputAttention,
        executionGrants,
      );
      Object.defineProperty(admission, 'readInteraction', {
        value: jest.fn().mockResolvedValue({ id: request().id }),
      });
      const submit = (body = childRequest()) =>
        admission.requestSubagent({
          organizationId: SOURCE,
          projectId: TARGET,
          sessionId: SOURCE,
          userId: SOURCE as never,
          controllerBindingSecret: 'binding-secret',
          request: body,
        });
      return { tx, transaction, admission, submit };
    };
    const expectedHash = (body = childRequest()) =>
      subagentChildPayloadHash({
        interactionId: body.id,
        attemptId: body.attemptId,
        sourceSessionId: body.sourceSessionId,
        sourceRunId: body.sourceRunId,
        mode: body.mode,
        capability: body.capability,
        objective: body.objective,
        serviceIds: body.serviceIds,
      });

    it.each([
      ['an active grant', grantReference, grantReference],
      ['a fresh assertion', assertion, { ...assertion, grantId: GRANT }],
    ])(
      'admits %s for the current installation, owning machine and source session, then retains it',
      async (_label, submitted, executable) => {
        assertAgentSessionAuthorized.mockResolvedValue({
          authorizationId: AUTHORIZATION,
          envelopeAuthorization: executable,
        });
        const { tx, submit } = harness();
        await submit(childRequest({ authorization: submitted }));

        expect(assertAgentSessionAuthorized).toHaveBeenCalledWith({
          authorization: submitted,
          organizationId: SOURCE,
          projectId: TARGET,
          userId: SOURCE,
          actionCategory: 'CONVERSATION',
          actionType: 'CONVERSATION_TRIGGER',
          targetKind: 'AGENT_SESSION',
          agentSessionId: SOURCE,
          conversationId: TARGET,
          machineId: MACHINE,
          controllerBindingSecret: 'binding-secret',
        });
        expect(tx.agentInteractionAttempt.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            authorizationKind: executable.kind,
            authorizationId: AUTHORIZATION,
            envelopeAuthorization: executable,
            actionPayloadHash: expectedHash(),
            // The machine binding stays as provenance only.
            authority: expect.objectContaining({ kind: 'MACHINE_SESSION' }),
          }),
        });
      },
    );

    it('rejects a request without controller authorization at the wire boundary', () => {
      const { authorization: _omitted, ...unauthorized } = childRequest();
      expect(() => parseSubagentInteractionAdmission(unauthorized)).toThrow(
        BadRequestException,
      );
      expect(() =>
        parseSubagentInteractionAdmission(
          childRequest({
            authorization: { ...grantReference, machineId: MACHINE },
          }),
        ),
      ).toThrow(BadRequestException);
      expect(
        parseSubagentInteractionAdmission(childRequest()).authorization,
      ).toEqual(grantReference);
    });

    it.each([
      'installation mismatch',
      'machine mismatch',
      'target mismatch',
      'payload hash mismatch',
      'expired grant',
      'revoked grant',
    ])(
      'persists nothing when the controller owner denies %s',
      async (reason) => {
        assertAgentSessionAuthorized.mockRejectedValue(
          new ExecutionGrantAdmissionDeniedException(reason),
        );
        const { transaction, submit } = harness();
        await expect(submit()).rejects.toBeInstanceOf(
          ExecutionGrantAdmissionDeniedException,
        );
        expect(transaction).not.toHaveBeenCalled();
      },
    );

    it('binds the hash to the exact child request', () => {
      expect(expectedHash(childRequest({ objective: 'Other work' }))).not.toBe(
        expectedHash(),
      );
      expect(expectedHash(childRequest({ serviceIds: [TARGET] }))).not.toBe(
        expectedHash(),
      );
      expect(expectedHash(childRequest({ mode: 'BACKGROUND' }))).not.toBe(
        expectedHash(),
      );
    });

    it('joins an idempotent replay without consuming or minting authority', async () => {
      const first = harness();
      await first.submit();
      const fingerprint = (
        first.tx.agentInteraction.create.mock.calls[0][0] as {
          data: { requestFingerprint: string };
        }
      ).data.requestFingerprint;
      assertAgentSessionAuthorized.mockClear();

      const replay = harness({
        id: request().id,
        requestFingerprint: fingerprint,
      });
      const response = await replay.submit(
        childRequest({ authorization: assertion }),
      );

      expect(response.replayed).toBe(true);
      expect(assertAgentSessionAuthorized).not.toHaveBeenCalled();
      expect(replay.transaction).not.toHaveBeenCalled();
    });

    it('rejects a different request reusing the idempotency identity before authorization', async () => {
      const { transaction, submit } = harness({
        id: request().id,
        requestFingerprint: 'a'.repeat(64),
      });
      await expect(submit()).rejects.toBeInstanceOf(ConflictException);
      expect(assertAgentSessionAuthorized).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });
  });

  describe('subagent dispatch claims', () => {
    const claimWith = async (attempt: Record<string, unknown>) => {
      const tx = {
        agentInteractionEffect: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
              id: MACHINE,
              attemptId: request().attemptId,
              interactionId: request().id,
              generation: 1,
              interaction: {
                sourceSessionId: SOURCE,
                sourceRunId: SOURCE,
                revision: 1,
                mode: 'FOREGROUND',
              },
              attempt: {
                targetTurnId: TARGET,
                objective: 'Inspect',
                authority: {
                  kind: 'MACHINE_SESSION',
                  subagentCapability: 'RESEARCH',
                  sourceExecutionContext: {
                    provider: 'codex',
                    conversationId: SOURCE,
                    createdAt: '2026-09-23T00:00:00.000Z',
                    serviceIds: [],
                  },
                  childScope: { serviceIds: [] },
                },
                authorizationKind: null,
                authorizationId: null,
                envelopeAuthorization: null,
                actionPayloadHash: null,
                ...attempt,
              },
            }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        agentInteractionAttempt: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        agentInteraction: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const prisma = {
        $transaction: jest.fn(
          async (callback: (client: typeof tx) => unknown) => callback(tx),
        ),
      } as unknown as PrismaService;
      return new AgentInteractionAdmissionService(
        prisma,
        outputAttention,
        executionGrants,
      ).claimSubagentDispatch({
        organizationId: SOURCE,
        projectId: TARGET,
        machine: { machineId: MACHINE as never, userId: SOURCE as never },
      });
    };

    it('returns the retained evidence by its persisted kind', async () => {
      const dispatch = await claimWith({
        authorizationKind: 'bounded_grant',
        authorizationId: AUTHORIZATION,
        envelopeAuthorization: grantReference,
        actionPayloadHash: 'b'.repeat(64),
      });
      expect(dispatch).toMatchObject({
        generation: 1,
        authorization: grantReference,
        actionPayloadHash: 'b'.repeat(64),
      });
    });

    it('claims legacy attempts with null evidence instead of inventing authority', async () => {
      const dispatch = await claimWith({});
      expect(dispatch).toMatchObject({
        authorization: null,
        actionPayloadHash: null,
      });
    });

    it('refuses evidence whose envelope disagrees with the persisted kind', async () => {
      await expect(
        claimWith({
          authorizationKind: 'controller_assertion',
          authorizationId: AUTHORIZATION,
          envelopeAuthorization: grantReference,
          actionPayloadHash: 'b'.repeat(64),
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
