import { Logger } from '@nestjs/common';
import { type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import request = require('supertest');
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../../../auth/guards/project-access.guard';
import { ControllerBindingOriginGuard } from '../../../common/guards/controller-binding-origin.guard';
import { ControllerAuthorizationController } from '../../../controllers/controller-authorization.controller';
import { ConversationController } from '../../../controllers/conversation.controller';
import { canonicalizeJcs } from '../../../core/websockets/trigger-canonicalization';
import { TriggerEmitter } from '../../../core/websockets/trigger-emitter.service';
import { WebsocketConnectionManager } from '../../../core/websockets/websocket-connection-manager.service';
import { AgentSessionService as AgentSessionServiceToken } from '../../agent-session.service';
import { ConversationService } from '../../conversation.service';
import { MessageService as MessageServiceToken } from '../../message.service';
import { ControllerBindingCookieService } from '../../controller-authorization/controller-binding-cookie.service';
import { EvalRunService } from '../../eval-runs/eval-run.service';
import { ProjectReportLaunchService } from '../../project-reports/project-report-launch.service';
import { ProposalAgentFixService } from '../../proposal/proposal-agent-fix.service';
import { ConversationWorkflowService } from '../../workflows/conversation-workflow.service';
import { FlowExecutionService } from '../../workflows/flow-execution.service';
import { NodeExecutionService } from '../../workflows/node-execution.service';
import { PendingTriggerService } from '../../workflows/pending-trigger.service';
import { WorkflowExecutionService } from '../../workflows/workflow-execution.service';
import { WorkflowRouterService } from '../../workflows/workflow-router.service';
import {
  ControllerAuthorizationCadence,
  ExecutionAuthorizationOutcome,
  ExecutionGrantScope,
  HostActionCategory as PrismaHostActionCategory,
  HostActionTargetKind as PrismaHostActionTargetKind,
  HostAffectingActionType as PrismaHostAffectingActionType,
  Prisma,
} from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
  type AgentSessionContinuationNativeState,
  type AgentSessionContinuationStartupReport,
  type CliReadResponseDto,
  type ControllerStartInputs,
  type ConversationStartRunRequestDto,
  type StartRunPromptPayload,
  type SystemMessageData,
} from '@hey-hey/contracts/api/models';
import { startControllerInputs } from '../../../generated/controller-action-contract';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  AgentSessionId,
  MachineId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../../types';
import type { CliReadEmitter } from '../../../core/websockets/cli-read-emitter.service';
import type { AgentOperationDispatchService } from '../../../core/websockets/agent-operation-dispatch.service';
import type { MachinePresenceService } from '../../../core/websockets/machine-presence.service';
import type { CreateMessageInput, MessageService } from '../../message.service';
import type { AgentSessionService } from '../../agent-session.service';
import {
  ControllerAuthorizationService,
  CONTROLLER_AUTHORIZATION_TTL_MS,
  CONTROLLER_DEVICE_POLICY_REVISION,
  PRISMA_CURRENT_AGENT_OPERATIONS,
  getControllerDeviceGrantExpiry,
} from '../../controller-authorization/controller-authorization.service';
import { ExecutionGrantService } from '../../controller-authorization/execution-grant.service';
import { MachineExecutionReadinessService } from '../../machine-pairing/machine-execution-readiness.service';
import { AgentOperationRegistryService } from '../../agent-operation/agent-operation-registry.service';
import { AgentOperationSubmissionService } from '../../agent-operation/agent-operation-submission.service';
import {
  AgentSessionContinuationService,
  STARTUP_ACKNOWLEDGEMENT_TIMEOUT_MS,
} from '../agent-session-continuation.service';

const describeDatabase =
  process.env.RUN_AGENT_SESSION_CONTINUATION_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

type Fixture = Awaited<ReturnType<typeof createFixture>>;

