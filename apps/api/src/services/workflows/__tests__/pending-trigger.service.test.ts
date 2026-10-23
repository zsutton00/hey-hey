import { Logger } from '@nestjs/common';
import {
  PendingTriggerService,
  REFAN_TRIGGER_FRESHNESS_WINDOW_MS,
} from '../pending-trigger.service';
import type {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../../types';

const CONVERSATION_ID = 'conv-1' as ConversationId;
const NODE_ID = 'FeatureSyncAnalyze';

type FakeMessage = {
  id: string;
  data: unknown;
  createdAt: Date;
};

function buildService(messages: FakeMessage[]) {
  const findMany = jest.fn().mockResolvedValue(messages);
  const prisma = { db: { message: { findMany } } };
  const service = new PendingTriggerService(prisma as any);
  return { service, findMany };
}

function trigger(
  id: string,
  createdAt: string,
  triggersAgentNodeId: string = NODE_ID,
): FakeMessage {
  return {
    id,
    data: {
      triggersAgent: {
        promptType: 'feature_sync_analyze',
        nodeId: triggersAgentNodeId,
      },
    },
    createdAt: new Date(createdAt),
  };
}

function completion(
  id: string,
  createdAt: string,
  completesTriggerMessageId: string,
): FakeMessage {
  return {
    id,
    data: {
      completesExternalAgentNode: {
        nodeId: NODE_ID,
        action: 'NO_DISCREPANCY',
        completesTriggerMessageId,
      },
    },
    createdAt: new Date(createdAt),
  };
}

describe('PendingTriggerService.resolvePendingTriggerForNode', () => {
  it('returns null triggerMessageId when there are no SYSTEM messages at all', async () => {
    const { service, findMany } = buildService([]);

    const result = await service.resolvePendingTriggerForNode(
      CONVERSATION_ID,
      NODE_ID,
    );

    expect(result).toEqual({ triggerMessageId: null });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        conversationId: CONVERSATION_ID,
        type: 'SYSTEM',
        createdAt: { not: null },
      },
      select: { id: true, data: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('returns the trigger id when one open trigger exists for the node', async () => {
    const { service } = buildService([
      trigger('trigger-1', '2026-01-01T00:00:00Z'),
    ]);

    const result = await service.resolvePendingTriggerForNode(
      CONVERSATION_ID,
      NODE_ID,
    );

    expect(result).toEqual({ triggerMessageId: 'trigger-1' });
  });

  it('returns null when the only trigger has already been completed by a later message', async () => {
    const { service } = buildService([
      trigger('trigger-1', '2026-01-01T00:00:00Z'),
      completion('completion-1', '2026-01-01T00:00:01Z', 'trigger-1'),
    ]);

    const result = await service.resolvePendingTriggerForNode(
      CONVERSATION_ID,
      NODE_ID,
    );

    expect(result).toEqual({ triggerMessageId: null });
  });

  it('returns null when the only trigger targets a different nodeId', async () => {
    const { service } = buildService([
      trigger('trigger-1', '2026-01-01T00:00:00Z', 'OtherNode'),
    ]);

    const result = await service.resolvePendingTriggerForNode(
      CONVERSATION_ID,
      NODE_ID,
    );

    expect(result).toEqual({ triggerMessageId: null });
  });

  it('excludes operation-backed triggers from legacy node recovery', async () => {
    const operationTrigger = trigger(
      'operation-trigger',
      '2026-01-01T00:00:00Z',
    );
    (operationTrigger.data as { triggersAgent: Record<string, unknown> })
      .triggersAgent.operationId = '11111111-1111-4111-8111-111111111111';
    const { service } = buildService([operationTrigger]);

    await expect(
      service.resolvePendingTriggerForNode(CONVERSATION_ID, NODE_ID),
    ).resolves.toEqual({ triggerMessageId: null });
  });

  it('ignores triggers whose triggersAgent.nodeId does not match currentNodeId even when they are otherwise pending', async () => {
    const { service } = buildService([
      trigger('trigger-other', '2026-01-01T00:00:00Z', 'OtherNode'),
      trigger('trigger-match', '2026-01-01T00:00:01Z', NODE_ID),
    ]);

    const result = await service.resolvePendingTriggerForNode(
      CONVERSATION_ID,
      NODE_ID,
    );

    expect(result).toEqual({ triggerMessageId: 'trigger-match' });
  });

  it('returns the most recent survivor and emits a warn log when multiple pending triggers exist for the node', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const { service } = buildService([
      trigger('trigger-old', '2026-01-01T00:00:00Z'),
      trigger('trigger-new', '2026-01-01T00:00:05Z'),
    ]);

    const result = await service.resolvePendingTriggerForNode(
      CONVERSATION_ID,
      NODE_ID,
    );

    expect(result).toEqual({ triggerMessageId: 'trigger-new' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnMessage = warnSpy.mock.calls[0]?.[0] ?? '';
    expect(warnMessage).toContain(`conversation=${CONVERSATION_ID}`);
    expect(warnMessage).toContain(`node=${NODE_ID}`);
    expect(warnMessage).toContain('trigger-old');
    expect(warnMessage).toContain('trigger-new');

    warnSpy.mockRestore();
  });

  it('breaks ties on equal createdAt by sorting id descending so the result is deterministic', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const sameTimestamp = '2026-01-01T00:00:00Z';
    const { service } = buildService([
      trigger('trigger-aaa', sameTimestamp),
      trigger('trigger-zzz', sameTimestamp),
    ]);

    const result = await service.resolvePendingTriggerForNode(
      CONVERSATION_ID,
      NODE_ID,
    );

    expect(result).toEqual({ triggerMessageId: 'trigger-zzz' });
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});

describe('PendingTriggerService.resolveOpenTriggersForUser', () => {
  const USER_ID = 'user-1' as UserId;
  const ORG_ID = 'org-1' as OrganizationId;
  const PROJECT_ID = 'proj-1' as ProjectId;

  type StoreRow = {
    conversationId: string;
    messageId: string;
    organizationId: string;
    projectId: string;
  };

  function storeRow(
    conversationId: string,
    messageId: string,
    organizationId: string = ORG_ID,
    projectId: string = PROJECT_ID,
  ): StoreRow {
    return { conversationId, messageId, organizationId, projectId };
  }

  type ExecutionRow = {
    conversationId: string | null;
    currentNode: string | null;
    startedAt: Date;
  };

  type MessageRow = {
    id: string;
    data: unknown;
  };

  const DEFAULT_NODE_ID = 'node-default';

  function defaultExecutionFor(row: StoreRow): ExecutionRow {
    return {
      conversationId: row.conversationId,
      currentNode: DEFAULT_NODE_ID,
      startedAt: new Date('2026-01-01T00:00:00Z'),
    };
  }

  function defaultMessageFor(row: StoreRow): MessageRow {
    return {
      id: row.messageId,
      data: {
        triggersAgent: {
          promptType: 'feature_sync_analyze',
          nodeId: DEFAULT_NODE_ID,
        },
      },
    };
  }

  function buildUserService(
    rows: StoreRow[],
    options?: {
      executions?: ExecutionRow[];
      messages?: MessageRow[];
    },
  ) {
    // Default executions and messages match each row's node id so the new
    // gate accepts every row. New orphan-scenario tests override these to
    // exercise the dropped paths.
    const executions = options?.executions ?? rows.map(defaultExecutionFor);
    const messages = options?.messages ?? rows.map(defaultMessageFor);

    const pendingOpenTriggerFindMany = jest.fn().mockResolvedValue(rows);
    const flowExecutionFindMany = jest.fn().mockResolvedValue(executions);
    const messageFindMany = jest.fn().mockResolvedValue(messages);
    const prisma = {
      db: {
        pendingOpenTrigger: { findMany: pendingOpenTriggerFindMany },
        flowExecution: { findMany: flowExecutionFindMany },
        message: { findMany: messageFindMany },
      },
    };
    const service = new PendingTriggerService(prisma as never);
    return {
      service,
      pendingOpenTriggerFindMany,
      flowExecutionFindMany,
      messageFindMany,
    };
  }

  it('returns one entry per open-trigger row, carries org/project routing context, and filters the lookup by userId', async () => {
    const { service, pendingOpenTriggerFindMany } = buildUserService([
      storeRow('conv-a', 'trig-a1'),
      storeRow('conv-b', 'trig-b1'),
    ]);

    const result = await service.resolveOpenTriggersForUser(USER_ID);

    // The lookup is a single point query keyed by userId — no AgentSession
    // scan, no take/orderBy bound — plus a freshness cutoff on created_at so
    // stale sessions are not re-fanned on authenticate.
    expect(pendingOpenTriggerFindMany).toHaveBeenCalledTimes(1);
    const query = pendingOpenTriggerFindMany.mock.calls[0]?.[0];
    expect(query.where.userId).toBe(USER_ID);
    expect(query.where.createdAt.gte).toBeInstanceOf(Date);
    expect(query.select).toEqual({
      conversationId: true,
      messageId: true,
      organizationId: true,
      projectId: true,
    });

    expect(result).toEqual([
      {
        conversationId: 'conv-a' as ConversationId,
        messageId: 'trig-a1',
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
      },
      {
        conversationId: 'conv-b' as ConversationId,
        messageId: 'trig-b1',
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
      },
    ]);
  });

  it('recovers all open triggers for a user with a large active-session footprint — no cap', async () => {
    // Far above the old 500-session cap: every row the store holds is
    // returned because the resolver no longer bounds by session count.
    const rows = Array.from({ length: 1500 }, (_, i) =>
      storeRow(`conv-${i}`, `trig-${i}`),
    );
    const { service } = buildUserService(rows);

    const result = await service.resolveOpenTriggersForUser(USER_ID);

    expect(result).toHaveLength(1500);
    expect(result[0]).toEqual({
      conversationId: 'conv-0' as ConversationId,
      messageId: 'trig-0',
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
    });
  });

  it('applies a freshness cutoff (~5 minutes) so authenticate-time re-fan does not resurrect stale sessions', async () => {
    const { service, pendingOpenTriggerFindMany } = buildUserService([
      storeRow('conv-fresh', 'trig-fresh'),
    ]);

    const before = Date.now();
    await service.resolveOpenTriggersForUser(USER_ID);
    const after = Date.now();

    // The query now bounds by created_at >= now − window. The DB enforces the
    // exclusion; here we assert the cutoff is present and set to the window.
    const query = pendingOpenTriggerFindMany.mock.calls[0]?.[0];
    expect(query.where.userId).toBe(USER_ID);
    const gte = query.where.createdAt.gte as Date;
    expect(gte).toBeInstanceOf(Date);
    expect(gte.getTime()).toBeGreaterThanOrEqual(
      before - REFAN_TRIGGER_FRESHNESS_WINDOW_MS - 50,
    );
    expect(gte.getTime()).toBeLessThanOrEqual(
      after - REFAN_TRIGGER_FRESHNESS_WINDOW_MS + 50,
    );
  });

  it('returns an empty array when the store holds no open triggers for the user', async () => {
    const { service } = buildUserService([]);

    const result = await service.resolveOpenTriggersForUser(USER_ID);

    expect(result).toEqual([]);
  });

  it('returns exactly the rows the store holds — completed triggers are excluded at write time, not re-derived here', async () => {
    // The completion write path deletes the row, so a completed trigger is
    // simply absent from the store; the resolver returns survivors 1:1.
    const { service } = buildUserService([storeRow('conv-a', 'trig-open')]);

    const result = await service.resolveOpenTriggersForUser(USER_ID);

    expect(result).toEqual([
      {
        conversationId: 'conv-a' as ConversationId,
        messageId: 'trig-open',
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
      },
    ]);
  });

  it('drops an orphan row whose trigger nodeId no longer matches the workflow current node', async () => {
    // Workflow has since advanced from node A → node B; the pending row still
    // names node A. Without the gate we would re-fan an orphan trigger; with
    // the gate the row is excluded entirely.
    const rows = [storeRow('conv-orphan', 'trig-orphan')];
    const { service } = buildUserService(rows, {
      executions: [
        {
          conversationId: 'conv-orphan',
          currentNode: 'NodeB',
          startedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      messages: [
        {
          id: 'trig-orphan',
          data: {
            triggersAgent: {
              promptType: 'feature_sync_analyze',
              nodeId: 'NodeA',
            },
          },
        },
      ],
    });

    const result = await service.resolveOpenTriggersForUser(USER_ID);

    expect(result).toEqual([]);
  });

  it('keeps a row whose trigger nodeId matches the workflow current node', async () => {
    const rows = [storeRow('conv-live', 'trig-live')];
    const { service } = buildUserService(rows, {
      executions: [
        {
          conversationId: 'conv-live',
          currentNode: 'NodeA',
          startedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      messages: [
        {
          id: 'trig-live',
          data: {
            triggersAgent: {
              promptType: 'feature_sync_analyze',
              nodeId: 'NodeA',
            },
          },
        },
      ],
    });

    const result = await service.resolveOpenTriggersForUser(USER_ID);

    expect(result).toEqual([
      {
        conversationId: 'conv-live' as ConversationId,
        messageId: 'trig-live',
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
      },
    ]);
  });

  it('excludes operation-backed rows from authenticate-time direct re-fan', async () => {
    const rows = [storeRow('conv-operation', 'trig-operation')];
    const { service } = buildUserService(rows, {
      executions: [
        {
          conversationId: 'conv-operation',
          currentNode: 'NodeA',
          startedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      messages: [
        {
          id: 'trig-operation',
          data: {
            triggersAgent: {
              promptType: 'start_run',
              nodeId: 'NodeA',
              operationId: '11111111-1111-4111-8111-111111111111',
            },
          },
        },
      ],
    });

    await expect(service.resolveOpenTriggersForUser(USER_ID)).resolves.toEqual(
      [],
    );
  });

  it('drops a row whose conversation has no active+resumable flow execution', async () => {
    // The store still holds the row, but no resumable execution exists for the
    // conversation — the workflow has been terminated/failed/cancelled. The
    // gate drops the row so authenticate-time re-fan does not resurrect it.
    const rows = [storeRow('conv-dead', 'trig-dead')];
    const { service } = buildUserService(rows, {
      executions: [],
      messages: [
        {
          id: 'trig-dead',
          data: {
            triggersAgent: {
              promptType: 'feature_sync_analyze',
              nodeId: 'NodeA',
            },
          },
        },
      ],
    });

    const result = await service.resolveOpenTriggersForUser(USER_ID);

    expect(result).toEqual([]);
  });

  it('keeps the most recent execution per conversation when multiple resumable rows exist', async () => {
    // A conversation can have multiple resumable executions (e.g. a wound-down
    // COMPLETED+resumable row plus a fresh STARTED row). The resolver must
    // gate against the live one, not the wound-down one.
    const rows = [storeRow('conv-multi', 'trig-multi')];
    const { service } = buildUserService(rows, {
      executions: [
        {
          conversationId: 'conv-multi',
          currentNode: 'NodeB',
          startedAt: new Date('2026-02-01T00:00:00Z'),
        },
        {
          conversationId: 'conv-multi',
          currentNode: 'NodeA',
          startedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      messages: [
        {
          id: 'trig-multi',
          data: {
            triggersAgent: {
              promptType: 'feature_sync_analyze',
              nodeId: 'NodeB',
            },
          },
        },
      ],
    });

    const result = await service.resolveOpenTriggersForUser(USER_ID);

    expect(result).toEqual([
      {
        conversationId: 'conv-multi' as ConversationId,
        messageId: 'trig-multi',
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
      },
    ]);
  });

  it('queries flowExecution with the active+resumable predicate (matches findActiveByConversation)', async () => {
    const { service, flowExecutionFindMany, messageFindMany } = buildUserService([
      storeRow('conv-a', 'trig-a'),
    ]);

    await service.resolveOpenTriggersForUser(USER_ID);

    const flowQuery = flowExecutionFindMany.mock.calls[0]?.[0];
    expect(flowQuery.where.conversationId.in).toEqual(['conv-a']);
    expect(flowQuery.where.resumable).toBe(true);
    expect(flowQuery.where.status.in).toEqual([
      'STARTED',
      'IN_PROGRESS',
      'PAUSED',
      'COMPLETED',
    ]);
    expect(flowQuery.orderBy).toEqual({ startedAt: 'desc' });

    const messageQuery = messageFindMany.mock.calls[0]?.[0];
    expect(messageQuery.where.id.in).toEqual(['trig-a']);
    expect(messageQuery.where.type).toBe('SYSTEM');
  });
});
