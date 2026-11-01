import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { ProjectTemplateCloneService } from '../project-template-clone.service';
import { DemoTemplateGraphService } from '../template-graph.service';
import { DomainEventPublisher } from '../../../core/events/domain-event-publisher';
import { OutboxStore } from '../../outbox-store.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { TemplateGraphSnapshot } from '../../../generated/graphs';
import { ProjectApprovalPolicyService } from '../../proposal/project-approval-policy.service';
import { evaluatePermissions } from '../../proposal/permission-evaluation';
import { ProjectId } from '../../../types';
import { runWithWorkflowContext } from '../../../core/events/context-utils';
import { ConversationId, OrganizationId } from '../../../types';

type Row = Record<string, unknown>;
const now = new Date('2026-10-16T00:00:00Z');

function fixture() {
  const sourceProject = randomUUID();
  const sourceOrg = randomUUID();
  const targetProject = randomUUID();
  const targetOrg = randomUUID();
  const actor = randomUUID();
  const feature = randomUUID();
  const child = randomUUID();
  const doc = randomUUID();
  const conversation = randomUUID();
  const firstMessage = randomUUID();
  const proposal = randomUUID();
  const history = randomUUID();
  const requirement = randomUUID();
  const input = {
    targetOrganizationId: targetOrg,
    targetProjectId: targetProject,
  };
  const state: Record<string, Row[]> = {};
  for (const model of Prisma.dmmf.datamodel.models) {
    state[model.name.charAt(0).toLowerCase() + model.name.slice(1)] = [];
  }
  state.project = [
    {
      id: sourceProject,
      organizationId: sourceOrg,
      deletedAt: null,
      description: 'Template',
    },
    {
      id: targetProject,
      organizationId: targetOrg,
      deletedAt: null,
      config: null,
    },
  ];
  state.demoTemplate = [
    { id: randomUUID(), projectId: sourceProject, active: true },
  ];
  const base = {
    organizationId: sourceOrg,
    projectId: sourceProject,
    createdAt: now,
    updatedAt: now,
  };
  state.task = [
    {
      ...base,
      id: feature,
      name: 'Capability',
      type: 'FEATURE',
      tag: 'product',
      status: 'BACKLOG',
      priority: 'MEDIUM',
      initiativeId: null,
      parentTaskId: null,
    },
    {
      ...base,
      id: child,
      name: 'Implementation',
      type: 'STANDARD',
      status: 'BACKLOG',
      priority: 'MEDIUM',
      initiativeId: null,
      parentTaskId: feature,
      sourceConversationId: conversation,
    },
  ];
  state.taskSection = [
    {
      id: randomUUID(),
      taskId: feature,
      key: 'description',
      order: 0,
      materializedMarkdown: `Delivered by @[task:${child}|Implementation]`,
      crdtSnapshotBytes: Buffer.from(child),
      crdtSnapshotSeq: 4,
    },
    {
      id: randomUUID(),
      taskId: feature,
      key: 'requirements',
      order: 1,
      materializedMarkdown: JSON.stringify({
        records: [
          {
            id: requirement,
            statement: 'Deliver it',
            designedBy: [],
            contracts: [],
            fulfilledBy: [
              {
                entityId: child,
                entityType: 'TASK',
                entityTitle: 'Implementation',
              },
            ],
          },
        ],
      }),
    },
    {
      id: randomUUID(),
      taskId: child,
      key: 'description',
      order: 0,
      materializedMarkdown: `Read @[design_doc:${doc}|Design]`,
    },
    {
      id: randomUUID(),
      taskId: child,
      key: 'acceptanceCriteria',
      order: 1,
      materializedMarkdown: 'Works',
    },
  ];
  state.taskSectionHistory = [
    {
      id: history,
      taskId: child,
      sectionKey: 'description',
      versionNumber: 1,
      contentSnapshot: `@[task:${feature}|Capability]`,
      previousVersionId: null,
    },
    {
      id: randomUUID(),
      taskId: child,
      sectionKey: 'description',
      versionNumber: 2,
      contentSnapshot: `@[design_doc:${doc}|Design]`,
      previousVersionId: history,
    },
  ];
  state.designDoc = [
    {
      ...base,
      id: doc,
      name: 'Design',
      template: 'ADR',
      status: 'ADR_CONTEXT',
      tags: [],
      parentEntityId: feature,
      parentEntityType: 'TASK',
    },
  ];
  state.designDocSection = [
    {
      id: randomUUID(),
      designDocId: doc,
      key: 'context',
      order: 0,
      materializedMarkdown: `@[task:${feature}|Capability]`,
    },
  ];
  state.conversation = [
    {
      ...base,
      id: conversation,
      title: 'Discussion',
      workflowName: 'entity_conversation',
      workflowAboutId: feature,
      workflowAboutType: 'TASK',
      initiatedBy: 'USER',
      status: 'STARTED',
      designDocId: doc,
    },
  ];
  state.message = [
    {
      id: firstMessage,
      projectId: sourceProject,
      conversationId: conversation,
      userId: actor,
      type: 'SYSTEM',
      status: 'open',
      data: { message: `@[task:${child}|Implementation]` },
      createdAt: now,
      parentMessageId: null,
    },
    {
      id: randomUUID(),
      projectId: sourceProject,
      conversationId: conversation,
      userId: actor,
      type: 'SYSTEM',
      status: 'open',
      data: { message: 'Reply' },
      createdAt: now,
      parentMessageId: firstMessage,
    },
  ];
  state.proposal = [
    {
      ...base,
      id: proposal,
      action: 'UPDATE',
      status: 'DRAFT',
      targetEntityId: child,
      targetEntityType: 'TASK',
      requestorId: actor,
      conversationId: conversation,
      messageId: firstMessage,
      updates: {
        parentTaskId: feature,
        description: `@[design_doc:${doc}|Design]`,
      },
    },
  ];
  state.proposalApprovalRecord = [
    {
      id: randomUUID(),
      proposalId: proposal,
      userId: actor,
      type: 'APPROVAL',
      createdAt: now,
    },
  ];
  state.messageMention = [
    {
      id: randomUUID(),
      messageId: firstMessage,
      conversationId: conversation,
      entityId: child,
      entityType: 'TASK',
    },
  ];
  state.messageProposalReference = [
    { messageId: firstMessage, proposalId: proposal, position: 0 },
  ];
  state.workItemType = [
    {
      id: randomUUID(),
      projectId: sourceProject,
      typeKey: 'CUSTOM',
      sectionDefinitions: [],
      writingStandards: { entityId: feature },
    },
  ];
  const snapshot: TemplateGraphSnapshot = {
    nodes: [
      { id: feature, label: 'Task' },
      { id: child, label: 'Task' },
      { id: doc, label: 'DesignDoc' },
    ],
    edges: [
      {
        id: randomUUID(),
        sourceNodeId: child,
        targetNodeId: doc,
        type: 'DEPENDS_ON',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        properties: {
          reasoning: `@[task:${feature}|Capability]`,
          projectId: sourceProject,
        },
      },
    ],
  };
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, expected]) => {
      if (expected && typeof expected === 'object' && 'in' in expected) {
        return (expected.in as unknown[]).includes(row[key]);
      }
      return row[key] === expected;
    });
  const db: Record<string, unknown> = {
    $queryRaw: jest
      .fn()
      .mockResolvedValue([{ transaction_isolation: 'repeatable read' }]),
  };
  for (const table of Object.keys(state)) {
    const find = (where: Row) =>
      state[table]!.filter((row) => matches(row, where));
    db[table] = {
      findMany: jest.fn(async ({ where }: { where: Row }) => find(where)),
      findFirstOrThrow: jest.fn(
        async ({ where }: { where: Row }) => find(where)[0],
      ),
      findUniqueOrThrow: jest.fn(
        async ({ where, include }: { where: Row; include?: Row }) => {
          const row = find(where)[0]!;
          if (!include) return row;
          const childTable =
            table === 'task' ? 'taskSection' : 'designDocSection';
          return {
            ...row,
            sections: state[childTable]!.filter(
              (section) =>
                section[table === 'task' ? 'taskId' : 'designDocId'] === row.id,
            ),
          };
        },
      ),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: randomUUID(), ...data };
        state[table]!.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: Row; data: Row }) =>
        Object.assign(find(where)[0]!, data),
      ),
    };
  }
  const graph = { snapshot: jest.fn().mockResolvedValue(snapshot) };
  const events = new DomainEventPublisher(new OutboxStore({} as PrismaService));
  const service = new ProjectTemplateCloneService(
    graph as unknown as DemoTemplateGraphService,
    events,
  );
  const tx = db as unknown as Prisma.TransactionClient;
  const transaction = async () => {
    const before = structuredClone(state);
    try {
      return await service.cloneInto(tx, {
        ...input,
        templateSnapshot: { sourceProjectId: sourceProject, graph: snapshot },
      });
    } catch (error) {
      for (const key of Object.keys(state)) state[key] = before[key]!;
      throw error;
    }
  };
  return {
    service,
    graph,
    tx,
    db,
    state,
    input,
    actor,
    transaction,
    sourceProject,
    sourceOrg,
    feature,
    child,
    requirement,
    snapshot,
  };
}

