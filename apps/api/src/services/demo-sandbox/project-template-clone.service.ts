import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { DomainEventPublisher } from '../../core/events/domain-event-publisher';
import { runWithWorkflowContext } from '../../core/events/context-utils';
import { OrganizationId, ProjectId, UserId } from '../../types';
import {
  TemplateGraphCopyCommand,
  TemplateGraphSnapshot,
} from '../../generated/graphs';
import type { AnyTransactionClient } from '../../prisma/prisma.service';
import { TemplateCloneRemapper } from './template-clone-remapper';
import { DemoTemplateGraphService } from './template-graph.service';
import { publishCloneCreatedEvents } from './template-clone-events';

type Row = Record<string, unknown>;
interface CloneDelegate {
  findMany(args: { where: Row }): Promise<Row[]>;
  create(args: { data: Row }): Promise<unknown>;
  update(args: { where: Row; data: Row }): Promise<unknown>;
}
interface Table {
  name: string;
  rows: Row[];
}

const USER_FIELDS = new Set([
  'userId',
  'assigneeId',
  'creatorId',
  'createdBy',
  'changedBy',
  'lastModifiedBy',
  'requestorId',
  'createdById',
]);

/** The template's graph, fetched ahead of the clone so no transaction waits on it. */
export interface TemplateSnapshot {
  sourceProjectId: string;
  graph: TemplateGraphSnapshot;
}

/** Copies content and historical provenance, without live executions or credentials. */
@Injectable()
export class ProjectTemplateCloneService {
  constructor(
    private readonly graph: DemoTemplateGraphService,
    private readonly events: DomainEventPublisher,
  ) {}

  /** Call outside any database transaction: it makes a network call to Graph. */
  async snapshotTemplate(db: AnyTransactionClient): Promise<TemplateSnapshot> {
    const template = await db.demoTemplate.findFirstOrThrow({
      where: { active: true },
    });
    const source = await db.project.findFirstOrThrow({
      where: { id: template.projectId, deletedAt: null },
    });
    return {
      sourceProjectId: source.id,
      graph: await this.graph.snapshot(source.organizationId, source.id),
    };
  }