describeDatabase('Agent Session continuation PostgreSQL invariants', () => {
  let prisma: PrismaService;
  let service: AgentSessionContinuationService;
  let controllerAuthorization: ControllerAuthorizationService;
  let grants: ExecutionGrantService;
  let submission: AgentOperationSubmissionService;
  let warn: jest.SpyInstance;
  let nativeState: AgentSessionContinuationNativeState;
  let emitterCalls: Array<{ machineId: string; continuationId: string }>;
  const fixtures: Fixture[] = [];

  const scopeOf = (fixture: Fixture) => ({
    organizationId: fixture.organizationId as OrganizationId,
    projectId: fixture.projectId as ProjectId,
    userId: fixture.userId as UserId,
    agentSessionId: fixture.sessionId as AgentSessionId,
  });

  const inspect = (fixture: Fixture, continuationId = randomUUID()) =>
    service.inspect({
      ...scopeOf(fixture),
      continuationId,
      request: {
        expectedSourceMachineId: fixture.sourceMachineId as never,
        destinationMachineId: fixture.destinationMachineId as never,
        authorization: { kind: 'bounded_grant', grantId: fixture.grantId },
      },
      controllerBindingSecret: fixture.controllerBindingSecret,
    });

  /**
   * The browser resolves controller authorization for exactly the delivery it
   * is about to submit, through the real `/resolve` target rules. A delivery
   * the commit endpoint would accept must resolve here too.
   */
  const resolveDelivery = async (fixture: Fixture, continuationId: string) => {
    const { startRunInputs } =
      await prisma.db.agentSessionContinuation.findUniqueOrThrow({
        where: { id: continuationId },
        select: { startRunInputs: true },
      });
    return controllerAuthorization.resolve({
      organizationId: fixture.organizationId as OrganizationId,
      projectId: fixture.projectId as ProjectId,
      userId: fixture.userId as UserId,
      controllerBindingSecret: fixture.controllerBindingSecret,
      input: {
        machineId: fixture.destinationMachineId,
        action: {
          requestId: randomUUID(),
          actionCategory: HostActionCategory.Conversation,
          actionType: HostAffectingActionType.ConversationTrigger,
          targetKind: HostActionTargetKind.AgentSession,
          targetId: fixture.sessionId,
          inputs: startRunInputs as unknown as ControllerStartInputs,
        },
      },
    });
  };

  /** What the commit endpoint does with a request, without the browser's resolve. */
  const submitCommit = (
    fixture: Fixture,
    continuationId: string,
    confirmSavedHistory = false,
  ) =>
    service.commit({
      ...scopeOf(fixture),
      continuationId,
      request: {
        confirmSavedHistory,
        authorization: { kind: 'bounded_grant', grantId: fixture.grantId },
      },
      controllerBindingSecret: fixture.controllerBindingSecret,
    });

  /** The browser's delivery: resolve authorization, then commit. */
  const commit = async (
    fixture: Fixture,
    continuationId: string,
    confirmSavedHistory = false,
  ) => {
    expect(await resolveDelivery(fixture, continuationId)).toMatchObject({
      outcome: 'ACTIVE_GRANT',
    });
    return submitCommit(fixture, continuationId, confirmSavedHistory);
  };

  const bindingOf = async (fixture: Fixture) =>
    (
      await prisma.db.agentSession.findUniqueOrThrow({
        where: { id: fixture.sessionId },
        select: { machineId: true },
      })
    ).machineId;

  /** The CLI's terminal answer for one delivery, as the registry records it. */
  const settleDelivery = (
    operationId: string,
    state: 'SUCCEEDED' | 'FAILED',
    failureCode?: string,
    terminalAt = new Date(),
  ) =>
    prisma.db.agentOperation.update({
      where: { operationId },
      data: {
        state,
        terminalAt,
        ...(failureCode
          ? { failureCode, failureMessage: 'destination did not accept' }
          : {}),
      },
    });

  /** The destination computer's startup report, as its machine credential authenticates it. */
  const reportStartup = (
    fixture: Fixture,
    continuationId: string,
    report: AgentSessionContinuationStartupReport,
    machineId = fixture.destinationMachineId,
  ) =>
    service.recordStartup({
      organizationId: fixture.organizationId as OrganizationId,
      projectId: fixture.projectId as ProjectId,
      agentSessionId: fixture.sessionId as AgentSessionId,
      continuationId,
      machine: {
        machineId: machineId as MachineId,
        userId: fixture.userId as UserId,
      },
      report,
    });

  /** Inspect, deliver and have the destination receive it. */
  const delivered = async (fixture: Fixture, confirmSavedHistory = false) => {
    const continuationId = randomUUID();
    await inspect(fixture, continuationId);
    const committed = await commit(
      fixture,
      continuationId,
      confirmSavedHistory,
    );
    await settleDelivery(committed.deliveryOperationId!, 'SUCCEEDED');
    await service.getStatus(scopeOf(fixture));
    return { continuationId, committed };
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    // The browser-binding cookie boundary: the fixture's secret is the binding.
    const browserBinding = {
      resolveForAdmission: jest
        .fn()
        .mockImplementation(({ secret }) =>
          Promise.resolve(secret ? JSON.parse(secret) : null),
        ),
      resolveForSelection: jest
        .fn()
        .mockImplementation(({ secret }) =>
          Promise.resolve(secret ? JSON.parse(secret) : null),
        ),
    };
    const machinePresence = {
      isPresent: jest.fn().mockResolvedValue(true),
    } as unknown as MachinePresenceService;
    const agentSessions = {
      resolveStartRunConfiguration: jest.fn().mockResolvedValue(undefined),
    } as unknown as AgentSessionService;
    controllerAuthorization = new ControllerAuthorizationService(
      prisma,
      machinePresence,
      {} as never,
      {} as never,
      browserBinding as never,
      agentSessions,
    );
    grants = new ExecutionGrantService(
      prisma,
      browserBinding as never,
      {
        resolveDirectInputs: jest
          .fn()
          .mockImplementation(async ({ action }) => action),
      } as never,
    );
    const registry = new AgentOperationRegistryService(prisma);
    const messageService = {
      addMessageInTransaction: (
        tx: Parameters<Parameters<PrismaService['db']['$transaction']>[0]>[0],
        input: CreateMessageInput,
      ) =>
        tx.message.create({
          data: {
            id: input.id,
            projectId: input.projectId,
            conversationId: input.conversationId,
            type: input.type,
            status: 'completed',
            userId: input.userId ?? 'system',
            data: input.data as Prisma.InputJsonValue,
          },
        }),
    };
    submission = new AgentOperationSubmissionService(
      prisma,
      registry,
      messageService as unknown as MessageService,
      grants,
      {
        nudgeForOperation: jest.fn().mockResolvedValue(false),
      } as unknown as AgentOperationDispatchService,
      { recordWake: jest.fn() } as never,
      {} as never,
    );
    // The CLI boundary: answers inspections the way the destination would.
    const emitter = {
      readAgentSessionContinuation: jest.fn(async (params) => {
        emitterCalls.push({
          machineId: params.machineId,
          continuationId: params.continuationId,
        });
        return {
          requestId: randomUUID(),
          operation: 'agent_session.continuation.inspect',
          status: 'success',
          result: {
            agentSessionId: params.agentSessionId,
            continuationId: params.continuationId,
            nativeState,
            reason:
              nativeState === 'USABLE'
                ? 'PROVIDER_STATE_PRESENT'
                : 'NO_LOCAL_RUN',
          },
        } satisfies CliReadResponseDto;
      }),
    };
    service = new AgentSessionContinuationService(
      prisma,
      grants,
      emitter as unknown as CliReadEmitter,
      new MachineExecutionReadinessService(prisma, machinePresence),
      registry,
      submission,
      agentSessions,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  beforeEach(() => {
    warn.mockClear();
    nativeState = 'USABLE';
    emitterCalls = [];
  });

  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) {
      await deleteFixture(prisma, fixture);
    }
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.$disconnect();
  });

  it('continues a revoked session natively on the destination, recording the previous machine and one delivery', async () => {
    const fixture = await createFixture(prisma);
    fixtures.push(fixture);
    const sourceBefore = await prisma.db.machine.findUniqueOrThrow({
      where: { id: fixture.sourceMachineId },
    });

    expect((await service.getStatus(scopeOf(fixture))).sourceState).toBe(
      'SOURCE_REVOKED',
    );
    const continuationId = randomUUID();
    const inspected = await inspect(fixture, continuationId);
    expect(inspected).toMatchObject({
      state: 'INSPECTED',
      mode: 'NATIVE_RESUME',
      previousMachineId: fixture.sourceMachineId,
      destinationMachineId: fixture.destinationMachineId,
      deliveryGeneration: 0,
      deliveryOperationId: null,
      bindingMovedAt: null,
    });
    expect(emitterCalls).toEqual([
      { machineId: fixture.destinationMachineId, continuationId },
    ]);
    // Inspection moves nothing.
    expect(await bindingOf(fixture)).toBe(fixture.sourceMachineId);

    const committed = await commit(fixture, continuationId);
    expect(committed).toMatchObject({
      state: 'PENDING',
      deliveryGeneration: 1,
      providerStartedAt: null,
    });
    expect(committed.bindingMovedAt).not.toBeNull();
    expect(await bindingOf(fixture)).toBe(fixture.destinationMachineId);

    const operation = await prisma.db.agentOperation.findUniqueOrThrow({
      where: { operationId: committed.deliveryOperationId! },
      include: { triggerMessage: true, dispatch: true },
    });
    expect(operation.kind).toBe('START_RUN');
    expect(operation.dispatch?.machineId).toBe(fixture.destinationMachineId);
    const trigger = (operation.triggerMessage?.data as SystemMessageData)
      .triggersAgent;
    expect(trigger?.promptType).toBe('start_run');
    const payload = (trigger as { payload: StartRunPromptPayload }).payload;
    expect(payload).toMatchObject({
      agentSessionId: fixture.sessionId,
      triggersAgent: false,
      continuation: { continuationId, mode: 'NATIVE_RESUME' },
      handlerPromptType: 'free_form',
      provider: 'claude',
    });
    // Local material from the previous computer never travels.
    expect(payload.attachments).toBeUndefined();
    expect(payload.stagedBrowserTab).toBeUndefined();

    // The previous machine record is untouched.
    expect(
      await prisma.db.machine.findUniqueOrThrow({
        where: { id: fixture.sourceMachineId },
      }),
    ).toEqual(sourceBefore);
    const status = await service.getStatus(scopeOf(fixture));
    expect(status.attempt).toMatchObject({
      continuationId,
      previousMachineId: fixture.sourceMachineId,
      state: 'PENDING',
    });
  });

  it('records delivery receipt without reporting success before provider startup', async () => {
    const fixture = await createFixture(prisma);
    fixtures.push(fixture);
    const continuationId = randomUUID();
    await inspect(fixture, continuationId);
    const committed = await commit(fixture, continuationId);
    await settleDelivery(committed.deliveryOperationId!, 'SUCCEEDED');

    const { attempt } = await service.getStatus(scopeOf(fixture));
    expect(attempt).toMatchObject({
      state: 'PENDING',
      providerStartedAt: null,
    });
    expect(attempt?.deliveredAt).not.toBeNull();
  });

  it('retries a failed delivery as a new generation to the same destination without a second rebind', async () => {
    const fixture = await createFixture(prisma);
    fixtures.push(fixture);
    const continuationId = randomUUID();
    await inspect(fixture, continuationId);
    const first = await commit(fixture, continuationId);
    await settleDelivery(first.deliveryOperationId!, 'FAILED', 'CLI_OFFLINE');

    const failed = (await service.getStatus(scopeOf(fixture))).attempt;
    expect(failed).toMatchObject({
      continuationId,
      state: 'FAILED',
      outcomeCode: 'CLI_OFFLINE',
      bindingMovedAt: first.bindingMovedAt,
    });
    // The destination now holds the binding, so takeover is not re-offered.
    expect((await service.getStatus(scopeOf(fixture))).sourceState).toBe(
      'BOUND_AVAILABLE',
    );

    const retried = await commit(fixture, continuationId);
    expect(retried).toMatchObject({
      continuationId,
      state: 'PENDING',
      deliveryGeneration: 2,
      outcomeCode: null,
      bindingMovedAt: first.bindingMovedAt,
    });
    expect(retried.deliveryOperationId).not.toBe(first.deliveryOperationId);
    expect(await bindingOf(fixture)).toBe(fixture.destinationMachineId);

    // A late outcome for the first delivery cannot overwrite the retry.
    await settleDelivery(first.deliveryOperationId!, 'FAILED', 'LATE');
    expect((await service.getStatus(scopeOf(fixture))).attempt).toMatchObject({
      state: 'PENDING',
      deliveryGeneration: 2,
      outcomeCode: null,
    });
  });

  it('lets only one of two concurrent retries of a failed attempt deliver', async () => {
    const fixture = await createFixture(prisma);
    fixtures.push(fixture);
    const continuationId = randomUUID();
    await inspect(fixture, continuationId);
    const first = await commit(fixture, continuationId);
    await settleDelivery(first.deliveryOperationId!, 'FAILED', 'CLI_OFFLINE');
    await service.getStatus(scopeOf(fixture));

    const results = await Promise.allSettled([
      commit(fixture, continuationId),
      commit(fixture, continuationId),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const row = await prisma.db.agentSessionContinuation.findUniqueOrThrow({
      where: { id: continuationId },
    });
    expect(row).toMatchObject({ state: 'PENDING', deliveryGeneration: 2 });
    expect(
      await prisma.db.agentOperation.count({
        where: {
          agentSessionId: fixture.sessionId,
          kind: 'START_RUN',
          state: { notIn: ['FAILED', 'DENIED', 'CANCELLED'] },
        },
      }),
    ).toBe(2); // the original launch plus the one live retry
  });

  it('keeps a failed committed attempt visible and blocks new inspections behind it', async () => {
    const fixture = await createFixture(prisma);
    fixtures.push(fixture);
    const continuationId = randomUUID();
    await inspect(fixture, continuationId);
    const first = await commit(fixture, continuationId);
    await settleDelivery(first.deliveryOperationId!, 'FAILED', 'CLI_OFFLINE');
    // The destination is later revoked too, which would otherwise re-offer takeover.
    await prisma.db.machine.update({
      where: { id: fixture.destinationMachineId },
      data: { revokedAt: new Date() },
    });

    await expect(inspect(fixture)).rejects.toMatchObject({
      response: { code: 'CONTINUATION_ATTEMPT_UNRESOLVED' },
    });
    expect((await service.getStatus(scopeOf(fixture))).attempt).toMatchObject({
      continuationId,
      state: 'FAILED',
    });
  });

  it('cancels an attempt awaiting history confirmation and starts nothing', async () => {
    const fixture = await createFixture(prisma);
    fixtures.push(fixture);
    nativeState = 'ABSENT';
    const continuationId = randomUUID();
    await inspect(fixture, continuationId);

    const cancelled = await service.cancel({
      ...scopeOf(fixture),
      continuationId,
    });
    expect(cancelled).toMatchObject({
      state: 'CANCELLED',
      deliveryOperationId: null,
    });
    expect(cancelled.terminalAt).not.toBeNull();
    // Neither authorization nor the endpoint accepts a cancelled attempt.
    await expect(
      resolveDelivery(fixture, continuationId),
    ).rejects.toMatchObject({ reason: 'TARGET_MISMATCH' });
    await expect(
      submitCommit(fixture, continuationId, true),
    ).rejects.toMatchObject({
      response: { code: 'CONTINUATION_CANCELLED' },
    });
    expect(await bindingOf(fixture)).toBe(fixture.sourceMachineId);
  });

  it('returns the recorded continuation on repeat without a second rebind or delivery', async () => {
    const fixture = await createFixture(prisma);
    fixtures.push(fixture);
    const continuationId = randomUUID();
    await inspect(fixture, continuationId);
    const first = await commit(fixture, continuationId);
    const repeatedInspection = await inspect(fixture, continuationId);
    const second = await commit(fixture, continuationId);

    expect(second.deliveryOperationId).toBe(first.deliveryOperationId);
    expect(repeatedInspection.continuationId).toBe(continuationId);
    expect(emitterCalls).toHaveLength(1);
    expect(
      await prisma.db.agentOperation.count({
        where: { agentSessionId: fixture.sessionId, kind: 'START_RUN' },
      }),
    ).toBe(2); // the original launch plus exactly one continuation
    expect(await bindingOf(fixture)).toBe(fixture.destinationMachineId);
  });

  it('reports success only when the destination confirms provider startup', async () => {
    const fixture = await createFixture(prisma);
    fixtures.push(fixture);
    const { continuationId, committed } = await delivered(fixture);
    expect((await service.getStatus(scopeOf(fixture))).attempt?.state).toBe(
      'PENDING',
    );

    const report = {
      deliveryOperationId: committed.deliveryOperationId!,
      outcome: 'RESUMED' as const,
    };
    expect(await reportStartup(fixture, continuationId, report)).toEqual({
      accepted: true,
      state: 'SUCCEEDED',
    });
    const { attempt } = await service.getStatus(scopeOf(fixture));
    expect(attempt).toMatchObject({
      state: 'SUCCEEDED',
      mode: 'NATIVE_RESUME',
    });
    expect(attempt?.providerStartedAt).not.toBeNull();
    // Repeating the report answers the same result and changes nothing.
    expect(await reportStartup(fixture, continuationId, report)).toEqual({
      accepted: true,
      state: 'SUCCEEDED',
    });
  });

  it('accepts a startup report only from the attempt destination and its latest delivery', async () => {
    const fixture = await createFixture(prisma);
    fixtures.push(fixture);
    const { continuationId, committed } = await delivered(fixture);

    await expect(
      reportStartup(
        fixture,
        continuationId,
        {
          deliveryOperationId: committed.deliveryOperationId!,
          outcome: 'RESUMED',
        },
        fixture.sourceMachineId,
      ),
    ).rejects.toMatchObject({ status: 404 });

    // A startup failure, retried as a new delivery: the first delivery's late report no longer applies.
    await reportStartup(fixture, continuationId, {
      deliveryOperationId: committed.deliveryOperationId!,
      outcome: 'FAILED',
      reasonCode: 'PROVIDER_RATE_LIMITED',
    });
    const retried = await commit(fixture, continuationId);
    expect(retried).toMatchObject({ state: 'PENDING', deliveryGeneration: 2 });
    expect(
      await reportStartup(fixture, continuationId, {
        deliveryOperationId: committed.deliveryOperationId!,
        outcome: 'RESUMED',
      }),
    ).toEqual({ accepted: false, state: 'PENDING' });
    // A report claiming the other mode is not applied.
    expect(
      await reportStartup(fixture, continuationId, {
        deliveryOperationId: retried.deliveryOperationId!,
        outcome: 'PREPARED_FROM_HISTORY',
      }),
    ).toEqual({ accepted: false, state: 'PENDING' });
  });

  it('turns a rejected native resume into a saved-history confirmation on the same attempt', async () => {
    const fixture = await createFixture(prisma);
    fixtures.push(fixture);
    const { continuationId, committed } = await delivered(fixture);

    expect(
      await reportStartup(fixture, continuationId, {
        deliveryOperationId: committed.deliveryOperationId!,
        outcome: 'NATIVE_RESUME_REJECTED',
        reasonCode: 'PROVIDER_SESSION_NOT_FOUND',
      }),
    ).toEqual({ accepted: true, state: 'AWAITING_HISTORY_CONFIRMATION' });
    const awaiting = (await service.getStatus(scopeOf(fixture))).attempt!;
    expect(awaiting).toMatchObject({
      continuationId,
      mode: 'SAVED_HISTORY',
      outcomeCode: 'PROVIDER_SESSION_NOT_FOUND',
      historyConfirmedAt: null,
    });
    expect(awaiting.nativeResumeRejectedAt).not.toBeNull();
    expect(awaiting.startRunInputs.payload.continuation).toEqual({
      continuationId,
      mode: 'SAVED_HISTORY',
    });

    // Nothing starts without consent, and the binding never moves twice.
    await expect(commit(fixture, continuationId, false)).rejects.toMatchObject({
      response: { code: 'CONTINUATION_SAVED_HISTORY_CONFIRMATION_REQUIRED' },
    });
    const confirmed = await commit(fixture, continuationId, true);
    expect(confirmed).toMatchObject({
      state: 'PENDING',
      deliveryGeneration: 2,
      bindingMovedAt: committed.bindingMovedAt,
    });
    expect(confirmed.historyConfirmedAt).not.toBeNull();
    const operation = await prisma.db.agentOperation.findUniqueOrThrow({
      where: { operationId: confirmed.deliveryOperationId! },
      include: { triggerMessage: true },
    });
    const payload = (
      (operation.triggerMessage?.data as SystemMessageData).triggersAgent as {
        payload: StartRunPromptPayload;
      }
    ).payload;
    expect(payload.continuation).toEqual({
      continuationId,
      mode: 'SAVED_HISTORY',
    });

    await settleDelivery(confirmed.deliveryOperationId!, 'SUCCEEDED');
    expect(
      await reportStartup(fixture, continuationId, {
        deliveryOperationId: confirmed.deliveryOperationId!,
        outcome: 'PREPARED_FROM_HISTORY',
      }),
    ).toEqual({ accepted: true, state: 'SUCCEEDED' });
    expect(await bindingOf(fixture)).toBe(fixture.destinationMachineId);
  });

  it('treats a missing startup report as uncertain, and a late report still resolves it', async () => {
    const fixture = await createFixture(prisma);
    fixtures.push(fixture);
    const continuationId = randomUUID();
    await inspect(fixture, continuationId);
    const committed = await commit(fixture, continuationId);
    const longAgo = new Date(
      Date.now() - STARTUP_ACKNOWLEDGEMENT_TIMEOUT_MS - 1_000,
    );
    await settleDelivery(
      committed.deliveryOperationId!,
      'SUCCEEDED',
      undefined,
      longAgo,
    );

    const uncertain = (await service.getStatus(scopeOf(fixture))).attempt;
    expect(uncertain).toMatchObject({
      state: 'UNCERTAIN',
      outcomeCode: 'STARTUP_ACKNOWLEDGEMENT_TIMEOUT',
    });
    // Uncertain is not failure: the person cannot release the binding to start elsewhere.
    await expect(
      service.cancel({ ...scopeOf(fixture), continuationId }),
    ).rejects.toMatchObject({
      response: { code: 'CONTINUATION_NOT_CANCELLABLE' },
    });

    expect(
      await reportStartup(fixture, continuationId, {
        deliveryOperationId: committed.deliveryOperationId!,
        outcome: 'RESUMED',
      }),
    ).toEqual({ accepted: true, state: 'SUCCEEDED' });
  });

  it('retries an uncertain attempt as a new delivery to the same computer', async () => {
    const fixture = await createFixture(prisma);
    fixtures.push(fixture);
    const continuationId = randomUUID();
    await inspect(fixture, continuationId);
    const committed = await commit(fixture, continuationId);
    const longAgo = new Date(
      Date.now() - STARTUP_ACKNOWLEDGEMENT_TIMEOUT_MS - 1_000,
    );
    await settleDelivery(
      committed.deliveryOperationId!,
      'SUCCEEDED',
      undefined,
      longAgo,
    );
    await service.getStatus(scopeOf(fixture));

    const retried = await commit(fixture, continuationId);
    expect(retried).toMatchObject({
      state: 'PENDING',
      deliveryGeneration: 2,
      outcomeCode: null,
      bindingMovedAt: committed.bindingMovedAt,
    });
    expect(await bindingOf(fixture)).toBe(fixture.destinationMachineId);
  });

  it('releases a failed attempt back to the previous computer so the person can continue elsewhere', async () => {
    const fixture = await createFixture(prisma);
    fixtures.push(fixture);
    const { continuationId, committed } = await delivered(fixture);
    await reportStartup(fixture, continuationId, {
      deliveryOperationId: committed.deliveryOperationId!,
      outcome: 'FAILED',
      reasonCode: 'PROVIDER_INVALID_CREDENTIAL',
    });
    const sourceBefore = await prisma.db.machine.findUniqueOrThrow({
      where: { id: fixture.sourceMachineId },
    });

    const released = await service.cancel({
      ...scopeOf(fixture),
      continuationId,
    });
    expect(released).toMatchObject({ state: 'CANCELLED' });
    expect(released.bindingRevertedAt).not.toBeNull();
    expect(await bindingOf(fixture)).toBe(fixture.sourceMachineId);
    expect(
      await prisma.db.machine.findUniqueOrThrow({
        where: { id: fixture.sourceMachineId },
      }),
    ).toEqual(sourceBefore);

    // The revoked source offers continuation again; a fresh attempt can move the session.
    expect((await service.getStatus(scopeOf(fixture))).sourceState).toBe(
      'SOURCE_REVOKED',
    );
    const again = randomUUID();
    await inspect(fixture, again);
    expect((await commit(fixture, again)).state).toBe('PENDING');
    expect(await bindingOf(fixture)).toBe(fixture.destinationMachineId);
  });

  it('lets only one of two competing continuations move the session', async () => {
    const fixture = await createFixture(prisma);
    fixtures.push(fixture);
    const a = randomUUID();
    const b = randomUUID();
    await inspect(fixture, a);
    await inspect(fixture, b);

    const results = await Promise.allSettled([
      commit(fixture, a),
      commit(fixture, b),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await prisma.db.agentSessionContinuation.count({
        where: {
          agentSessionId: fixture.sessionId,
          bindingMovedAt: { not: null },
        },
      }),
    ).toBe(1);
    expect(await bindingOf(fixture)).toBe(fixture.destinationMachineId);
  });

  it('requires confirmation before continuing from saved history', async () => {
    const fixture = await createFixture(prisma);
    fixtures.push(fixture);
    nativeState = 'ABSENT';
    const continuationId = randomUUID();
    const inspected = await inspect(fixture, continuationId);
    expect(inspected).toMatchObject({
      mode: 'SAVED_HISTORY',
      state: 'AWAITING_HISTORY_CONFIRMATION',
      historyConfirmedAt: null,
    });

    await expect(commit(fixture, continuationId, false)).rejects.toMatchObject({
      response: { code: 'CONTINUATION_SAVED_HISTORY_CONFIRMATION_REQUIRED' },
    });
    expect(await bindingOf(fixture)).toBe(fixture.sourceMachineId);

    const committed = await commit(fixture, continuationId, true);
    expect(committed.state).toBe('PENDING');
    expect(committed.historyConfirmedAt).not.toBeNull();
    expect(committed.startRunInputs.payload.continuation).toEqual({
      continuationId,
      mode: 'SAVED_HISTORY',
    });
  });

  it('keeps a session whose computer is still paired, even when it is offline', async () => {
    const fixture = await createFixture(prisma, { sourceRevoked: false });
    fixtures.push(fixture);
    expect((await service.getStatus(scopeOf(fixture))).sourceState).toBe(
      'BOUND_AVAILABLE',
    );
    await expect(inspect(fixture)).rejects.toMatchObject({
      response: { code: 'CONTINUATION_NOT_ELIGIBLE' },
    });
    expect(emitterCalls).toHaveLength(0);
    expect(await bindingOf(fixture)).toBe(fixture.sourceMachineId);
  });

  /** A start the browser launches for a session the person already owns. */
  const startInputs = (fixture: Fixture) =>
    ({
      kind: 'START_RUN',
      payload: {
        handlerPromptType: 'free_form',
        payload: {
          promptType: 'free_form',
          userMessage: 'Start from a new launcher',
          entity: { entityType: 'PROJECT', entityId: fixture.projectId },
        },
        attachments: [],
        stagedBrowserTab: null,
        model: 'claude-opus-5-5',
        provider: 'claude',
        agentSessionId: fixture.sessionId,
        contextMetadata: {
          capturedAt: new Date().toISOString(),
          organizationId: fixture.organizationId,
          projectId: fixture.projectId,
          agentSessionId: fixture.sessionId,
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        },
      },
    }) as unknown as ControllerStartInputs;

  const startAction = (fixture: Fixture, targetId = fixture.sessionId) => ({
    requestId: randomUUID(),
    actionCategory: HostActionCategory.Conversation,
    actionType: HostAffectingActionType.ConversationTrigger,
    targetKind: HostActionTargetKind.AgentSession,
    targetId,
    inputs: startInputs(fixture),
  });

  const resolveStart = (
    fixture: Fixture,
    action = startAction(fixture),
    asUser = fixture,
  ) =>
    controllerAuthorization.resolve({
      organizationId: fixture.organizationId as OrganizationId,
      projectId: fixture.projectId as ProjectId,
      userId: asUser.userId as UserId,
      controllerBindingSecret: fixture.controllerBindingSecret,
      input: { machineId: fixture.destinationMachineId, action },
    });

  const prepareStart = (fixture: Fixture) =>
    controllerAuthorization.prepare({
      organizationId: fixture.organizationId as OrganizationId,
      projectId: fixture.projectId as ProjectId,
      userId: fixture.userId as UserId,
      controllerBindingSecret: fixture.controllerBindingSecret,
      input: {
        machineId: fixture.destinationMachineId,
        controllerCredentialId: fixture.machines[1]!.credential.credentialId,
        cadence: ControllerAuthorizationCadence.FIVE_MINUTES,
        action: startAction(fixture),
      } as never,
    });

  /** Sending: admit the start against the grant, then commit it. */
  const sendStart = async (fixture: Fixture, asUserId = fixture.userId) => {
    const admission = await grants.assertInteractiveAuthorized({
      authorization: { kind: 'bounded_grant', grantId: fixture.grantId },
      inputs: startInputs(fixture),
      organizationId: fixture.organizationId as OrganizationId,
      projectId: fixture.projectId as ProjectId,
      userId: asUserId as UserId,
      controllerBindingSecret: fixture.controllerBindingSecret,
      actionType: HostAffectingActionType.ConversationTrigger,
      targetKind: HostActionTargetKind.AgentSession,
      targetId: fixture.sessionId,
      conversationId: fixture.conversationId as never,
      agentSessionId: fixture.sessionId as AgentSessionId,
      machineId: fixture.destinationMachineId as MachineId,
    });
    const operationId = randomUUID();
    const triggerMessageId = randomUUID();
    return submission.submit({
      operationId,
      operationFingerprint: '4'.repeat(64),
      organizationId: fixture.organizationId as OrganizationId,
      projectId: fixture.projectId as ProjectId,
      userId: fixture.userId as UserId,
      agentSessionId: fixture.sessionId as AgentSessionId,
      conversationId: fixture.conversationId as never,
      kind: 'START_RUN',
      admission,
      triggerMessage: {
        id: triggerMessageId as never,
        type: 'SYSTEM',
        conversationId: fixture.conversationId as never,
        projectId: fixture.projectId as ProjectId,
        status: 'completed' as never,
        data: {
          type: 'AGENT',
          triggersAgent: {
            promptType: 'start_run',
            operationId,
            operationFingerprint: '4'.repeat(64),
            triggerMessageId,
            payload: startInputs(fixture).payload,
          },
        } as unknown as SystemMessageData,
      },
    });
  };

  const loggedFailedChecks = () =>
    warn.mock.calls
      .map(([, context]) => (context as { failedCheck?: string })?.failedCheck)
      .filter(Boolean);

  describe('starting work on a session before it has a computer', () => {
    it('accepts the person’s own unbound session at resolve, prepare and sending, then binds it on start', async () => {
      const fixture = await createFixture(prisma);
      fixtures.push(fixture);
      await prisma.db.agentSession.update({
        where: { id: fixture.sessionId },
        data: { machineId: null },
      });

      expect(await resolveStart(fixture)).toMatchObject({
        outcome: 'ACTIVE_GRANT',
      });
      await expect(prepareStart(fixture)).resolves.toBeDefined();
      await sendStart(fixture);

      expect(await bindingOf(fixture)).toBe(fixture.destinationMachineId);
      expect(loggedFailedChecks()).toEqual([]);
    });

    it('refuses a session bound to a different computer at resolve and sending, and keeps its binding', async () => {
      const fixture = await createFixture(prisma);
      fixtures.push(fixture);

      await expect(resolveStart(fixture)).rejects.toMatchObject({
        status: 403,
        response: expect.objectContaining({ message: 'TARGET_MISMATCH' }),
      });
      await expect(sendStart(fixture)).rejects.toMatchObject({
        status: 403,
        response: expect.objectContaining({ message: 'TARGET_MISMATCH' }),
      });

      expect(loggedFailedChecks()).toEqual([
        'agent_session_bound_elsewhere',
        'agent_session_bound_elsewhere',
      ]);
      expect(await bindingOf(fixture)).toBe(fixture.sourceMachineId);
    });

    it('refuses a session owned by another user at resolve and sending', async () => {
      const fixture = await createFixture(prisma);
      const stranger = await createFixture(prisma);
      fixtures.push(fixture, stranger);
      const foreign = await createForeignOwnedSession(
        prisma,
        stranger,
        fixture.userId,
      );

      try {
        await expect(
          resolveStart(stranger, startAction(stranger, foreign.id)),
        ).rejects.toMatchObject({
          status: 403,
          response: expect.objectContaining({ message: 'TARGET_MISMATCH' }),
        });
        await expect(
          grants.assertInteractiveAuthorized({
            authorization: {
              kind: 'bounded_grant',
              grantId: stranger.grantId,
            },
            inputs: startInputs(stranger),
            organizationId: stranger.organizationId as OrganizationId,
            projectId: stranger.projectId as ProjectId,
            userId: stranger.userId as UserId,
            controllerBindingSecret: stranger.controllerBindingSecret,
            actionType: HostAffectingActionType.ConversationTrigger,
            targetKind: HostActionTargetKind.AgentSession,
            targetId: foreign.id,
            conversationId: stranger.conversationId as never,
            agentSessionId: foreign.id as AgentSessionId,
            machineId: stranger.destinationMachineId as MachineId,
          }),
        ).rejects.toMatchObject({
          status: 403,
          response: expect.objectContaining({ message: 'TARGET_MISMATCH' }),
        });

        expect(loggedFailedChecks()).toEqual([
          'agent_session_not_owned',
          'agent_session_not_owned',
        ]);
      } finally {
        await prisma.db.agentSession.deleteMany({ where: { id: foreign.id } });
      }
    });
  });

  it('never rebinds an unbound (pre-v2) session', async () => {
    const fixture = await createFixture(prisma);
    fixtures.push(fixture);
    await prisma.db.agentSession.update({
      where: { id: fixture.sessionId },
      data: { machineId: null },
    });
    expect((await service.getStatus(scopeOf(fixture))).sourceState).toBe(
      'UNBOUND',
    );
    await expect(inspect(fixture)).rejects.toMatchObject({
      response: { code: 'CONTINUATION_BINDING_CHANGED' },
    });
    expect(await bindingOf(fixture)).toBeNull();
  });

  it("does not reveal or continue another account's session", async () => {
    const fixture = await createFixture(prisma);
    const stranger = await createFixture(prisma);
    fixtures.push(fixture, stranger);
    await expect(
      service.getStatus({
        ...scopeOf(fixture),
        userId: stranger.userId as UserId,
      }),
    ).rejects.toMatchObject({ status: 404 });
    // A computer of another account is not an eligible destination.
    await expect(
      service.inspect({
        ...scopeOf(fixture),
        continuationId: randomUUID(),
        request: {
          expectedSourceMachineId: fixture.sourceMachineId as never,
          destinationMachineId: stranger.destinationMachineId as never,
          authorization: { kind: 'bounded_grant', grantId: stranger.grantId },
        },
        controllerBindingSecret: stranger.controllerBindingSecret,
      }),
    ).rejects.toMatchObject({
      response: { code: 'CONTINUATION_DESTINATION_NOT_READY' },
    });
    expect(emitterCalls).toHaveLength(0);
    expect(await bindingOf(fixture)).toBe(fixture.sourceMachineId);
  });

  it('rejects an authorization for a different computer than the inspected destination', async () => {
    const fixture = await createFixture(prisma);
    const other = await createFixture(prisma);
    fixtures.push(fixture, other);
    const continuationId = randomUUID();
    await inspect(fixture, continuationId);
    await expect(
      service.commit({
        ...scopeOf(fixture),
        continuationId,
        request: {
          confirmSavedHistory: false,
          authorization: { kind: 'bounded_grant', grantId: other.grantId },
        },
        controllerBindingSecret: other.controllerBindingSecret,
      }),
    ).rejects.toBeDefined();
    expect(await bindingOf(fixture)).toBe(fixture.sourceMachineId);
  });

  it('refuses to commit when the binding changed after inspection', async () => {
    const fixture = await createFixture(prisma);
    fixtures.push(fixture);
    const continuationId = randomUUID();
    await inspect(fixture, continuationId);
    await prisma.db.agentSession.update({
      where: { id: fixture.sessionId },
      data: { machineId: fixture.destinationMachineId },
    });
    await expect(commit(fixture, continuationId)).rejects.toMatchObject({
      response: { code: 'CONTINUATION_BINDING_CHANGED' },
    });
    const continuation = await prisma.db.agentSessionContinuation.findUnique({
      where: { id: continuationId },
    });
    expect(continuation?.state).toBe('INSPECTED');
  });

  it('rejects reuse of a continuation identity with different input', async () => {
    const fixture = await createFixture(prisma);
    fixtures.push(fixture);
    const continuationId = randomUUID();
    await inspect(fixture, continuationId);
    await expect(
      service.inspect({
        ...scopeOf(fixture),
        continuationId,
        request: {
          expectedSourceMachineId: fixture.sourceMachineId as never,
          destinationMachineId: randomUUID() as never,
          authorization: { kind: 'bounded_grant', grantId: fixture.grantId },
        },
        controllerBindingSecret: fixture.controllerBindingSecret,
      }),
    ).rejects.toMatchObject({
      response: { code: 'CONTINUATION_INPUT_MISMATCH' },
    });
  });
});

/**
 * The launcher's real path over HTTP: `/resolve`, `/prepare`, then the
 * start-run endpoint, through the real controllers, authorization, grant and
 * submission services and PostgreSQL. Only the collaborators outside session
 * admission (conversation lookup, dispatch, workflow engines) are stubbed.
 */
describeDatabase('Starting on a session with no computer, over HTTP', () => {
  let prisma: PrismaService;
  let app: INestApplication;
  let warn: jest.SpyInstance;
  const fixtures: Fixture[] = [];
  const ownerByConversation = new Map<string, string>();

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const parseSecret = ({ secret }: { secret?: string }) =>
      Promise.resolve(secret ? JSON.parse(secret) : null);
    const browserBinding = {
      resolveForAdmission: jest.fn().mockImplementation(parseSecret),
      resolveForSelection: jest.fn().mockImplementation(parseSecret),
    };
    const machinePresence = {
      isPresent: jest.fn().mockResolvedValue(true),
    } as unknown as MachinePresenceService;
    const sessionStubs = {
      resolveStartRunConversationBinding: jest
        .fn()
        .mockResolvedValue({ kind: 'STANDARD_LAUNCH' }),
      resolveStartRunConfiguration: jest.fn().mockResolvedValue(undefined),
      claimStartRunLaunch: jest.fn().mockResolvedValue(true),
      releaseStartRunLaunchClaim: jest.fn().mockResolvedValue(undefined),
    };
    const controllerAuthorization = new ControllerAuthorizationService(
      prisma,
      machinePresence,
      {} as never,
      {} as never,
      browserBinding as never,
      sessionStubs as never,
    );
    const grants = new ExecutionGrantService(
      prisma,
      browserBinding as never,
      {
        resolveDirectInputs: jest
          .fn()
          .mockImplementation(async ({ action }) => action),
      } as never,
    );
    const registry = new AgentOperationRegistryService(prisma);
    const messageService = {
      getMessage: jest.fn().mockResolvedValue(null),
      addMessageInTransaction: (
        tx: Parameters<Parameters<PrismaService['db']['$transaction']>[0]>[0],
        input: CreateMessageInput,
      ) =>
        tx.message.create({
          data: {
            id: input.id,
            projectId: input.projectId,
            conversationId: input.conversationId,
            type: input.type,
            status: 'completed',
            userId: input.userId ?? 'system',
            data: input.data as Prisma.InputJsonValue,
          },
        }),
    };
    const submission = new AgentOperationSubmissionService(
      prisma,
      registry,
      messageService as unknown as MessageServiceToken,
      grants,
      {
        nudgeForOperation: jest.fn().mockResolvedValue(false),
      } as unknown as AgentOperationDispatchService,
      { recordWake: jest.fn() } as never,
      {} as never,
    );
    const conversationService = {
      getConversationFromAdapter: jest
        .fn()
        .mockImplementation(async (_project, id) => ({
          id,
          workflowName: undefined,
        })),
      getOwnerUserId: jest
        .fn()
        .mockImplementation(async (id) => ownerByConversation.get(id)),
    };
    const assertNothing = {
      assertStartRun: jest.fn().mockResolvedValue(undefined),
    };
    const unused = {};

    const moduleRef = await Test.createTestingModule({
      controllers: [ControllerAuthorizationController, ConversationController],
      providers: [
        {
          provide: ControllerAuthorizationService,
          useValue: controllerAuthorization,
        },
        { provide: ControllerBindingCookieService, useValue: {} },
        { provide: ExecutionGrantService, useValue: grants },
        { provide: AgentOperationRegistryService, useValue: registry },
        { provide: AgentOperationSubmissionService, useValue: submission },
        { provide: ConversationService, useValue: conversationService },
        { provide: MessageServiceToken, useValue: messageService },
        { provide: AgentSessionServiceToken, useValue: sessionStubs },
        { provide: ProjectReportLaunchService, useValue: assertNothing },
        { provide: EvalRunService, useValue: assertNothing },
        { provide: ProposalAgentFixService, useValue: assertNothing },
        { provide: ConversationWorkflowService, useValue: unused },
        { provide: WorkflowExecutionService, useValue: unused },
        { provide: NodeExecutionService, useValue: unused },
        { provide: WorkflowRouterService, useValue: unused },
        { provide: FlowExecutionService, useValue: unused },
        { provide: WebsocketConnectionManager, useValue: unused },
        { provide: MachineExecutionReadinessService, useValue: unused },
        { provide: TriggerEmitter, useValue: unused },
        { provide: PendingTriggerService, useValue: unused },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          req.user = { userId: req.headers['x-test-user'] };
          return true;
        },
      })
      .overrideGuard(OrganizationGuard)
      .useValue({
        // The global JWT guard authenticates in production.
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          req.user = { userId: req.headers['x-test-user'] };
          return true;
        },
      })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ControllerBindingOriginGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  beforeEach(() => warn.mockClear());

  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) {
      await deleteFixture(prisma, fixture);
    }
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await prisma.$disconnect();
  });

  const base = (f: Fixture) =>
    `/api/v1/organizations/${f.organizationId}/projects/${f.projectId}`;

  const startBody = (f: Fixture, sessionId = f.sessionId) => ({
    machineId: f.destinationMachineId,
    handlerPromptType: 'free_form',
    payload: {
      promptType: 'free_form',
      userMessage: 'Start from a new launcher',
      entity: { entityType: 'PROJECT', entityId: f.projectId },
    },
    attachments: [],
    stagedBrowserTab: null,
    model: 'claude-opus-5-5',
    provider: 'claude',
    agentSessionId: sessionId,
    contextMetadata: {
      capturedAt: new Date().toISOString(),
      organizationId: f.organizationId,
      projectId: f.projectId,
      agentSessionId: sessionId,
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    },
  });

  const post = (f: Fixture, path: string, asUserId: string, body: object) =>
    request(app.getHttpServer())
      .post(`${base(f)}${path}`)
      .set('x-test-user', asUserId)
      .set(
        'Cookie',
        `hey_hey_controller_binding=${encodeURIComponent(f.controllerBindingSecret)}`,
      )
      .send(body);

  const actionFor = (f: Fixture, sessionId = f.sessionId) => ({
    requestId: randomUUID(),
    actionCategory: HostActionCategory.Conversation,
    actionType: HostAffectingActionType.ConversationTrigger,
    targetKind: HostActionTargetKind.AgentSession,
    targetId: sessionId,
    inputs: startControllerInputs(
      startBody(f, sessionId) as unknown as ConversationStartRunRequestDto,
    ),
  });

  const startRun = (f: Fixture, asUserId: string, sessionId = f.sessionId) => {
    const body = {
      ...startBody(f, sessionId),
      authorization: { kind: 'bounded_grant', grantId: f.grantId },
      operationId: randomUUID(),
    };
    const { authorization: _a, operationId: _o, ...semantic } = body;
    const operationFingerprint = createHash('sha256')
      .update(
        canonicalizeJcs({
          kind: 'START_RUN',
          organizationId: f.organizationId,
          projectId: f.projectId,
          conversationId: f.conversationId,
          request: semantic,
        }),
        'utf8',
      )
      .digest('hex');
    return post(f, `/conversations/${f.conversationId}/start-run`, asUserId, {
      ...body,
      operationFingerprint,
    });
  };

  const boundTo = async (f: Fixture) =>
    (
      await prisma.db.agentSession.findUniqueOrThrow({
        where: { id: f.sessionId },
        select: { machineId: true },
      })
    ).machineId;

  const failedChecks = () =>
    warn.mock.calls
      .map(([, context]) => (context as { failedCheck?: string })?.failedCheck)
      .filter(Boolean);

  const prepared = (f: Fixture) => ({
    machineId: f.destinationMachineId,
    controllerCredentialId: f.machines[1]!.credential.credentialId,
    cadence: ControllerAuthorizationCadence.FIVE_MINUTES,
    action: actionFor(f),
  });

  it('launches an unbound own session through resolve, prepare and start-run, and binds it', async () => {
    const f = await createFixture(prisma);
    fixtures.push(f);
    ownerByConversation.set(f.conversationId, f.userId);
    await prisma.db.agentSession.update({
      where: { id: f.sessionId },
      data: { machineId: null },
    });

    const resolved = await post(
      f,
      '/controller-authorizations/resolve',
      f.userId,
      {
        machineId: f.destinationMachineId,
        action: actionFor(f),
      },
    );
    expect(resolved.status).toBe(200);
    expect(resolved.body).toMatchObject({ outcome: 'ACTIVE_GRANT' });

    const prep = await post(
      f,
      '/controller-authorizations/prepare',
      f.userId,
      prepared(f),
    );
    expect(prep.status).toBe(200);

    const started = await startRun(f, f.userId);
    expect(started.status).toBeLessThan(300);
    expect(started.body).toMatchObject({ dispatched: true });
    expect(await boundTo(f)).toBe(f.destinationMachineId);
    expect(failedChecks()).toEqual([]);
  });

  it('refuses a session bound to another computer with 403 TARGET_MISMATCH at resolve and start-run', async () => {
    const f = await createFixture(prisma);
    fixtures.push(f);
    ownerByConversation.set(f.conversationId, f.userId);

    const resolved = await post(
      f,
      '/controller-authorizations/resolve',
      f.userId,
      {
        machineId: f.destinationMachineId,
        action: actionFor(f),
      },
    );
    expect(resolved.status).toBe(403);
    expect(resolved.body.message).toBe('TARGET_MISMATCH');

    const started = await startRun(f, f.userId);
    expect(started.status).toBe(403);
    expect(started.body.message).toBe('TARGET_MISMATCH');
    expect(failedChecks()).toEqual([
      'agent_session_bound_elsewhere',
      'agent_session_bound_elsewhere',
    ]);
    expect(await boundTo(f)).toBe(f.sourceMachineId);
  });

  it('refuses a session owned by another user with 403 TARGET_MISMATCH at resolve and start-run', async () => {
    const f = await createFixture(prisma);
    const stranger = await createFixture(prisma);
    fixtures.push(f, stranger);
    ownerByConversation.set(stranger.conversationId, stranger.userId);
    const foreign = await createForeignOwnedSession(prisma, stranger, f.userId);

    try {
      const resolved = await post(
        stranger,
        '/controller-authorizations/resolve',
        stranger.userId,
        {
          machineId: stranger.destinationMachineId,
          action: actionFor(stranger, foreign.id),
        },
      );
      expect(resolved.status).toBe(403);
      expect(resolved.body.message).toBe('TARGET_MISMATCH');

      const started = await startRun(stranger, stranger.userId, foreign.id);
      expect(started.status).toBe(403);
      expect(started.body.message).toBe('TARGET_MISMATCH');
      expect(failedChecks()).toEqual([
        'agent_session_not_owned',
        'agent_session_not_owned',
      ]);
      expect(
        (
          await prisma.db.agentSession.findUniqueOrThrow({
            where: { id: foreign.id },
          })
        ).machineId,
      ).toBeNull();
    } finally {
      await prisma.db.agentOperation.deleteMany({
        where: { agentSessionId: foreign.id },
      });
      await prisma.db.agentSession.deleteMany({ where: { id: foreign.id } });
    }
  });
});

