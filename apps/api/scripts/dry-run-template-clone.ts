// TEMPORARY: read-only dry run of the demo template copy's record remapping.
// Mirrors the read, omission, cleanup and rewrite steps of
// ProjectTemplateCloneService.cloneInto without writing anything. Delete after use.
//
//   PROJECT_DATABASE_URL=postgresql://... npx ts-node -r tsconfig-paths/register scripts/dry-run-template-clone.ts
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TemplateCloneRemapper } from '../src/services/demo-sandbox/template-clone-remapper';

type Row = Record<string, unknown>;
const USER_FIELDS = [
  'userId',
  'assigneeId',
  'creatorId',
  'createdBy',
  'changedBy',
  'lastModifiedBy',
  'requestorId',
  'createdById',
];

async function main() {
  const prisma = new PrismaClient();
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const delegate = (name: string) =>
        (
          tx as unknown as Record<
            string,
            { findMany(a: { where: Row }): Promise<Row[]> }
          >
        )[name]!;
      const template = await tx.demoTemplate.findFirstOrThrow({
        where: { active: true },
      });
      const source = await tx.project.findFirstOrThrow({
        where: { id: template.projectId, deletedAt: null },
      });
      console.log(`Template project ${source.id}`);
      const tables: Array<{ name: string; rows: Row[] }> = [];
      const read = async (name: string, where: Row) => {
        const rows = (await delegate(name).findMany({ where })).map((r) => ({
          ...r,
        }));
        tables.push({ name, rows });
        return rows;
      };
      const ids = (rows: Row[]) => rows.map((r) => r.id);
      await read('workItemType', { projectId: source.id });
      await read('service', { projectId: source.id });
      const tasks = await read('task', { projectId: source.id });
      const docs = await read('designDoc', { projectId: source.id });
      const conversations = await read('conversation', {
        projectId: source.id,
      });
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

      const metadata = (name: string) =>
        Prisma.dmmf.datamodel.models.find(
          (m) => m.name.charAt(0).toLowerCase() + m.name.slice(1) === name,
        )!;
      const sessionConversations = conversations.filter(
        (r) =>
          r.workflowAboutType === 'agent-session' &&
          typeof r.workflowAboutId === 'string',
      );
      const existing = new Set(
        ids(
          await delegate('agentSession').findMany({
            where: {
              id: { in: sessionConversations.map((r) => r.workflowAboutId) },
            },
          }),
        ),
      );
      const omitted = new Set<unknown>();
      for (const r of sessionConversations)
        if (!existing.has(r.workflowAboutId)) omitted.add(r.id);
      let removed: boolean;
      do {
        removed = false;
        for (const table of tables) {
          const required = metadata(table.name)
            .fields.filter((f) => f.kind === 'object' && f.isRequired)
            .flatMap((f) => f.relationFromFields ?? []);
          for (let i = table.rows.length - 1; i >= 0; i--) {
            const row = table.rows[i]!;
            if (
              !omitted.has(row.id) &&
              !required.some((f) => omitted.has(row[f]))
            )
              continue;
            if (row.id !== undefined) omitted.add(row.id);
            table.rows.splice(i, 1);
            removed = true;
          }
        }
      } while (removed);
      for (const table of tables) {
        const optional = metadata(table.name)
          .fields.filter((f) => f.kind === 'object' && !f.isRequired)
          .flatMap((f) => f.relationFromFields ?? []);
        for (const row of table.rows)
          for (const f of optional) if (omitted.has(row[f])) row[f] = null;
      }

      const remap = new TemplateCloneRemapper();
      const targetProjectId = randomUUID();
      remap.ids.set(source.id, targetProjectId);
      remap.ids.set(source.organizationId, randomUUID());
      for (const table of tables)
        for (const row of table.rows) remap.collect(row);
      for (const p of proposals)
        if (p.action === 'CREATE' && typeof p.targetEntityId === 'string')
          remap.allocate(p.targetEntityId);
      for (const table of tables)
        for (const row of table.rows)
          for (const key of USER_FIELDS)
            if (typeof row[key] === 'string')
              remap.ids.set(row[key] as string, row[key] as string);

      let total = 0;
      let failures = 0;
      for (const table of tables) {
        for (const row of table.rows) {
          total++;
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
          }
          if (table.name === 'service') delete clean.repositoryId;
          delete clean.crdtSnapshotBytes;
          delete clean.crdtSnapshotSeq;
          remap.diagnosticContext = {
            sourceProjectId: source.id,
            targetProjectId,
            stage: 'record-copy',
            sourceTable: table.name,
            sourceRecordId: row.id as string,
          };
          try {
            remap.rewrite(clean);
          } catch {
            failures++; // details are logged by the remapper
          }
        }
      }
      console.log(
        `Checked ${total} records (${omitted.size} omitted, ${remap.ids.size} identities): ` +
          (failures ? `${failures} FAILED` : 'all remap cleanly'),
      );
      process.exitCode = failures ? 1 : 0;
    },
    { timeout: 120_000 },
  );
  await prisma.$disconnect();
}

void main();