describe('ProjectTemplateCloneService', () => {
  it('skips orphan session conversations, dependent history and graph edges while retaining work', async () => {
    const f = fixture();
    const orphan = f.state.conversation![0]!;
    const missingSessionId = randomUUID();
    orphan.workflowAboutType = 'agent-session';
    orphan.workflowAboutId = missingSessionId;
    const orphanMessages = f.state.message!.map((row) => row.id);
    const validConversation = {
      ...orphan,
      id: randomUUID(),
      workflowAboutType: 'TASK',
      workflowAboutId: f.feature,
    };
    f.state.conversation!.push(validConversation);
    f.snapshot.nodes.push({ id: orphan.id as string, label: 'Conversation' });
    f.snapshot.edges.push({
      ...f.snapshot.edges[0]!,
      id: randomUUID(),
      sourceNodeId: orphan.id as string,
    });
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    try {
      const result = await f.transaction();
      expect(result.idMap.has(orphan.id as string)).toBe(false);
      expect(result.idMap.has(validConversation.id)).toBe(true);
      for (const id of orphanMessages)
        expect(result.idMap.has(id as string)).toBe(false);
      expect(f.state.message).toHaveLength(2);
      expect(f.state.messageMention).toHaveLength(1);
      expect(f.state.messageProposalReference).toHaveLength(1);
      const child = f.state.task!.find(
        (row) => row.id === result.idMap.get(f.child),
      )!;
      expect(child.sourceConversationId).toBeNull();
      expect(f.state.task).toHaveLength(4);
      const command = f.state.demoGraphCopyIntent![0]!.command as {
        snapshot: TemplateGraphSnapshot;
      };
      expect(command.snapshot.nodes).toHaveLength(3);
      expect(command.snapshot.edges).toHaveLength(1);
      expect(warning).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          sourceConversationId: orphan.id,
          missingAgentSessionId: missingSessionId,
        }),
      );
      expect(orphan.workflowAboutId).toBe(missingSessionId);
    } finally {
      warning.mockRestore();
    }
  });

  it('copies a conversation and its history when its agent session still exists', async () => {
    const f = fixture();
    const conversation = f.state.conversation![0]!;
    const sessionId = randomUUID();
    conversation.workflowAboutType = 'agent-session';
    conversation.workflowAboutId = sessionId;
    f.state.agentSession!.push({
      id: sessionId,
      projectId: f.sourceProject,
      organizationId: f.sourceOrg,
      userId: f.actor,
      conversationId: conversation.id,
      title: 'Existing session',
      type: 'CODING',
      status: 'COMPLETED',
      sessionDate: now,
      createdAt: now,
      updatedAt: now,
      hasUnsyncedChanges: false,
    });
    const result = await f.transaction();
    const copied = f.state.conversation!.find(
      (row) => row.id === result.idMap.get(conversation.id as string),
    )!;
    expect(copied.workflowAboutId).toBe(result.idMap.get(sessionId));
    expect(f.state.message).toHaveLength(4);
  });

  it('does not treat an existing session outside the copy as deleted', async () => {
    const f = fixture();
    const sessionId = randomUUID();
    const conversation = f.state.conversation![0]!;
    conversation.workflowAboutType = 'agent-session';
    conversation.workflowAboutId = sessionId;
    f.state.agentSession!.push({ id: sessionId, projectId: randomUUID() });
    const result = await f.transaction();
    const copied = f.state.conversation!.find(
      (row) => row.id === result.idMap.get(conversation.id as string),
    )!;
    expect(copied.workflowAboutId).toBe(sessionId);
  });

  it('drops references to template records left out of the copy', async () => {
    const f = fixture();
    const orphan = f.state.conversation![0]!;
    orphan.workflowAboutType = 'agent-session';
    orphan.workflowAboutId = randomUUID();
    f.state.taskSection![2]!.materializedMarkdown = `See @[conversation:${orphan.id}|Old chat]`;
    f.state.workItemType![0]!.writingStandards = {
      conversationId: orphan.id,
    };
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    try {
      const result = await f.transaction();
      const section = f.state.taskSection!.find(
        (row) =>
          row.taskId === result.idMap.get(f.child) && row.key === 'description',
      )!;
      expect(section.materializedMarkdown).toBe('See Old chat');
      expect(f.state.workItemType![1]!.writingStandards).toEqual({
        conversationId: null,
      });
    } finally {
      warning.mockRestore();
    }
  });

  it('remaps unmaterialized CREATE reservations across proposals, group members and mentions', async () => {
    const f = fixture();
    const reservedTarget = randomUUID();
    const groupId = randomUUID();
    const proposal = f.state.proposal![0]!;
    proposal.action = 'CREATE';
    proposal.targetEntityId = reservedTarget;
    f.state.proposalGroup = [
      {
        id: groupId,
        organizationId: f.sourceOrg,
        projectId: f.sourceProject,
        status: 'BUILDING',
      },
    ];
    f.state.proposalGroupMember = [
      {
        id: randomUUID(),
        groupId,
        proposalId: proposal.id,
        reservedTargetEntityId: reservedTarget,
        memberOrder: 0,
      },
    ];
    f.state.taskSection![2]!.materializedMarkdown = `Proposed @[task:${reservedTarget}|New work]`;
    const result = await f.transaction();
    const copiedTarget = result.idMap.get(reservedTarget);
    expect(copiedTarget).toBeDefined();
    expect(copiedTarget).not.toBe(reservedTarget);
    expect(f.state.proposal![1]!.targetEntityId).toBe(copiedTarget);
    expect(f.state.proposalGroupMember![1]!.reservedTargetEntityId).toBe(
      copiedTarget,
    );
    expect(f.state.taskSection![6]!.materializedMarkdown).toBe(
      `Proposed @[task:${copiedTarget}|New work]`,
    );
  });

  it('copies the complete content structure with new IDs, chains, requirements, mentions and transactional events', async () => {
    const f = fixture();
    const before = structuredClone(f.state);
    const result = await runWithWorkflowContext(
      {
        sourceService: 'CloneCaller',
        sourceMethod: 'test',
        context: {
          organizationId: f.sourceOrg as OrganizationId,
          projectId: f.sourceProject as ProjectId,
          conversationId: before.conversation![0]!.id as ConversationId,
        },
      },
      f.transaction,
    );
    for (const table of [
      'task',
      'taskSection',
      'taskSectionHistory',
      'designDoc',
      'designDocSection',
      'conversation',
      'message',
      'proposal',
      'proposalApprovalRecord',
      'messageMention',
      'messageProposalReference',
      'workItemType',
    ]) {
      expect(f.state[table]).toHaveLength(before[table]!.length * 2);
    }
    const oldIds = Object.entries(before)
      .filter(([table]) => !['project', 'demoTemplate'].includes(table))
      .flatMap(([, rows]) =>
        rows
          .map((row) => row.id)
          .filter((id): id is string => typeof id === 'string'),
      );
    const copied = Object.fromEntries(
      Object.entries(f.state).map(([table, rows]) => [
        table,
        rows.slice(before[table]!.length),
      ]),
    );
    const serialized = JSON.stringify(copied);
    for (const id of [...oldIds, f.sourceProject, f.sourceOrg, f.requirement])
      expect(serialized).not.toContain(id);
    const messages = f.state.message!.slice(2);
    expect(messages[1]!.parentMessageId).toBe(messages[0]!.id);
    const histories = f.state.taskSectionHistory!.slice(2);
    expect(histories[1]!.previousVersionId).toBe(histories[0]!.id);
    expect(f.state.taskSection!.slice(4)[0]).not.toHaveProperty(
      'crdtSnapshotBytes',
    );
    for (const row of f.state.outboxEvent!) {
      expect(row.organizationId).toBe(f.input.targetOrganizationId);
      expect(row.projectId).toBe(f.input.targetProjectId);
      // The sandbox has no human actor; Graph rejects non-UUID event user IDs.
      expect(row.payload).not.toHaveProperty('userId');
    }
    const copiedMessageEvent = f.state.outboxEvent!.find(
      (row) => row.eventType === 'message.created',
    )!;
    expect(copiedMessageEvent.headers).toEqual(
      expect.objectContaining({ templateClone: true }),
    );
    expect(
      f.state.outboxEvent!.filter((row) => row.eventType !== 'mention.created'),
    ).toHaveLength(6);
    expect(new Set(f.state.outboxEvent!.map((row) => row.eventType))).toEqual(
      new Set([
        'task.created',
        'design_doc.created',
        'conversation.created',
        'message.created',
        'mention.created',
      ]),
    );
    const intent = f.state.demoGraphCopyIntent![0]!;
    expect(intent.id).toBe(result.graphCopyIntentId);
    expect(JSON.stringify(intent.command)).toContain(result.idMap.get(f.child));
    expect(JSON.stringify(intent.command)).not.toContain(
      f.snapshot.edges[0]!.id,
    );
  });

  it('reports exactly the FEATURE tasks it copied, including one added to the template just before the clone', async () => {
    const f = fixture();
    const source = f.state.task!.find((row) => row.id === f.feature)!;
    // Added after admission started, e.g. by a template editor; it is copied,
    // so readiness must wait for it too.
    const late = { ...source, id: randomUUID() };
    f.state.task!.push(late);
    for (const section of f.state.taskSection!.filter(
      (row) => row.taskId === f.feature,
    )) {
      f.state.taskSection!.push({
        ...section,
        id: randomUUID(),
        taskId: late.id,
      });
    }

    const result = await f.transaction();

    const sourceFeatures = f.state
      .task!.filter(
        (row) => row.projectId === f.sourceProject && row.type === 'FEATURE',
      )
      .map((row) => row.id as string);
    expect(sourceFeatures).toContain(late.id);
    expect([...result.copiedFeatureIds].sort()).toEqual(
      sourceFeatures.map((id) => result.idMap.get(id)!).sort(),
    );
    for (const id of result.copiedFeatureIds) {
      expect(f.state.task!.find((row) => row.id === id)?.projectId).toBe(
        f.input.targetProjectId,
      );
    }
  });

  it('fetches the graph snapshot before the clone and never during it', async () => {
    const f = fixture();

    await expect(f.service.snapshotTemplate(f.tx)).resolves.toEqual({
      sourceProjectId: f.sourceProject,
      graph: f.snapshot,
    });
    expect(f.graph.snapshot).toHaveBeenCalledWith(f.sourceOrg, f.sourceProject);

    f.graph.snapshot.mockClear();
    await f.transaction();
    expect(f.graph.snapshot).not.toHaveBeenCalled();
  });

  it('refuses a snapshot taken from a template that is no longer active', async () => {
    const f = fixture();

    await expect(
      f.service.cloneInto(f.tx, {
        ...f.input,
        templateSnapshot: { sourceProjectId: randomUUID(), graph: f.snapshot },
      }),
    ).rejects.toThrow('active template changed');
    expect(f.state.task).toHaveLength(2);
  });

  it('completes the copy when records reference IDs that are not template records', async () => {
    const f = fixture();
    const outsideTask = randomUUID();
    const outsideConversation = randomUUID();
    const operationId = randomUUID();
    const sessionId = randomUUID();
    const serviceId = randomUUID();
    const trigger = f.state.message![0]!;
    f.state.taskSection![2]!.materializedMarkdown = `@[task:${outsideTask}|Outside template]`;
    f.state.task![1]!.sourceConversationId = outsideConversation;
    trigger.data = {
      triggersAgent: {
        kind: 'start_run',
        operationId,
        triggerMessageId: trigger.id,
        agentSessionId: sessionId,
        serviceIds: [serviceId],
        contextMetadata: {
          projectId: f.sourceProject,
          organizationId: f.sourceOrg,
        },
      },
    };
    const result = await f.transaction();
    const copiedChild = f.state.task!.find(
      (row) => row.id === result.idMap.get(f.child),
    )!;
    expect(copiedChild.sourceConversationId).toBeNull();
    expect(
      f.state.taskSection!.find(
        (row) =>
          row.taskId === result.idMap.get(f.child) && row.key === 'description',
      )!.materializedMarkdown,
    ).toBe(`@[task:${outsideTask}|Outside template]`);
    expect(f.state.message![2]!.data).toEqual({
      triggersAgent: {
        kind: 'start_run',
        operationId,
        triggerMessageId: result.idMap.get(trigger.id as string),
        agentSessionId: sessionId,
        serviceIds: [serviceId],
        contextMetadata: {
          projectId: f.input.targetProjectId,
          organizationId: f.input.targetOrganizationId,
        },
      },
    });
  });

  it('preserves logical workflow node names and transport correlation without treating them as entity references', async () => {
    const f = fixture();
    const requestId = randomUUID();
    f.state.message![0]!.data = {
      message: 'History',
      nodeId: 'welcome',
      requestId,
    };
    await f.transaction();
    expect(f.state.message![2]!.data).toEqual({
      message: 'History',
      nodeId: 'welcome',
      requestId,
    });
  });

  it('propagates a mid-clone outbox failure and leaves no copied rows or intents', async () => {
    const f = fixture();
    const delegate = f.db.outboxEvent as { create: jest.Mock };
    delegate.create.mockRejectedValueOnce(new Error('injected failure'));
    await expect(f.transaction()).rejects.toThrow('injected failure');
    expect(f.state.task).toHaveLength(2);
    expect(f.state.message).toHaveLength(2);
    expect(f.state.demoGraphCopyIntent).toHaveLength(0);
    expect(f.state.outboxEvent).toHaveLength(0);
  });

  it('keeps the default content approval policy for a project member', async () => {
    const f = fixture();
    await f.transaction();
    const policy = await new ProjectApprovalPolicyService().resolve(
      f.input.targetProjectId as ProjectId,
    );
    const config = evaluatePermissions(
      { type: 'STANDARD', parentTaskId: f.feature, initiativeId: null },
      {
        source: 'agent',
        action: 'UPDATE',
        authorId: randomUUID(),
        eligibleProjectMemberIds: [f.actor],
        toolName: null,
        changedFields: ['sections.description'],
      },
      policy,
    );
    expect(config.threshold).toBe(1);
    expect(f.state.project![1]!.config).toBeNull();
  });
});