/** A session in `host`'s own conversation that belongs to a different user. */
function createForeignOwnedSession(
  prisma: PrismaService,
  host: Fixture,
  ownerUserId: string,
) {
  return prisma.db.agentSession.create({
    data: {
      id: randomUUID(),
      organizationId: host.organizationId,
      userId: ownerUserId,
      projectId: host.projectId,
      conversationId: host.conversationId,
      machineId: null,
      provider: 'claude',
      status: 'IN_PROGRESS',
      sessionDate: new Date(),
      title: 'Someone else’s session',
    },
  });
}

async function createMachine(
  prisma: PrismaService,
  owner: { userId: string; organizationId: string },
  revokedAt: Date | null,
) {
  const enrollment = await prisma.db.pendingMachineEnrollment.create({
    data: {
      id: randomUUID(),
      machineId: randomUUID(),
      machinePublicKey: 'continuation-machine-public-key',
      machinePublicKeyFingerprint: 'a'.repeat(64),
      machineName: 'continuation-machine',
      osFamily: 'macos',
      cliVersion: '2.2.2',
      authorizationProtocolVersion: 2,
      userCodeHmac: randomBytes(32).toString('hex'),
      deviceSecretDigest: randomBytes(32).toString('hex'),
      state: 'ACTIVE',
      expiresAt: new Date(Date.now() + 300_000),
      claimantUserId: owner.userId,
      claimantOrganizationId: owner.organizationId,
      controllerLabel: 'Continuation controller',
    },
  });
  const machine = await prisma.db.machine.create({
    data: {
      id: enrollment.machineId,
      userId: owner.userId,
      organizationId: owner.organizationId,
      name: 'continuation-machine',
      publicKey: 'continuation-machine-public-key',
      tokenHash: randomBytes(32).toString('hex'),
      authorizationProtocolVersion: 2,
      authorizationState: 'READY',
      revokedAt,
    },
  });
  const credential = await prisma.db.machineControllerCredential.create({
    data: {
      id: randomUUID(),
      machineId: machine.id,
      userId: owner.userId,
      organizationId: owner.organizationId,
      credentialId: `credential-${randomUUID()}`,
      credentialPublicKeyX: Buffer.alloc(32, 1),
      credentialPublicKeyY: Buffer.alloc(32, 2),
      credentialTransports: ['internal'],
      credentialSignCount: 0,
      credentialBackupEligible: true,
      credentialBackupState: false,
      controllerLabel: 'Continuation controller',
      credentialFingerprint: randomBytes(32).toString('hex'),
      enrollmentId: enrollment.id,
      controllerInstallationId: enrollment.id,
    },
  });
  return { machine, credential, enrollment };
}

