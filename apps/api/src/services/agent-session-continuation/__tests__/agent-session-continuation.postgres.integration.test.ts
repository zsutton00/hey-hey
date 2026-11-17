import { Logger } from '@nestjs/common';
import {
  ControllerAuthorizationCadence,
  ExecutionAuthorizationOutcome,
  ExecutionGrantScope,
  HostActionCategory as PrismaHostActionCategory,
  HostActionTargetKind as PrismaHostActionTargetKind,
  HostAffectingActionType as PrismaHostAffectingActionType,
  Prisma,
} from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import type {
  AgentSessionContinuationNativeState,
  AgentSessionContinuationStartupReport,
  CliReadResponseDto,
  StartRunPromptPayload,
  SystemMessageData,
} from '@hey-hey/contracts/api/models';
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

  const commit = (
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
    const grants = new ExecutionGrantService(
      prisma,
      {
        resolveForAdmission: jest
          .fn()
          .mockImplementation(({ secret }) =>
            Promise.resolve(secret ? JSON.parse(secret) : null),
          ),
      } as never,
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
    const submission = new AgentOperationSubmissionService(
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
      new MachineExecutionReadinessService(prisma, {
        isPresent: jest.fn().mockResolvedValue(true),
      } as unknown as MachinePresenceService),
      registry,
      submission,
      {
        resolveStartRunConfiguration: jest.fn().mockResolvedValue(undefined),
      } as unknown as AgentSessionService,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  beforeEach(() => {
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
    await expect(commit(fixture, continuationId, true)).rejects.toMatchObject({
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
            payload: { promptType: 'free_form', userMessage: 'Original ask' },
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
