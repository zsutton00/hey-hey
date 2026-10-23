import { Logger } from '@nestjs/common';
import {
  AgentOperationKind,
  ControllerAuthorizationCadence,
  ExecutionAuthorizationOutcome,
  ExecutionGrantScope,
  HostActionCategory as PrismaHostActionCategory,
  HostActionTargetKind as PrismaHostActionTargetKind,
  HostAffectingActionType as PrismaHostAffectingActionType,
  Prisma,
} from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  AgentOperationDispatchAcceptedAcknowledgement,
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
} from '../../../generated';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  AgentSessionId,
  ConversationId,
  MachineId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../../types';
import { AgentOperationDispatchService } from '../../../core/websockets/agent-operation-dispatch.service';
import type { TriggerEmitter } from '../../../core/websockets/trigger-emitter.service';
import { prismaMessageResultToMessageRecordDto } from '../../../mappers/message.mapper';
import type { MessageQueryResult } from '../../types';
import type { CreateMessageInput, MessageService } from '../../message.service';
import {
  CONTROLLER_AUTHORIZATION_TTL_MS,
  CONTROLLER_DEVICE_POLICY_REVISION,
  PRISMA_CURRENT_AGENT_OPERATIONS,
  getControllerDeviceGrantExpiry,
} from '../../controller-authorization/controller-authorization.service';
import {
  ExecutionGrantAdmissionDeniedException,
  ExecutionGrantService,
} from '../../controller-authorization/execution-grant.service';
import { AgentOperationRegistryService } from '../agent-operation-registry.service';
import {
  AgentOperationSubmissionService,
  type SubmitAgentOperationInput,
} from '../agent-operation-submission.service';

const describeDatabase =
  process.env.RUN_AGENT_OPERATION_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

