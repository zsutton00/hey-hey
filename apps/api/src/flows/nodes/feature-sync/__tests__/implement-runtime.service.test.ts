import { ModuleRef } from '@nestjs/core';
import { v5 as uuidv5 } from 'uuid';
import { PrismaService } from 'src/prisma/prisma.service';
import { MessageService } from 'src/services/message.service';
import { AgentSessionService } from 'src/services/agent-session.service';
import { AgentOperationDispatchService } from 'src/core/websockets/agent-operation-dispatch.service';
import { FeatureSyncFlowContext } from 'src/types/flow-internal.types';
import { ImplementRuntimeService } from '../implement-runtime.service';
import { FeatureSyncImplementNode } from '../implement.node';
import { createMutableContextHandle } from 'src/utils/mutable-context';

const approvalId = '20000000-0000-4000-8000-000000000002';
const replacementId = uuidv5('implement-runtime-replacement', approvalId);

function setup(provider = 'claude', outcome = 'SUCCEEDED') {
  const events: string[] = [];
  const parent = {
    operationId: approvalId,
    kind: 'WORKFLOW_ANSWER',
    state: 'ROUTING_PENDING',
    conversationId: 'conversation',
    organizationId: 'organization',
    projectId: 'project',
    agentSessionId: 'session',
    userId: 'user',
    messageId: 'answer',
    authorizationId: 'authorization',
    authorizationKind: 'BOUNDED_GRANT',
    grantId: 'grant',
  };
  let replacement: any = null;
  const operation = {
    findUnique: jest.fn(async ({ where }: any) =>
      where.operationId === approvalId ? parent : replacement,
    ),
    findFirst: jest.fn(async () => ({ triggerMessageId: 'launch' })),
    create: jest.fn(async ({ data }: any) => {
      replacement = data;
      events.push('operation-created');
      return data;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (where.operationId === replacementId && data.triggerMessageId) {
        replacement.triggerMessageId = data.triggerMessageId;
        events.push('trigger-bound');
      }
      return { count: 1 };
    }),
  };
  const prisma: any = {
    db: {
      agentOperation: operation,
      executionGrant: {
        findUnique: jest.fn(async () => ({
          machineId: 'machine',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        })),
      },
      agentOperationDispatch: {
        create: jest.fn(async () => {
          events.push('dispatch-created');
          return {};
        }),
      },
      $executeRaw: jest.fn(),
      $transaction: jest.fn(async (callback: any) => callback(prisma.db)),
    },
  };
  const sessions = Object.create(
    AgentSessionService.prototype,
  ) as AgentSessionService;
  jest.spyOn(sessions, 'findOne').mockResolvedValue({
    provider,
    config: {
      type: 'CODING_SESSION',
      version: 'v2',
      model: 'planning',
      effort: 'high',
      fastMode: true,
    },
  } as any);
  jest.spyOn(sessions, 'update').mockImplementation(async () => {
    events.push('stored');
    return {} as any;
  });
  const messages = Object.create(MessageService.prototype) as MessageService;
  jest.spyOn(messages, 'getMessage').mockResolvedValue({
    type: 'SYSTEM',
    data: {
      triggersAgent: {
        promptType: 'start_run',
        payload: {
          workflowName: 'feature-sync',
          provider: 'claude',
          model: 'planning',
          reasoningEffort: 'high',
          agentSessionId: 'session',
          contextMetadata: { agentSessionId: 'session' },
          payload: {
            promptType: 'workflow_kickoff',
            entity: { entityType: 'TASK', entityId: 'task' },
          },
          serviceIds: ['service'],
          launchServiceId: 'service',
        },
      },
    },
  } as any);
  jest
    .spyOn(messages, 'addMessageInTransaction')
    .mockImplementation(async () => {
      events.push('message-created');
      return {} as any;
    });
  const dispatch = Object.create(
    AgentOperationDispatchService.prototype,
  ) as AgentOperationDispatchService;
  jest.spyOn(dispatch, 'nudgeForOperation').mockImplementation(async () => {
    events.push('accepted');
    replacement.state = outcome;
    return true;
  });
  const providers = new Map<any, any>([
    [AgentSessionService, sessions],
    [MessageService, messages],
    [AgentOperationDispatchService, dispatch],
  ]);
  const modules = { get: (type: any) => providers.get(type) } as ModuleRef;
  const service = new ImplementRuntimeService(
    prisma as unknown as PrismaService,
    modules,
  );
  const context = {
    core: {
      organizationId: 'organization',
      projectId: 'project',
      conversationId: 'conversation',
    },
    implementApprovalOperationId: approvalId,
    implementRuntime: {
      provider: 'codex',
      model: 'gpt-6.1-sol',
      reasoningEffort: 'low',
      fastMode: false,
    },
  } as FeatureSyncFlowContext;
  return {
    service,
    context,
    prisma,
    sessions,
    messages,
    events,
    operation,
    parent,
  };
}