async function createFixture(
  prisma: PrismaService,
  options: { sourceRevoked?: boolean } = {},
) {
  const user = await prisma.db.user.create({
    data: {
      id: randomUUID(),
      email: `continuation-${randomUUID()}@example.com`,
      name: 'Continuation User',
      passwordHash: 'integration-test-password-hash',
    },
  });
  const organization = await prisma.db.organization.create({
    data: {
      id: randomUUID(),
      name: `Continuation ${randomUUID()}`,
      slug: `continuation-${randomUUID()}`,
    },
  });
  await prisma.db.organizationMember.create({
    data: { userId: user.id, organizationId: organization.id },
  });
  const project = await prisma.db.project.create({
    data: {
      id: randomUUID(),
      organizationId: organization.id,
      name: 'Continuation Project',
      status: 'ACTIVE',
    },
  });
  const conversation = await prisma.db.conversation.create({
    data: {
      id: randomUUID(),
      organizationId: organization.id,
      projectId: project.id,
      title: 'Continuation Conversation',
      initiatedBy: 'USER',
      status: 'STARTED',
    },
  });
  const owner = { userId: user.id, organizationId: organization.id };
  const source = await createMachine(
    prisma,
    owner,
    options.sourceRevoked === false ? null : new Date(),
  );
  const destination = await createMachine(prisma, owner, null);
  const session = await prisma.db.agentSession.create({
    data: {
      id: randomUUID(),
      organizationId: organization.id,
      userId: user.id,
      projectId: project.id,
      conversationId: conversation.id,
      machineId: source.machine.id,
      provider: 'claude',
      status: 'IN_PROGRESS',
      sessionDate: new Date(),
      title: 'Continuation Session',
    },
  });

  // The session's original launch, as the start-run endpoint records it.
  const originalOperationId = randomUUID();
  const originalTriggerId = randomUUID();
  await prisma.db.message.create({
    data: {
      id: originalTriggerId,
      projectId: project.id,
      conversationId: conversation.id,
      type: 'SYSTEM',
      status: 'completed',
      userId: 'system',
      data: {
        type: 'AGENT',
        triggersAgent: {
          promptType: 'start_run',
          operationId: originalOperationId,
          operationFingerprint: '3'.repeat(64),
          triggerMessageId: originalTriggerId,
          payload: {
            handlerPromptType: 'free_form',
            payload: {
              promptType: 'free_form',
              userMessage: 'Original ask',
              entity: { entityType: 'PROJECT', entityId: project.id },
            },
            attachments: [
              { attachmentId: randomUUID(), fileName: 'notes.txt' },
            ],
            stagedBrowserTab: null,
            model: 'claude-opus-5-5',
            provider: 'claude',
            agentSessionId: session.id,
            contextMetadata: {
              capturedAt: new Date().toISOString(),
              organizationId: organization.id,
              projectId: project.id,
              agentSessionId: session.id,
              userComments: [],
              fileReferences: { resolved: [], unresolved: [] },
            },
          },
        },
      },
    },
  });
  await prisma.db.agentOperation.create({
    data: {
      operationId: originalOperationId,
      organizationId: organization.id,
      projectId: project.id,
      userId: user.id,
      agentSessionId: session.id,
      conversationId: conversation.id,
      kind: 'START_RUN',
      fingerprint: '3'.repeat(64),
      state: 'SUCCEEDED',
      triggerMessageId: originalTriggerId,
      terminalAt: new Date(),
    },
  });

  // A reusable controller-device window for the destination only.
  const issuedAt = new Date();
  const authorizationId = randomUUID();
  const grantDescriptorHash = 'e'.repeat(64);
  await prisma.db.executionAuthorization.create({
    data: {
      id: authorizationId,
      requestId: randomUUID(),
      canonicalIntent: '{}',
      webauthnChallenge: randomBytes(32).toString('base64url'),
      controllerCredentialId: destination.credential.id,
      controllerInstallationId: destination.enrollment.id,
      machineId: destination.machine.id,
      userId: user.id,
      organizationId: organization.id,
      projectId: project.id,
      cadence: ControllerAuthorizationCadence.FIVE_MINUTES,
      policyRevision: CONTROLLER_DEVICE_POLICY_REVISION,
      grantDescriptorHash,
      actionCategory: PrismaHostActionCategory.CLI_READ,
      actionType: PrismaHostAffectingActionType.CLI_READ,
      actionPayloadHash: 'f'.repeat(64),
      targetKind: PrismaHostActionTargetKind.CLI_READ,
      targetId: destination.machine.id,
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
      controllerCredentialId: destination.credential.id,
      controllerInstallationId: destination.enrollment.id,
      machineId: destination.machine.id,
      userId: user.id,
      organizationId: organization.id,
      projectId: project.id,
      cadence: ControllerAuthorizationCadence.FIVE_MINUTES,
      policyRevision: CONTROLLER_DEVICE_POLICY_REVISION,
      grantDescriptorHash,
      targetKind: PrismaHostActionTargetKind.CLI_READ,
      targetId: destination.machine.id,
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
    sourceMachineId: source.machine.id,
    destinationMachineId: destination.machine.id,
    machines: [source, destination],
    authorizationId,
    grantId: grant.id,
    controllerBindingSecret: JSON.stringify({
      controllerInstallationId: destination.enrollment.id,
      controllerCredentialId: destination.credential.id,
      controllerCredentialPublicId: destination.credential.credentialId,
      machineId: destination.machine.id,
      userId: user.id,
      organizationId: organization.id,
      expiresAt: grant.expiresAt,
    }),
  };
}

async function deleteFixture(prisma: PrismaService, fixture: Fixture) {
  await prisma.db.message.updateMany({
    where: { conversationId: fixture.conversationId },
    data: { executionOperationId: null },
  });
  await prisma.db.agentOperation.deleteMany({
    where: { agentSessionId: fixture.sessionId },
  });
  await prisma.db.message.deleteMany({
    where: { conversationId: fixture.conversationId },
  });
  await prisma.db.executionGrant.deleteMany({
    where: { userId: fixture.userId },
  });
  await prisma.db.executionAuthorization.deleteMany({
    where: { userId: fixture.userId },
  });
  await prisma.db.agentSession.deleteMany({ where: { id: fixture.sessionId } });
  await prisma.db.conversation.deleteMany({
    where: { id: fixture.conversationId },
  });
  for (const { machine, credential, enrollment } of fixture.machines) {
    await prisma.db.machineControllerCredential.deleteMany({
      where: { id: credential.id },
    });
    await prisma.db.machine.deleteMany({ where: { id: machine.id } });
    await prisma.db.pendingMachineEnrollment.deleteMany({
      where: { id: enrollment.id },
    });
  }
  await prisma.db.project.deleteMany({ where: { id: fixture.projectId } });
  await prisma.db.organizationMember.deleteMany({
    where: { organizationId: fixture.organizationId },
  });
  await prisma.db.organization.deleteMany({
    where: { id: fixture.organizationId },
  });
  await prisma.db.user.deleteMany({ where: { id: fixture.userId } });
}