describeDatabase('Agent operation submission PostgreSQL invariants', () => {
  let prisma: PrismaService;
  let executionGrantService: ExecutionGrantService;
  let submissionService: AgentOperationSubmissionService;
  let messageServiceStub: MessageService;
  let registryService: AgentOperationRegistryService;
  let logSpy: jest.SpyInstance;

  const created = {
    operationIds: [] as string[],
    authorizationIds: [] as string[],
    fixtureIds: [] as Array<{
      userId: string;
      organizationId: string;
      projectId: string;
      conversationId: string;
      sessionId: string;
      machineId: string;
      credentialId: string;
      enrollmentId: string;
    }>,
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    executionGrantService = new ExecutionGrantService(prisma, {
      resolveForAdmission: jest
        .fn()
        .mockImplementation(({ secret }) =>
          Promise.resolve(secret ? JSON.parse(secret) : null),
        ),
    } as any);
    const registry = new AgentOperationRegistryService(prisma);
    const messageService = {
      addMessageInTransaction: async (
        tx: Parameters<Parameters<PrismaService['db']['$transaction']>[0]>[0],
        input: CreateMessageInput,
        _organizationId: string,
        _source: string,
        options: { executableOperationId?: string } = {},
      ) => {
        const userId =
          input.userId ?? (input.type === 'SYSTEM' ? 'system' : undefined);
        if (!userId) {
          throw new Error('USER messages require a userId');
        }
        return tx.message.create({
          data: {
            id: input.id,
            projectId: input.projectId,
            conversationId: input.conversationId,
            type: input.type,
            status:
              input.status ?? (input.type === 'SYSTEM' ? 'open' : 'completed'),
            userId,
            data: input.data as Prisma.InputJsonValue,
            ...(options.executableOperationId
              ? {
                  executionStatus: 'queued' as const,
                  executionOperationId: options.executableOperationId,
                }
              : {}),
          },
        });
      },
    };
    messageServiceStub = messageService as unknown as MessageService;
    registryService = registry;
    submissionService = new AgentOperationSubmissionService(
      prisma,
      registry,
      messageService as unknown as MessageService,
      executionGrantService,
      {
        nudgeForOperation: jest.fn().mockResolvedValue(false),
      } as unknown as AgentOperationDispatchService,
      { recordWake: jest.fn() } as never,
      {} as never,
    );
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(async () => {
    // Executable messages and their operations reference each other.
    await prisma.db.message.updateMany({
      where: {
        conversationId: {
          in: created.fixtureIds.map((fixture) => fixture.conversationId),
        },
      },
      data: { executionOperationId: null },
    });
    const operationIds = created.operationIds.splice(0);
    if (operationIds.length > 0) {
      await prisma.db.agentOperation.deleteMany({
        where: { operationId: { in: operationIds } },
      });
    }
    for (const fixture of created.fixtureIds.splice(0)) {
      await prisma.db.message.deleteMany({
        where: { conversationId: fixture.conversationId },
      });
      await prisma.db.executionGrant.deleteMany({
        where: { authorizationId: { in: created.authorizationIds } },
      });
      await prisma.db.executionAuthorization.deleteMany({
        where: { id: { in: created.authorizationIds } },
      });
      await prisma.db.agentSession.deleteMany({
        where: { id: fixture.sessionId },
      });
      await prisma.db.conversation.deleteMany({
        where: { id: fixture.conversationId },
      });
      await prisma.db.machineControllerCredential.deleteMany({
        where: { id: fixture.credentialId },
      });
      await prisma.db.machine.deleteMany({ where: { id: fixture.machineId } });
      await prisma.db.pendingMachineEnrollment.deleteMany({
        where: { id: fixture.enrollmentId },
      });
      await prisma.db.project.deleteMany({ where: { id: fixture.projectId } });
      await prisma.db.organizationMember.deleteMany({
        where: { organizationId: fixture.organizationId },
      });
      await prisma.db.organization.deleteMany({
        where: { id: fixture.organizationId },
      });
      await prisma.db.user.deleteMany({ where: { id: fixture.userId } });
    }
    created.authorizationIds.splice(0);
  });

  afterAll(async () => {
    logSpy?.mockRestore();
    await prisma.$disconnect();
  });

  it('reuses one bounded grant across distinct operations without weakening correlation or replay', async () => {
    const fixture = await createFixture(prisma);
    created.fixtureIds.push(fixture);
    created.authorizationIds.push(fixture.authorizationId);
    await prisma.db.agentSession.update({
      where: { id: fixture.sessionId },
      data: { machineId: null },
    });

    const admission = await executionGrantService.assertAgentSessionAuthorized({
      authorization: { kind: 'bounded_grant', grantId: fixture.grantId },
      organizationId: fixture.organizationId as OrganizationId,
      projectId: fixture.projectId as ProjectId,
      userId: fixture.userId as UserId,
      controllerBindingSecret: fixture.controllerBindingSecret,
      actionCategory: HostActionCategory.Conversation,
      actionType: HostAffectingActionType.ConversationTrigger,
      targetKind: HostActionTargetKind.AgentSession,
      agentSessionId: fixture.sessionId as AgentSessionId,
      conversationId: fixture.conversationId,
      machineId: fixture.machineId as MachineId,
    });
    const startOperationId = randomUUID();
    const followUpOperationId = randomUUID();
    created.operationIds.push(startOperationId, followUpOperationId);

    const startInput = buildStartInput(fixture, admission, startOperationId);
    const followUpInput = buildFollowUpInput(
      fixture,
      admission,
      followUpOperationId,
    );
    const start = await submissionService.submit(startInput);
    expect(
      await prisma.db.agentSession.findUniqueOrThrow({
        where: { id: fixture.sessionId },
        select: { machineId: true },
      }),
    ).toEqual({ machineId: fixture.machineId });
    const followUp = await submissionService.submit(followUpInput);

    const operations = await prisma.db.agentOperation.findMany({
      where: { operationId: { in: [startOperationId, followUpOperationId] } },
      orderBy: { operationId: 'asc' },
    });
    const dispatches = await prisma.db.agentOperationDispatch.findMany({
      where: { operationId: { in: [startOperationId, followUpOperationId] } },
      orderBy: { operationId: 'asc' },
    });
    expect(operations).toHaveLength(2);
    expect(dispatches).toHaveLength(2);
    expect(
      new Set(operations.map((operation) => operation.operationId)).size,
    ).toBe(2);
    expect(
      new Set(operations.map((operation) => operation.triggerMessageId)).size,
    ).toBe(2);
    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: startOperationId,
          authorizationId: fixture.authorizationId,
          grantId: fixture.grantId,
          triggerMessageId: start.triggerMessageId,
        }),
        expect.objectContaining({
          operationId: followUpOperationId,
          authorizationId: fixture.authorizationId,
          grantId: fixture.grantId,
          triggerMessageId: followUp.triggerMessageId,
        }),
      ]),
    );
    for (const dispatch of dispatches) {
      const operation = operations.find(
        (candidate) => candidate.operationId === dispatch.operationId,
      );
      expect(dispatch).toMatchObject({
        authorizationId: operation?.authorizationId,
        authorizationKind: 'BOUNDED_GRANT',
        grantId: operation?.grantId,
        machineId: fixture.machineId,
        triggerMessageId: operation?.triggerMessageId,
      });
    }

    const countsAfterDistinctSubmissions = await getDurableCounts(
      prisma,
      fixture.conversationId,
      [startOperationId, followUpOperationId],
    );
    expect(countsAfterDistinctSubmissions).toEqual({
      operations: 2,
      dispatches: 2,
      messages: 3,
    });

    const mismatchedOperationId = randomUUID();
    created.operationIds.push(mismatchedOperationId);
    await expect(
      submissionService.submit(
        buildStartInput(
          fixture,
          { ...admission, machineId: randomUUID() as MachineId },
          mismatchedOperationId,
        ),
      ),
    ).rejects.toBeInstanceOf(ExecutionGrantAdmissionDeniedException);
    expect(
      await getDurableCounts(prisma, fixture.conversationId, [
        startOperationId,
        followUpOperationId,
        mismatchedOperationId,
      ]),
    ).toEqual(countsAfterDistinctSubmissions);

    const replay = await submissionService.submit(startInput);
    expect(replay).toEqual(start);
    expect(
      await getDurableCounts(prisma, fixture.conversationId, [
        startOperationId,
        followUpOperationId,
      ]),
    ).toEqual(countsAfterDistinctSubmissions);
  });

  it('atomically persists START_RUN dispatch, canonical kickoff, and workflow delivery obligation', async () => {
    const fixture = await createFixture(prisma);
    created.fixtureIds.push(fixture);
    created.authorizationIds.push(fixture.authorizationId);
    const workflowId = randomUUID();
    await prisma.db.conversation.update({
      where: { id: fixture.conversationId },
      data: {
        workflowId,
        workflowName: 'plan-from-design-doc',
        status: 'NOT_STARTED',
      },
    });
    const admission = await executionGrantService.assertAgentSessionAuthorized({
      authorization: { kind: 'bounded_grant', grantId: fixture.grantId },
      organizationId: fixture.organizationId as OrganizationId,
      projectId: fixture.projectId as ProjectId,
      userId: fixture.userId as UserId,
      controllerBindingSecret: fixture.controllerBindingSecret,
      actionCategory: HostActionCategory.Conversation,
      actionType: HostAffectingActionType.ConversationTrigger,
      targetKind: HostActionTargetKind.AgentSession,
      agentSessionId: fixture.sessionId as AgentSessionId,
      conversationId: fixture.conversationId,
      machineId: fixture.machineId as MachineId,
    });
    const operationId = randomUUID();
    created.operationIds.push(operationId);
    const input = buildStartInput(fixture, admission, operationId);
    input.userMessage = {
      type: 'USER',
      projectId: fixture.projectId as ProjectId,
      conversationId: fixture.conversationId as ConversationId,
      userId: fixture.userId as UserId,
      data: { comment: 'Plan this change.' },
    };
    input.workflowKickoffDelivery = {
      workflowId,
      workflowName: 'plan-from-design-doc',
    };

    const snapshot = await submissionService.submit(input);
    const [operation, dispatch, delivery, messages] = await Promise.all([
      prisma.db.agentOperation.findUnique({ where: { operationId } }),
      prisma.db.agentOperationDispatch.findUnique({ where: { operationId } }),
      prisma.db.agentOperationWorkflowInputDelivery.findUnique({
        where: { operationId },
      }),
      prisma.db.message.findMany({
        where: { conversationId: fixture.conversationId },
      }),
    ]);
    const kickoffMessage = messages.find((message) => message.type === 'USER');
    const triggerMessage = messages.find(
      (message) => message.type === 'SYSTEM',
    );

    expect(snapshot.state).toBe('DISPATCH_PENDING');
    expect(operation).toMatchObject({
      kind: 'START_RUN',
      state: 'DISPATCH_PENDING',
      messageId: kickoffMessage?.id,
      triggerMessageId: triggerMessage?.id,
    });
    expect(dispatch).toMatchObject({
      state: 'PENDING',
      triggerMessageId: triggerMessage?.id,
    });
    expect(delivery).toMatchObject({
      kind: 'START_RUN_KICKOFF',
      state: 'PENDING',
      workflowId,
      workflowName: 'plan-from-design-doc',
      nodeId: null,
      action: null,
      answer: null,
    });
    expect(messages).toHaveLength(2);
    expect(kickoffMessage).toMatchObject({
      type: 'USER',
      data: { comment: 'Plan this change.' },
    });
    expect(triggerMessage).toMatchObject({ type: 'SYSTEM' });
  });

  describe('follow-up response disposition', () => {
    type Acknowledgement =
      | {
          acknowledged: true;
          machineId: string;
          acknowledgement: AgentOperationDispatchAcceptedAcknowledgement;
        }
      | { acknowledged: false; reason: string };
    /**
     * Submits through the real dispatch service; the CLI side is replaced only at the socket,
     * by acknowledgements in exactly the shape the CLI dispatch tests assert it returns.
     */
    const submitWith = async (
      respond: (operationId: string) => Promise<Acknowledgement>,
    ) => {
      const emitConversationTriggerWithAck = jest.fn(
        async (params: { agentSessionId: string }) => {
          const dispatch =
            await prisma.db.agentOperationDispatch.findFirstOrThrow({
              where: {
                operation: { agentSessionId: params.agentSessionId },
                state: 'CLAIMED',
              },
            });
          return respond(dispatch.operationId);
        },
      );
      const dispatchService = new AgentOperationDispatchService(
        prisma,
        { emitConversationTriggerWithAck } as unknown as TriggerEmitter,
        {
          recordDeliveryAttempt: jest.fn(),
          recordDispatchQueueWait: jest.fn(),
          recordDispatchCommitToAck: jest.fn(),
          recordTerminalOutcome: jest.fn(),
          recordExpiredClaimRecovery: jest.fn(),
          normalizeDeliveryReason: jest.fn(
            (reason?: string) => reason ?? 'unknown',
          ),
        } as never,
        messageServiceStub,
      );
      const service = new AgentOperationSubmissionService(
        prisma,
        registryService,
        messageServiceStub,
        executionGrantService,
        dispatchService,
        { recordWake: jest.fn() } as never,
        {} as never,
      );
      const fixture = await createFixture(prisma);
      created.fixtureIds.push(fixture);
      created.authorizationIds.push(fixture.authorizationId);
      const admission =
        await executionGrantService.assertAgentSessionAuthorized({
          authorization: { kind: 'bounded_grant', grantId: fixture.grantId },
          organizationId: fixture.organizationId as OrganizationId,
          projectId: fixture.projectId as ProjectId,
          userId: fixture.userId as UserId,
          controllerBindingSecret: fixture.controllerBindingSecret,
          actionCategory: HostActionCategory.Conversation,
          actionType: HostAffectingActionType.ConversationTrigger,
          targetKind: HostActionTargetKind.AgentSession,
          agentSessionId: fixture.sessionId as AgentSessionId,
          conversationId: fixture.conversationId,
          machineId: fixture.machineId as MachineId,
        });
      const submit = async (
        input = buildFollowUpInput(fixture, admission, randomUUID()),
      ) => {
        created.operationIds.push(input.operationId);
        const snapshot = await service.submit(input);
        const message = await prisma.db.message.findUniqueOrThrow({
          where: { id: snapshot.messageId! },
        });
        return {
          input,
          message: prismaMessageResultToMessageRecordDto(
            message as MessageQueryResult,
          ),
        };
      };
      return { submit, emitConversationTriggerWithAck, fixture };
    };
    const accepted =
      (
        inputDisposition: AgentOperationDispatchAcceptedAcknowledgement['inputDisposition'],
      ) =>
      async (operationId: string): Promise<Acknowledgement> => ({
        acknowledged: true,
        machineId: 'machine',
        acknowledgement: {
          status: 'ACCEPTED',
          operationId,
          operationFingerprint: '2'.repeat(64),
          replayed: false,
          inputDisposition,
        },
      });

    it.each(['IMMEDIATE', 'QUEUED'] as const)(
      'returns the CLI-confirmed %s disposition and replays it for a retried POST',
      async (disposition) => {
        const { submit, emitConversationTriggerWithAck } = await submitWith(
          accepted(disposition),
        );
        const first = await submit();
        expect(first.message).toMatchObject({
          executionStatus: 'queued',
          executionAdmissionDisposition: disposition,
          executionQueueConfirmed: disposition === 'QUEUED',
          createdAt: null,
        });
        const replay = await submit(first.input);
        expect(replay.message.id).toBe(first.message.id);
        expect(replay.message.executionAdmissionDisposition).toBe(disposition);
        expect(emitConversationTriggerWithAck).toHaveBeenCalledTimes(1);
      },
    );

    it('returns each rapid submission with the disposition the CLI recorded for it', async () => {
      const dispositions = ['IMMEDIATE', 'QUEUED'] as const;
      let call = 0;
      const { submit } = await submitWith((operationId) =>
        accepted(dispositions[call++]!)(operationId),
      );
      const first = await submit();
      const second = await submit();
      expect(first.message.executionAdmissionDisposition).toBe('IMMEDIATE');
      expect(second.message).toMatchObject({
        executionAdmissionDisposition: 'QUEUED',
        executionQueueConfirmed: true,
      });
    });

    it.each(['no_recipient', 'timeout'])(
      'stays pending with the delivery obligation retained when the CLI cannot confirm (%s)',
      async (reason) => {
        const { submit } = await submitWith(async () => ({
          acknowledged: false,
          reason,
        }));
        const { input, message } = await submit();
        expect(message).toMatchObject({
          executionStatus: 'queued',
          executionAdmissionDisposition: 'PENDING',
          executionQueueConfirmed: false,
        });
        expect(
          await prisma.db.agentOperationDispatch.findUniqueOrThrow({
            where: { operationId: input.operationId },
          }),
        ).toMatchObject({ state: 'PENDING' });
      },
    );
  });
});

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture(prisma: PrismaService) {
  const user = await prisma.db.user.create({
    data: {
      id: randomUUID(),
      email: `agent-operation-${randomUUID()}@example.com`,
      name: 'Agent Operation Integration User',
      passwordHash: 'integration-test-password-hash',
    },
  });
  const organization = await prisma.db.organization.create({
    data: {
      id: randomUUID(),
      name: `Agent Operation ${randomUUID()}`,
      slug: `agent-operation-${randomUUID()}`,
    },
  });
  await prisma.db.organizationMember.create({
    data: { userId: user.id, organizationId: organization.id },
  });
  const project = await prisma.db.project.create({
    data: {
      id: randomUUID(),
      organizationId: organization.id,
      name: 'Agent Operation Integration Project',
      status: 'ACTIVE',
    },
  });
  const conversation = await prisma.db.conversation.create({
    data: {
      id: randomUUID(),
      organizationId: organization.id,
      projectId: project.id,
      title: 'Agent Operation Integration Conversation',
      initiatedBy: 'USER',
      status: 'STARTED',
    },
  });
  const enrollment = await prisma.db.pendingMachineEnrollment.create({
    data: {
      id: randomUUID(),
      machineId: randomUUID(),
      machinePublicKey: 'agent-operation-machine-public-key',
      machinePublicKeyFingerprint: 'a'.repeat(64),
      machineName: 'agent-operation-machine',
      osFamily: 'linux',
      cliVersion: '2.2.2',
      authorizationProtocolVersion: 2,
      userCodeHmac: randomBytes(32).toString('hex'),
      deviceSecretDigest: randomBytes(32).toString('hex'),
      state: 'ACTIVE',
      expiresAt: new Date(Date.now() + 300_000),
      claimantUserId: user.id,
      claimantOrganizationId: organization.id,
      controllerLabel: 'Agent operation integration controller',
    },
  });
  const machine = await prisma.db.machine.create({
    data: {
      id: enrollment.machineId,
      userId: user.id,
      organizationId: organization.id,
      name: 'agent-operation-machine',
      publicKey: 'agent-operation-machine-public-key',
      tokenHash: randomBytes(32).toString('hex'),
      authorizationProtocolVersion: 2,
      authorizationState: 'READY',
    },
  });
  const credential = await prisma.db.machineControllerCredential.create({
    data: {
      id: randomUUID(),
      machineId: machine.id,
      userId: user.id,
      organizationId: organization.id,
      credentialId: `credential-${randomUUID()}`,
      credentialPublicKeyX: Buffer.alloc(32, 1),
      credentialPublicKeyY: Buffer.alloc(32, 2),
      credentialTransports: ['internal'],
      credentialSignCount: 0,
      credentialBackupEligible: true,
      credentialBackupState: false,
      controllerLabel: 'Agent operation integration controller',
      credentialFingerprint: randomBytes(32).toString('hex'),
      enrollmentId: enrollment.id,
      controllerInstallationId: enrollment.id,
    },
  });
  const session = await prisma.db.agentSession.create({
    data: {
      id: randomUUID(),
      organizationId: organization.id,
      userId: user.id,
      projectId: project.id,
      conversationId: conversation.id,
      machineId: machine.id,
      sessionDate: new Date(),
      title: 'Agent Operation Integration Session',
    },
  });
  const issuedAt = new Date();
  const authorizationId = randomUUID();
  const grantDescriptorHash = 'e'.repeat(64);
  await prisma.db.executionAuthorization.create({
    data: {
      id: authorizationId,
      requestId: randomUUID(),
      canonicalIntent: '{}',
      webauthnChallenge: randomBytes(32).toString('base64url'),
      controllerCredentialId: credential.id,
      controllerInstallationId: enrollment.id,
      machineId: machine.id,
      userId: user.id,
      organizationId: organization.id,
      projectId: project.id,
      cadence: ControllerAuthorizationCadence.FIVE_MINUTES,
      policyRevision: CONTROLLER_DEVICE_POLICY_REVISION,
      grantDescriptorHash,
      actionCategory: PrismaHostActionCategory.CONVERSATION,
      actionType: PrismaHostAffectingActionType.CONVERSATION_TRIGGER,
      actionPayloadHash: 'f'.repeat(64),
      targetKind: PrismaHostActionTargetKind.AGENT_SESSION,
      targetId: session.id,
      agentSessionId: session.id,
      nonce: randomBytes(32).toString('base64url'),
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + CONTROLLER_AUTHORIZATION_TTL_MS),
      consumedAt: issuedAt,
      outcome: ExecutionAuthorizationOutcome.ADMITTED,
      outcomeRecordedAt: issuedAt,
    },
  });
  const grant = await prisma.db.executionGrant.create({
    data: {
      authorizationId,
      scope: ExecutionGrantScope.CONTROLLER_DEVICE_WINDOW,
      controllerCredentialId: credential.id,
      controllerInstallationId: enrollment.id,
      machineId: machine.id,
      userId: user.id,
      organizationId: organization.id,
      projectId: project.id,
      cadence: ControllerAuthorizationCadence.FIVE_MINUTES,
      policyRevision: CONTROLLER_DEVICE_POLICY_REVISION,
      grantDescriptorHash,
      targetKind: PrismaHostActionTargetKind.AGENT_SESSION,
      targetId: session.id,
      allowedActions: [...PRISMA_CURRENT_AGENT_OPERATIONS],
      issuedAt,
      expiresAt: getControllerDeviceGrantExpiry(
        issuedAt,
        ControllerAuthorizationCadence.FIVE_MINUTES,
      ),
    },
  });
  return {
    userId: user.id,
    organizationId: organization.id,
    projectId: project.id,
    conversationId: conversation.id,
    sessionId: session.id,
    machineId: machine.id,
    credentialId: credential.id,
    enrollmentId: enrollment.id,
    authorizationId,
    grantId: grant.id,
    controllerBindingSecret: JSON.stringify({
      controllerInstallationId: enrollment.id,
      controllerCredentialId: credential.id,
      controllerCredentialPublicId: credential.credentialId,
      machineId: machine.id,
      userId: user.id,
      organizationId: organization.id,
      expiresAt: grant.expiresAt,
    }),
  };
}

