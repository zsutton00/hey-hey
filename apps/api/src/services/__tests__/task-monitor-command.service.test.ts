import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TaskMonitorCommandService } from '../task-monitor-command.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TriggerEmitter } from '../../core/websockets/trigger-emitter.service';
import { TaskMonitorJudgmentResponseService } from '../task-monitor-judgment-response.service';
import { ExecutionGrantService } from '../controller-authorization/execution-grant.service';
import { Prisma } from '@prisma/client';
import type {
  MachineId,
  MessageId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from '../../types';

const ids = {
  organizationId: '10000000-0000-4000-8000-000000000001' as OrganizationId,
  projectId: '20000000-0000-4000-8000-000000000002' as ProjectId,
  monitorId: '30000000-0000-4000-8000-000000000003' as TaskId,
  selectedTaskId: '90000000-0000-4000-8000-000000000009' as TaskId,
  userId: '40000000-0000-4000-8000-000000000004' as UserId,
  machineId: '50000000-0000-4000-8000-000000000005' as MachineId,
  requestId: '60000000-0000-4000-8000-000000000006',
  authorizationId: '61000000-0000-4000-8000-000000000006',
  commandId: '70000000-0000-4000-8000-000000000007',
  judgmentMessageId: '80000000-0000-4000-8000-000000000008' as MessageId,
};

const request = () => ({
  requestId: ids.requestId,
  authorization: { kind: 'bounded_grant' as const, grantId: 'grant-id' },
  machineId: ids.machineId,
  command: {
    cause: 'START' as const,
    launchConfig: {
      taskId: ids.selectedTaskId,
      method: 'quick' as const,
      provider: 'codex' as const,
      model: 'gpt-5.4',
      reasoningEffort: 'high' as const,
    },
  },
});

const judgmentRequest = () => ({
  requestId: ids.judgmentMessageId,
  authorization: { kind: 'bounded_grant' as const, grantId: 'grant-id' },
  machineId: ids.machineId,
  command: {
    cause: 'JUDGMENT_RESOLVED' as const,
    judgment: {
      requestMessageId: ids.judgmentMessageId,
      label: 'Your judgment',
      conclusion: 'Proceed with the safer behavior.',
    },
  },
});

const humanDecisionRequest = () => ({
  requestId: ids.requestId,
  machineId: ids.machineId,
  command: {
    cause: 'HUMAN_DECISION' as const,
    interventionId: 'a0000000-0000-4000-8000-000000000001',
    providerActionId: 'provider-action-1',
    runId: 'a0000000-0000-4000-8000-000000000002',
    agentSessionId: 'a0000000-0000-4000-8000-000000000003',
    fingerprint: 'immutable-fingerprint',
    resolution: 'APPROVE' as const,
  },
});

const createHarness = () => {
  const db = {
    monitorCommand: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
    },
    task: { findFirst: jest.fn() },
    machine: { findFirst: jest.fn() },
  };
  const triggerEmitter = {
    deliverMonitorCommand: jest.fn(),
  };
  const judgmentResponseService = {
    validateRequest: jest.fn(),
    prepareAndEnsureResponse: jest.fn(),
    ensureResponse: jest.fn(),
  };
  const executionGrantService = {
    admitTaskMonitorCommand: jest.fn().mockResolvedValue({
      grant: { id: 'grant-id', authorizationId: ids.authorizationId },
      machineId: ids.machineId,
    }),
    reduceTaskMonitorAuthority: jest.fn().mockResolvedValue(undefined),
  };
  const service = new TaskMonitorCommandService(
    { db } as unknown as PrismaService,
    triggerEmitter as unknown as TriggerEmitter,
    judgmentResponseService as unknown as TaskMonitorJudgmentResponseService,
    executionGrantService as unknown as ExecutionGrantService,
  );
  return {
    service,
    db,
    triggerEmitter,
    judgmentResponseService,
    executionGrantService,
  };
};

