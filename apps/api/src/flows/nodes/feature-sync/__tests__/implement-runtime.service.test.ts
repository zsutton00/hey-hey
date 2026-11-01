import { PrismaService } from 'src/prisma/prisma.service';
import { FeatureSyncFlowContext } from 'src/types/flow-internal.types';
import { ImplementRuntimeService } from '../implement-runtime.service';
import { FeatureSyncImplementNode } from '../implement.node';
import { createMutableContextHandle } from 'src/utils/mutable-context';

const approvalId = '20000000-0000-4000-8000-000000000002';

function setup(state = 'ROUTING_PENDING') {
  const parent = {
    operationId: approvalId,
    kind: 'WORKFLOW_ANSWER',
    state,
    failureMessage: null as string | null,
    conversationId: 'conversation',
    organizationId: 'organization',
    projectId: 'project',
    agentSessionId: 'session',
  };
  const operation = {
    findUnique: jest.fn(async ({ where }: any) =>
      where.operationId === approvalId ? parent : null,
    ),
    findFirst: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  };
  const prisma: any = {
    db: {
      agentOperation: operation,
      agentOperationDispatch: { create: jest.fn() },
      $transaction: jest.fn(),
    },
  };
  const service = new ImplementRuntimeService(
    prisma as unknown as PrismaService,
  );
  const context = {
    core: {
      organizationId: 'organization',
      projectId: 'project',
      conversationId: 'conversation',
    },
    implementApprovalOperationId: approvalId,
    codingPlanApprovedContext: { requiredServiceIds: ['service'] },
    implementRuntime: {
      provider: 'codex',
      model: 'gpt-6.1-sol',
      reasoningEffort: 'low',
      fastMode: false,
    },
  } as unknown as FeatureSyncFlowContext;
  const build = () =>
    new FeatureSyncImplementNode(service).buildTriggerMessage(
      createMutableContextHandle(context),
    );
  return { service, context, prisma, operation, parent, build };
}

describe('approval implementation runtime', () => {
  it('preserves current behavior when no selection is supplied', async () => {
    const subject = setup();
    delete subject.context.implementRuntime;
    delete (subject.context as any).codingPlanApprovedContext;
    const trigger = await subject.build();
    expect(trigger.triggersAgent).toEqual({
      promptType: 'implement',
      nodeId: 'feature-sync-implement',
    });
    expect(subject.operation.findUnique).not.toHaveBeenCalled();
  });

  it('delivers a different provider to the existing Run on the Implement trigger without a replacement Run', async () => {
    const subject = setup();
    const trigger = await subject.build();
    expect(trigger.triggersAgent).toMatchObject({
      promptType: 'implement',
      payload: {
        requiredServiceIds: ['service'],
        runtime: {
          provider: 'codex',
          model: 'gpt-6.1-sol',
          reasoningEffort: 'low',
          fastMode: false,
        },
      },
    });
    // No replacement start-run, dispatch, or approval failure is written.
    expect(subject.operation.create).not.toHaveBeenCalled();
    expect(subject.operation.updateMany).not.toHaveBeenCalled();
    expect(
      subject.prisma.db.agentOperationDispatch.create,
    ).not.toHaveBeenCalled();
    expect(subject.prisma.db.$transaction).not.toHaveBeenCalled();
  });

  it.each(['FAILED', 'DENIED', 'CANCELLED'])(
    'stops implementation when the approval operation is %s',
    async (state) => {
      const subject = setup(state);
      subject.parent.failureMessage = 'approval refused';
      await expect(subject.build()).rejects.toThrow('approval refused');
    },
  );

  it('stops implementation when the approval operation belongs to another conversation', async () => {
    const subject = setup();
    subject.parent.conversationId = 'other';
    await expect(subject.build()).rejects.toThrow(
      'Approval runtime operation does not match the conversation.',
    );
  });

  it('requires the authorized approval operation for a selection', async () => {
    const subject = setup();
    delete subject.context.implementApprovalOperationId;
    await expect(subject.build()).rejects.toThrow(
      'Approval runtime requires its authorized operation.',
    );
  });
});