function buildStartInput(
  fixture: Fixture,
  admission: SubmitAgentOperationInput['admission'],
  operationId: string,
): SubmitAgentOperationInput {
  return {
    operationId,
    operationFingerprint: '1'.repeat(64),
    organizationId: fixture.organizationId as OrganizationId,
    projectId: fixture.projectId as ProjectId,
    userId: fixture.userId as UserId,
    agentSessionId: fixture.sessionId as AgentSessionId,
    conversationId: fixture.conversationId as ConversationId,
    kind: AgentOperationKind.START_RUN,
    admission,
    triggerMessage: {
      type: 'SYSTEM',
      projectId: fixture.projectId as ProjectId,
      conversationId: fixture.conversationId as ConversationId,
      data: {
        type: 'AGENT',
        triggersAgent: { promptType: 'start_run' },
      },
    } as CreateMessageInput,
  };
}

function buildFollowUpInput(
  fixture: Fixture,
  admission: SubmitAgentOperationInput['admission'],
  operationId: string,
): SubmitAgentOperationInput {
  return {
    operationId,
    operationFingerprint: '2'.repeat(64),
    organizationId: fixture.organizationId as OrganizationId,
    projectId: fixture.projectId as ProjectId,
    userId: fixture.userId as UserId,
    agentSessionId: fixture.sessionId as AgentSessionId,
    conversationId: fixture.conversationId as ConversationId,
    kind: AgentOperationKind.DIRECT_TRIGGER,
    admission,
    userMessage: {
      type: 'USER',
      projectId: fixture.projectId as ProjectId,
      conversationId: fixture.conversationId as ConversationId,
      userId: fixture.userId as UserId,
      data: { comment: 'follow-up operation' },
    },
    triggerMessage: {
      type: 'SYSTEM',
      projectId: fixture.projectId as ProjectId,
      conversationId: fixture.conversationId as ConversationId,
      data: {
        type: 'AGENT',
        triggersAgent: {
          operationId: '00000000-0000-4000-8000-000000000001',
          operationFingerprint: '0'.repeat(64),
          promptType: 'user_message',
          triggerMessageId: '00000000-0000-4000-8000-000000000002',
          sourceUserMessageId: '00000000-0000-4000-8000-000000000003',
          payload: {
            handlerPromptType: 'implement',
            userMessage: 'follow-up operation',
          },
        },
      },
    } as CreateMessageInput,
  };
}

async function getDurableCounts(
  prisma: PrismaService,
  conversationId: string,
  operationIds: string[],
) {
  const [operations, dispatches, messages] = await Promise.all([
    prisma.db.agentOperation.count({
      where: { operationId: { in: operationIds } },
    }),
    prisma.db.agentOperationDispatch.count({
      where: { operationId: { in: operationIds } },
    }),
    prisma.db.message.count({ where: { conversationId } }),
  ]);
  return { operations, dispatches, messages };
}