  async cloneInto(
    tx: Prisma.TransactionClient,
    input: {
      targetOrganizationId: string;
      targetProjectId: string;
      actorUserId: string;
      templateSnapshot: TemplateSnapshot;
    },
  ): Promise<{
    idMap: ReadonlyMap<string, string>;
    graphCopyIntentId: string;
  }> {
    const template = await tx.demoTemplate.findFirstOrThrow({
      where: { active: true },
    });
    const source = await tx.project.findFirstOrThrow({
      where: { id: template.projectId, deletedAt: null },
    });
    const target = await tx.project.findFirstOrThrow({
      where: {
        id: input.targetProjectId,
        organizationId: input.targetOrganizationId,
        deletedAt: null,
      },
    });
    if (source.id === target.id)
      throw new Error('Cannot clone a template into itself');
    if (source.id !== input.templateSnapshot.sourceProjectId) {
      throw new Error('The active template changed after its graph snapshot');
    }
    // Lock the destination for cooperating callers and refuse to merge content.
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM projects WHERE id = ${target.id} FOR UPDATE`,
    );
    const delegate = (name: string): CloneDelegate =>
      (tx as unknown as Record<string, CloneDelegate>)[name]!;
    const tables: Table[] = [];
    const read = async (name: string, where: Row) => {
      const rows = await delegate(name).findMany({ where });
      tables.push({ name, rows });
      return rows;
    };
    const ids = (rows: Row[]) => rows.map((row) => row.id);
    for (const name of [
      'task',
      'designDoc',
      'conversation',
      'message',
      'proposal',
      'workItemType',
      'service',
    ]) {
      if (
        (await delegate(name).findMany({ where: { projectId: target.id } }))
          .length
      ) {
        throw new Error('Template clone requires an empty destination project');
      }
    }
    const types = await read('workItemType', { projectId: source.id });
    const services = await read('service', { projectId: source.id });
    const tasks = await read('task', { projectId: source.id });
    const docs = await read('designDoc', { projectId: source.id });
    const conversations = await read('conversation', { projectId: source.id });
    const messages = await read('message', { projectId: source.id });
    const proposals = await read('proposal', { projectId: source.id });
    const groups = await read('proposalGroup', { projectId: source.id });
    const sessions = await read('agentSession', { projectId: source.id });
    const validations = await read('validationSession', {
      taskId: { in: ids(tasks) },
    });
    await read('taskSection', { taskId: { in: ids(tasks) } });
    await read('taskSectionHistory', { taskId: { in: ids(tasks) } });
    await read('designDocSection', { designDocId: { in: ids(docs) } });
    await read('taskDependency', { dependentTaskId: { in: ids(tasks) } });
    await read('projectTask', { projectId: source.id });
    await read('serviceTask', { taskId: { in: ids(tasks) } });
    await read('serviceAgentSession', {
      agentSessionId: { in: ids(sessions) },
    });
    await read('serviceValidationSession', {
      validationSessionId: { in: ids(validations) },
    });
    await read('goalMembership', { goalId: { in: ids(tasks) } });
    await read('messageMention', { messageId: { in: ids(messages) } });
    await read('messageProposalReference', {
      messageId: { in: ids(messages) },
    });
    await read('proposalApprovalRecord', {
      proposalId: { in: ids(proposals) },
    });
    await read('pendingProposalEdge', { projectId: source.id });
    await read('proposalGroupMember', { groupId: { in: ids(groups) } });
    await read('proposalGroupDependency', { groupId: { in: ids(groups) } });

    const remap = new TemplateCloneRemapper();
    remap.diagnosticContext = {
      sourceProjectId: source.id,
      targetProjectId: target.id,
      stage: 'graph-snapshot',
    };
    remap.ids.set(source.id, target.id);
    remap.ids.set(source.organizationId, target.organizationId);
    for (const table of tables)
      for (const row of table.rows) remap.collect(row);
    // CREATE proposals own reserved identities before their target rows exist.
    // Allocate them before rewriting any proposal, group member or citation.
    for (const proposal of proposals) {
      if (
        proposal.action === 'CREATE' &&
        typeof proposal.targetEntityId === 'string'
      ) {
        remap.allocate(proposal.targetEntityId);
      }
    }
    // Global principals are shared, not project-scoped records. Preserve approval
    // attribution (and distinct approvers) while rewriting project references.
    for (const table of tables)
      for (const row of table.rows) {
        for (const key of USER_FIELDS) {
          if (typeof row[key] === 'string')
            remap.ids.set(row[key] as string, row[key] as string);
        }
      }
    const snapshot = input.templateSnapshot.graph;
    for (const edge of snapshot.edges) remap.allocate(edge.id);
    const intentId = randomUUID();
    const command = {
      id: intentId,
      snapshot: remap.rewrite(snapshot),
    } satisfies TemplateGraphCopyCommand;

    // Prisma metadata owns FK/JSON/null semantics. Nullable FKs are restored
    // after all rows exist, including task parents and message/history chains.
    const pending: Array<{ name: string; id: string; data: Row }> = [];
    const remaining = new Set(tables.map((table) => table.name));
    const metadata = (name: string) =>
      Prisma.dmmf.datamodel.models.find(
        (model) =>
          model.name.charAt(0).toLowerCase() + model.name.slice(1) === name,
      )!;
    while (remaining.size) {
      let progressed = false;
      for (const table of tables) {
        if (!remaining.has(table.name)) continue;
        const model = metadata(table.name);
        const relations = model.fields.filter(
          (field) =>
            field.kind === 'object' && field.relationFromFields?.length,
        );
        const required = relations.filter((field) => field.isRequired);
        if (
          required.some((field) =>
            remaining.has(
              field.type.charAt(0).toLowerCase() + field.type.slice(1),
            ),
          )
        )
          continue;
        for (const row of table.rows) {
          // CRDT bytes contain old identities. Rebase at the current materialized
          // content, exactly like ordinary section creation; never copy stale ops.
          const clean = { ...row };
          if (table.name === 'conversation') {
            clean.workflowId = null;
            clean.triggerEvent = null;
          }
          if (table.name === 'message') {
            clean.executionOperationId = null;
            clean.executionAdmissionId = null;
            clean.executionTurnId = null;
            clean.executionStatus = null;
            clean.executionAdmissionDisposition = null;
            clean.executionCancellationRequested = false;
          }
          if (table.name === 'agentSession') {
            clean.machineId = null;
            clean.providerAgentSessionId = null;
            clean.contextSizeRunId = null;
            clean.contextSizeProviderSessionId = null;
            clean.monitoringEnabled = false;
            clean.autoDecide = false;
          }
          // GitHub owns this identifier; it is not a project record.
          const repositoryId =
            table.name === 'service' ? clean.repositoryId : undefined;
          if (table.name === 'service') delete clean.repositoryId;
          delete clean.crdtSnapshotBytes;
          delete clean.crdtSnapshotSeq;
          remap.diagnosticContext = {
            sourceProjectId: source.id,
            targetProjectId: target.id,
            stage: 'record-copy',
            sourceTable: table.name,
            sourceRecordId: row.id as string,
          };
          const data = remap.rewrite(clean);
          if (repositoryId !== undefined) data.repositoryId = repositoryId;
          const deferred: Row = {};
          for (const relation of relations.filter(
            (field) => !field.isRequired,
          )) {
            for (const field of relation.relationFromFields ?? []) {
              if (data[field] != null) {
                deferred[field] = data[field];
                data[field] = null;
              }
            }
          }
          for (const field of model.fields.filter(
            (field) => field.type === 'Json',
          )) {
            if (data[field.name] === null) data[field.name] = Prisma.DbNull;
          }
          await delegate(table.name).create({ data });
          if (Object.keys(deferred).length)
            pending.push({
              name: table.name,
              id: data.id as string,
              data: deferred,
            });
        }
        remaining.delete(table.name);
        progressed = true;
      }
      if (!progressed)
        throw new Error('Template clone has cyclic required foreign keys');
    }
    for (const update of pending)
      await delegate(update.name).update({
        where: { id: update.id },
        data: update.data,
      });
    remap.diagnosticContext = {
      sourceProjectId: source.id,
      targetProjectId: target.id,
      stage: 'created-events',
    };
    // Deliberately do not copy Project.config or any template approval policy.
    await runWithWorkflowContext(
      {
        sourceService: ProjectTemplateCloneService.name,
        sourceMethod: 'cloneInto',
        context: {
          organizationId: target.organizationId as OrganizationId,
          projectId: target.id as ProjectId,
          userId: input.actorUserId as UserId,
        },
        eventContext: {
          conversationId: null,
          workflowId: null,
          messageId: null,
          agentSessionId: null,
        },
      },
      () =>
        publishCloneCreatedEvents(
          tx,
          this.events,
          target,
          input.actorUserId,
          remap,
          {
            tasks,
            docs,
            conversations,
            messages,
            proposals,
            services,
            types,
            sessions,
          },
        ),
    );
    await tx.demoGraphCopyIntent.create({
      data: {
        id: intentId,
        organizationId: target.organizationId,
        projectId: target.id,
        command: command as unknown as Prisma.InputJsonValue,
      },
    });
    return { idMap: remap.ids, graphCopyIntentId: intentId };
  }
}