describe('TaskMonitorCommandService', () => {
  it('authorizes and persists the complete command before delivery', async () => {
    const harness = createHarness();
    harness.db.monitorCommand.findUnique.mockResolvedValue(null);
    harness.db.task.findFirst.mockResolvedValue({ id: ids.monitorId });
    harness.db.machine.findFirst.mockResolvedValue({ id: ids.machineId });
    harness.db.monitorCommand.create.mockResolvedValue({ id: ids.commandId });
    harness.triggerEmitter.deliverMonitorCommand.mockResolvedValue({
      commandId: ids.commandId,
      status: 'ADMITTED',
      replayed: false,
    });

    const outcome = await harness.service.submit({
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      monitorId: ids.monitorId,
      userId: ids.userId,
      request: request(),
    });

    expect(harness.db.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: ids.monitorId,
        organizationId: ids.organizationId,
        projectId: ids.projectId,
        type: 'TASK_MONITOR',
        archivedAt: null,
      },
      select: { id: true },
    });
    expect(harness.db.machine.findFirst).not.toHaveBeenCalled();
    expect(
      harness.executionGrantService.admitTaskMonitorCommand,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization: request().authorization,
        machineId: ids.machineId,
      }),
    );
    expect(harness.db.monitorCommand.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestId: ids.requestId,
        organizationId: ids.organizationId,
        projectId: ids.projectId,
        monitorId: ids.monitorId,
        userId: ids.userId,
        machineId: ids.machineId,
        body: expect.objectContaining({
          version: 1,
          kind: 'task_monitor_command',
          organizationId: ids.organizationId,
          projectId: ids.projectId,
          target: {
            workItemType: 'TASK_MONITOR',
            workItemId: ids.monitorId,
          },
          command: request().command,
        }),
      }),
    });
    const persistedOrder =
      harness.db.monitorCommand.create.mock.invocationCallOrder.at(0);
    const deliveredOrder =
      harness.triggerEmitter.deliverMonitorCommand.mock.invocationCallOrder.at(
        0,
      );
    if (persistedOrder === undefined || deliveredOrder === undefined) {
      throw new Error('Expected command persistence and delivery calls.');
    }
    expect(persistedOrder).toBeLessThan(deliveredOrder);
    expect(outcome.status).toBe('ADMITTED');
  });

  it('reuses a durable command for an identical HTTP retry', async () => {
    const harness = createHarness();
    harness.db.monitorCommand.findUnique.mockResolvedValue({
      id: ids.commandId,
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      monitorId: ids.monitorId,
      userId: ids.userId,
      machineId: ids.machineId,
      authorizationId: ids.authorizationId,
      authorization: request().authorization,
      body: { command: request().command },
    });
    harness.triggerEmitter.deliverMonitorCommand.mockResolvedValue({
      commandId: ids.commandId,
      status: 'QUEUED',
    });

    const outcome = await harness.service.submit({
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      monitorId: ids.monitorId,
      userId: ids.userId,
      request: request(),
    });

    expect(outcome).toEqual({ commandId: ids.commandId, status: 'QUEUED' });
    expect(harness.db.monitorCommand.create).not.toHaveBeenCalled();
    expect(harness.db.task.findFirst).not.toHaveBeenCalled();
  });

  it('stamps authenticated human evidence on a neutral decision without changing controller authority', async () => {
    const harness = createHarness();
    harness.db.monitorCommand.findUnique.mockResolvedValue(null);
    harness.db.task.findFirst.mockResolvedValue({ id: ids.monitorId });
    harness.db.machine.findFirst.mockResolvedValue({ id: ids.machineId });
    harness.db.monitorCommand.create.mockResolvedValue({ id: ids.commandId });
    harness.triggerEmitter.deliverMonitorCommand.mockResolvedValue({
      commandId: ids.commandId,
      status: 'ADMITTED',
      replayed: false,
    });

    await harness.service.submit({
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      monitorId: ids.monitorId,
      userId: ids.userId,
      request: humanDecisionRequest(),
    });

    expect(
      harness.executionGrantService.admitTaskMonitorCommand,
    ).not.toHaveBeenCalled();
    expect(
      harness.executionGrantService.reduceTaskMonitorAuthority,
    ).not.toHaveBeenCalled();
    expect(harness.db.monitorCommand.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        authorizationId: undefined,
        authorization: undefined,
        body: expect.objectContaining({
          command: {
            ...humanDecisionRequest().command,
            human: {
              userId: ids.userId,
              authenticatedAt: expect.any(String),
            },
          },
        }),
      }),
    });
  });

  it('reuses a neutral human decision despite server-stamped authentication time', async () => {
    const harness = createHarness();
    harness.db.monitorCommand.findUnique.mockResolvedValue({
      id: ids.commandId,
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      monitorId: ids.monitorId,
      userId: ids.userId,
      machineId: ids.machineId,
      authorizationId: null,
      authorization: null,
      body: {
        command: {
          ...humanDecisionRequest().command,
          human: {
            userId: ids.userId,
            authenticatedAt: '2026-08-25T12:00:00.000Z',
          },
        },
      },
    });
    harness.triggerEmitter.deliverMonitorCommand.mockResolvedValue({
      commandId: ids.commandId,
      status: 'QUEUED',
    });

    const outcome = await harness.service.submit({
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      monitorId: ids.monitorId,
      userId: ids.userId,
      request: humanDecisionRequest(),
    });

    expect(outcome).toEqual({ commandId: ids.commandId, status: 'QUEUED' });
    expect(harness.db.monitorCommand.create).not.toHaveBeenCalled();
    expect(
      harness.executionGrantService.admitTaskMonitorCommand,
    ).not.toHaveBeenCalled();
    expect(
      harness.executionGrantService.reduceTaskMonitorAuthority,
    ).not.toHaveBeenCalled();
  });

  it('rejects reuse of a request identity for different command input', async () => {
    const harness = createHarness();
    harness.db.monitorCommand.findUnique.mockResolvedValue({
      id: ids.commandId,
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      monitorId: ids.monitorId,
      userId: ids.userId,
      machineId: ids.machineId,
      authorizationId: ids.authorizationId,
      authorization: request().authorization,
      body: { command: { cause: 'STOP' } },
    });

    await expect(
      harness.service.submit({
        organizationId: ids.organizationId,
        projectId: ids.projectId,
        monitorId: ids.monitorId,
        userId: ids.userId,
        request: request(),
      }),
    ).rejects.toThrow(BadRequestException);
    expect(harness.triggerEmitter.deliverMonitorCommand).not.toHaveBeenCalled();
  });

  it('rejects a missing Task Monitor before command persistence', async () => {
    const harness = createHarness();
    harness.db.monitorCommand.findUnique.mockResolvedValue(null);
    harness.db.task.findFirst.mockResolvedValue(null);

    await expect(
      harness.service.submit({
        organizationId: ids.organizationId,
        projectId: ids.projectId,
        monitorId: ids.monitorId,
        userId: ids.userId,
        request: request(),
      }),
    ).rejects.toThrow(NotFoundException);
    expect(harness.db.monitorCommand.create).not.toHaveBeenCalled();
    expect(harness.triggerEmitter.deliverMonitorCommand).not.toHaveBeenCalled();
  });

  it('rejects a machine not owned by the acting user', async () => {
    const harness = createHarness();
    harness.db.monitorCommand.findUnique.mockResolvedValue(null);
    harness.db.task.findFirst.mockResolvedValue({ id: ids.monitorId });
    harness.executionGrantService.admitTaskMonitorCommand.mockRejectedValue(
      new ForbiddenException('machine mismatch'),
    );

    await expect(
      harness.service.submit({
        organizationId: ids.organizationId,
        projectId: ids.projectId,
        monitorId: ids.monitorId,
        userId: ids.userId,
        request: request(),
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(harness.db.monitorCommand.create).not.toHaveBeenCalled();
  });

  it('validates a fresh judgment before receipt creation and ensures its response before delivery', async () => {
    const harness = createHarness();
    harness.db.monitorCommand.findUnique.mockResolvedValue(null);
    harness.db.task.findFirst.mockResolvedValue({ id: ids.monitorId });
    harness.db.machine.findFirst.mockResolvedValue({ id: ids.machineId });
    const context = { command: judgmentRequest().command };
    harness.judgmentResponseService.validateRequest.mockResolvedValue(context);
    harness.db.monitorCommand.create.mockResolvedValue({ id: ids.commandId });
    harness.judgmentResponseService.ensureResponse.mockResolvedValue(undefined);
    harness.triggerEmitter.deliverMonitorCommand.mockResolvedValue({
      commandId: ids.commandId,
      status: 'ADMITTED',
      replayed: false,
    });

    await harness.service.submit({
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      monitorId: ids.monitorId,
      userId: ids.userId,
      request: judgmentRequest(),
    });

    expect(
      harness.judgmentResponseService.validateRequest,
    ).toHaveBeenCalledWith({
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      monitorId: ids.monitorId,
      userId: ids.userId,
      command: judgmentRequest().command,
    });
    const validatedOrder =
      harness.judgmentResponseService.validateRequest.mock.invocationCallOrder.at(
        0,
      );
    const commandOrder =
      harness.db.monitorCommand.create.mock.invocationCallOrder.at(0);
    const responseOrder =
      harness.judgmentResponseService.ensureResponse.mock.invocationCallOrder.at(
        0,
      );
    const deliveryOrder =
      harness.triggerEmitter.deliverMonitorCommand.mock.invocationCallOrder.at(
        0,
      );
    if (
      validatedOrder === undefined ||
      commandOrder === undefined ||
      responseOrder === undefined ||
      deliveryOrder === undefined
    ) {
      throw new Error(
        'Expected validation, command, response, and delivery calls.',
      );
    }
    expect(validatedOrder).toBeLessThan(commandOrder);
    expect(commandOrder).toBeLessThan(responseOrder);
    expect(responseOrder).toBeLessThan(deliveryOrder);
  });

  it('revalidates and repairs a stored judgment retry before delivery', async () => {
    const harness = createHarness();
    harness.db.monitorCommand.findUnique.mockResolvedValue({
      id: ids.commandId,
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      monitorId: ids.monitorId,
      userId: ids.userId,
      machineId: ids.machineId,
      authorizationId: ids.authorizationId,
      authorization: judgmentRequest().authorization,
      body: { command: judgmentRequest().command },
    });
    harness.judgmentResponseService.prepareAndEnsureResponse.mockResolvedValue(
      undefined,
    );
    harness.triggerEmitter.deliverMonitorCommand.mockResolvedValue({
      commandId: ids.commandId,
      status: 'ADMITTED',
      replayed: true,
    });

    await harness.service.submit({
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      monitorId: ids.monitorId,
      userId: ids.userId,
      request: judgmentRequest(),
    });

    expect(
      harness.judgmentResponseService.prepareAndEnsureResponse,
    ).toHaveBeenCalledWith({
      commandId: ids.commandId,
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      monitorId: ids.monitorId,
      userId: ids.userId,
      command: judgmentRequest().command,
    });
    expect(harness.db.monitorCommand.create).not.toHaveBeenCalled();
    const preparationOrder =
      harness.judgmentResponseService.prepareAndEnsureResponse.mock
        .invocationCallOrder[0];
    const deliveryOrder =
      harness.triggerEmitter.deliverMonitorCommand.mock.invocationCallOrder[0];
    if (preparationOrder === undefined || deliveryOrder === undefined) {
      throw new Error('Expected response preparation and delivery calls.');
    }
    expect(preparationOrder).toBeLessThan(deliveryOrder);
  });

  it('revalidates a judgment after a receipt uniqueness race', async () => {
    const harness = createHarness();
    harness.db.monitorCommand.findUnique.mockResolvedValue(null);
    harness.db.task.findFirst.mockResolvedValue({ id: ids.monitorId });
    harness.db.machine.findFirst.mockResolvedValue({ id: ids.machineId });
    harness.judgmentResponseService.validateRequest.mockResolvedValue({
      command: judgmentRequest().command,
    });
    harness.db.monitorCommand.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate receipt', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    harness.db.monitorCommand.findUniqueOrThrow.mockResolvedValue({
      id: ids.commandId,
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      monitorId: ids.monitorId,
      userId: ids.userId,
      machineId: ids.machineId,
      authorizationId: ids.authorizationId,
      authorization: judgmentRequest().authorization,
      body: { command: judgmentRequest().command },
    });
    harness.judgmentResponseService.prepareAndEnsureResponse.mockResolvedValue(
      undefined,
    );
    harness.triggerEmitter.deliverMonitorCommand.mockResolvedValue({
      commandId: ids.commandId,
      status: 'ADMITTED',
      replayed: true,
    });

    await harness.service.submit({
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      monitorId: ids.monitorId,
      userId: ids.userId,
      request: judgmentRequest(),
    });

    expect(
      harness.judgmentResponseService.validateRequest,
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.judgmentResponseService.prepareAndEnsureResponse,
    ).toHaveBeenCalledTimes(1);
    expect(harness.triggerEmitter.deliverMonitorCommand).toHaveBeenCalledWith(
      ids.commandId,
    );
  });

  it('bypasses judgment preparation for non-judgment commands', async () => {
    const harness = createHarness();
    harness.db.monitorCommand.findUnique.mockResolvedValue(null);
    harness.db.task.findFirst.mockResolvedValue({ id: ids.monitorId });
    harness.db.machine.findFirst.mockResolvedValue({ id: ids.machineId });
    harness.db.monitorCommand.create.mockResolvedValue({ id: ids.commandId });
    harness.triggerEmitter.deliverMonitorCommand.mockResolvedValue({
      commandId: ids.commandId,
      status: 'ADMITTED',
      replayed: false,
    });

    await harness.service.submit({
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      monitorId: ids.monitorId,
      userId: ids.userId,
      request: request(),
    });

    expect(
      harness.judgmentResponseService.validateRequest,
    ).not.toHaveBeenCalled();
    expect(
      harness.judgmentResponseService.prepareAndEnsureResponse,
    ).not.toHaveBeenCalled();
    expect(
      harness.judgmentResponseService.ensureResponse,
    ).not.toHaveBeenCalled();
  });
});