describe('approval implementation runtime', () => {
  it('preserves current behavior when no selection is supplied', async () => {
    const subject = setup();
    delete subject.context.implementRuntime;
    const trigger = await new FeatureSyncImplementNode(
      subject.service,
    ).buildTriggerMessage(createMutableContextHandle(subject.context));
    expect(trigger.triggersAgent).toEqual({
      promptType: 'implement',
      nodeId: 'feature-sync-implement',
    });
    expect(subject.operation.findUnique).not.toHaveBeenCalled();
  });

  it('retains the existing Run and carries every same-provider override, including false', async () => {
    const subject = setup('codex');
    const trigger = await new FeatureSyncImplementNode(
      subject.service,
    ).buildTriggerMessage(createMutableContextHandle(subject.context));
    expect(trigger.triggersAgent).toMatchObject({
      payload: { runtime: subject.context.implementRuntime },
    });
    expect(subject.operation.create).not.toHaveBeenCalled();
  });

  it('accepts a distinct replacement before storing runtime and emitting implementation', async () => {
    const subject = setup();
    const trigger = await new FeatureSyncImplementNode(
      subject.service,
    ).buildTriggerMessage(createMutableContextHandle(subject.context));
    expect(subject.events).toEqual([
      'operation-created',
      'message-created',
      'trigger-bound',
      'dispatch-created',
      'accepted',
      'stored',
    ]);
    expect(trigger.triggersAgent).toMatchObject({
      payload: { runtime: subject.context.implementRuntime },
    });
    const written = jest.mocked(subject.messages.addMessageInTransaction).mock
      .calls[0]![1];
    expect(written.data.triggersAgent).toMatchObject({
      promptType: 'start_run',
      payload: {
        runId: replacementId,
        agentSessionId: 'session',
        workflowName: 'feature-sync',
        provider: 'codex',
        fastMode: false,
        payload: { entity: { entityType: 'TASK', entityId: 'task' } },
      },
    });
    expect(subject.sessions.update).toHaveBeenCalledWith(
      'organization',
      'session',
      expect.objectContaining({
        provider: 'codex',
        config: expect.objectContaining({
          model: 'gpt-6.1-sol',
          effort: 'low',
          fastMode: false,
        }),
      }),
    );
    await subject.service.prepare(subject.context);
    expect(subject.operation.create).toHaveBeenCalledTimes(1);
  });

  it.each(['DISPATCH_PENDING', 'DENIED', 'FAILED'])(
    'stops implementation on %s and surfaces an approval failure',
    async (outcome) => {
      const subject = setup('claude', outcome);
      let now = Date.now();
      const clock =
        outcome === 'DISPATCH_PENDING'
          ? jest.spyOn(Date, 'now').mockImplementation(() => (now += 5_001))
          : undefined;
      await expect(
        new FeatureSyncImplementNode(subject.service).buildTriggerMessage(
          createMutableContextHandle(subject.context),
        ),
      ).rejects.toThrow();
      expect(subject.sessions.update).not.toHaveBeenCalled();
      expect(subject.operation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: 'FAILED' }),
        }),
      );
      clock?.mockRestore();
    },
  );

  it('stops before implementation when storing the accepted runtime fails', async () => {
    const subject = setup();
    jest
      .mocked(subject.sessions.update)
      .mockRejectedValue(new Error('storage failed'));
    await expect(subject.service.prepare(subject.context)).rejects.toThrow(
      'storage failed',
    );
    expect(subject.events).toEqual([
      'operation-created',
      'message-created',
      'trigger-bound',
      'dispatch-created',
      'accepted',
    ]);
  });
});
