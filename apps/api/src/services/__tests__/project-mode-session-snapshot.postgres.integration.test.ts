import { createHash, randomUUID } from 'node:crypto';
import { EntityType } from '@prisma/client';
import {
  AgentSessionConfigV2,
  AgentSessionType,
  SessionRole,
  type ProjectModeSnapshot,
} from '../../generated';
import { InMemoryMessageBus } from '../../core/events/in-memory-message-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { OrganizationId, ProjectId, TaskId, UserId } from '../../types';
import { AgentSessionService } from '../agent-session.service';
import { TaskService } from '../tasks/task.service';
import { WorkItemParentageValidator } from '../tasks/work-item-parentage-validator.service';
import { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';

const describeDatabase =
  process.env.RUN_PROJECT_MODE_SESSION_SNAPSHOT_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

type Fixture = {
  userId: UserId;
  organizationId: OrganizationId;
  projectId: ProjectId;
  modeId: TaskId;
  focalTaskId: TaskId;
  agentSessionId?: string;
};

const launchDescription = 'Use a proof-first review discipline.';
const launchFiles = {
  schemaVersion: 'project-mode-files.v1' as const,
  files: {
    'MODE.md': 'Ground every claim in launch-time evidence.\n',
    'references/checklist.md': 'Verify the stored snapshot before acting.\n',
  },
};
const settings = (
  enabled: boolean,
  sessionRole: SessionRole = SessionRole.Implementation,
) => ({
  sessionRole,
  schemaVersion: 'project-mode-settings.v1' as const,
  projectAssistant: { enabled },
});
const editedDescription = 'Use the newly edited canonical discipline.';
const editedFiles = {
  schemaVersion: 'project-mode-files.v1' as const,
  files: {
    'MODE.md': 'This canonical content was edited after launch.\n',
    'references/checklist.md': 'Read current state instead.\n',
    'references/new-guidance.md': 'This path did not exist at launch.\n',
  },
};

describeDatabase(
  'AgentSession project MODE snapshot PostgreSQL readback',
  () => {
    let prisma: PrismaService;
    let agentSessionService: AgentSessionService;
    let taskService: TaskService;
    let registry: WorkItemTypeRegistryService;
    const fixtures: Fixture[] = [];

    beforeAll(async () => {
      prisma = new PrismaService();
      await prisma.$connect();

      registry = new WorkItemTypeRegistryService(
        prisma,
        new InMemoryMessageBus(),
      );
      await registry.onModuleInit();

      const eventPublisher = {
        publishInTransaction: jest.fn().mockResolvedValue(randomUUID()),
      };
      taskService = new TaskService(
        prisma,
        eventPublisher as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        registry,
        new WorkItemParentageValidator(registry),
        {} as any,
      );
      agentSessionService = new AgentSessionService(
        prisma,
        eventPublisher as any,
        {} as any,
        { registerEntity: jest.fn().mockResolvedValue(undefined) } as any,
        {} as any,
        undefined,
        undefined,
        undefined,
        registry,
      );
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    async function createFixture(
      launchSettings?: ReturnType<typeof settings>,
    ): Promise<Fixture> {
      const fixture: Fixture = {
        userId: randomUUID() as UserId,
        organizationId: randomUUID() as OrganizationId,
        projectId: randomUUID() as ProjectId,
        modeId: randomUUID() as TaskId,
        focalTaskId: randomUUID() as TaskId,
      };
      fixtures.push(fixture);

      await prisma.db.user.create({
        data: {
          id: fixture.userId,
          email: `project-mode-snapshot-${randomUUID()}@example.com`,
          name: 'Project Mode Snapshot Integration User',
          passwordHash: 'integration-test-password-hash',
        },
      });
      await prisma.db.organization.create({
        data: {
          id: fixture.organizationId,
          name: `Project Mode Snapshot ${randomUUID()}`,
          slug: `project-mode-snapshot-${randomUUID()}`,
        },
      });
      await prisma.db.organizationMember.create({
        data: {
          organizationId: fixture.organizationId,
          userId: fixture.userId,
        },
      });
      await prisma.db.project.create({
        data: {
          id: fixture.projectId,
          organizationId: fixture.organizationId,
          name: 'Project Mode Snapshot Integration Project',
          status: 'ACTIVE',
        },
      });
      await registry.refresh();
      await prisma.db.task.create({
        data: {
          id: fixture.modeId,
          organizationId: fixture.organizationId,
          projectId: fixture.projectId,
          name: 'Proof-first review',
          type: 'MODE',
          status: 'ACTIVE',
          sections: {
            create: [
              {
                key: 'description',
                order: 0,
                materializedMarkdown: launchDescription,
              },
              {
                key: 'files',
                order: 1,
                materializedMarkdown: JSON.stringify(launchFiles),
              },
              ...(launchSettings
                ? [
                    {
                      key: 'settings',
                      order: 2,
                      materializedMarkdown: JSON.stringify(launchSettings),
                    },
                  ]
                : []),
            ],
          },
        },
      });
      await prisma.db.task.create({
        data: {
          id: fixture.focalTaskId,
          organizationId: fixture.organizationId,
          projectId: fixture.projectId,
          name: 'Focal implementation task',
          type: 'STANDARD',
          status: 'ACTIVE',
        },
      });

      return fixture;
    }

    async function editModeThroughMaterializationBoundary(
      fixture: Fixture,
      description: string,
      files: typeof launchFiles | typeof editedFiles,
      modeSettings?: ReturnType<typeof settings>,
    ): Promise<void> {
      // Proposal approval materializes work-item edits through this transaction-aware
      // boundary. Exercising it here keeps the regression on the ordinary reviewed
      // work-item write path without inventing a MODE-specific mutation API.
      await prisma.db.$transaction(async (tx) => {
        await taskService.updateInTransaction(
          tx as any,
          fixture.organizationId,
          null,
          fixture.modeId,
          {
            sections: [
              { key: 'description', content: description },
              { key: 'files', content: files },
              ...(modeSettings
                ? [{ key: 'settings', content: modeSettings }]
                : []),
            ],
          },
          fixture.userId,
        );
      });
    }

    async function cleanupFixture(fixture: Fixture): Promise<void> {
      if (fixture.agentSessionId) {
        await prisma.db.agentSession.deleteMany({
          where: { id: fixture.agentSessionId },
        });
      }
      await prisma.db.task.deleteMany({
        where: { id: { in: [fixture.modeId, fixture.focalTaskId] } },
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

    async function launch(fixture: Fixture): Promise<AgentSessionConfigV2> {
      const created = await agentSessionService.create(
        fixture.organizationId,
        fixture.projectId,
        fixture.userId,
        {
          projectId: fixture.projectId,
          sessionDate: new Date().toISOString(),
          title: 'Captured project MODE session',
          type: AgentSessionType.Coding,
          entityType: EntityType.TASK,
          entityId: fixture.focalTaskId,
          config: {
            type: AgentSessionConfigV2.TypeEnum.CodingSession,
            version: AgentSessionConfigV2.VersionEnum.V2,
            model: 'gpt-5',
            projectModeSelection: {
              schemaVersion: 'project-mode-selection.v1',
              modeId: fixture.modeId,
            },
          },
        },
      );
      fixture.agentSessionId = created.id;
      return created.config as AgentSessionConfigV2;
    }

    it.each(Object.values(SessionRole))(
      'keeps captured role %s and participation after the MODE is edited',
      async (sessionRole) => {
        const fixture = await createFixture(settings(false, sessionRole));

        try {
          const launchConfig = await launch(fixture);
          const launchSnapshot = launchConfig.projectModeSnapshot;
          expect(launchSnapshot).toMatchObject({
            schemaVersion: 'project-mode-snapshot.v3',
            sessionRole,
            projectAssistant: { enabled: false },
          });

          await editModeThroughMaterializationBoundary(
            fixture,
            launchDescription,
            launchFiles,
            settings(true),
          );
          const canonicalSettings =
            await prisma.db.taskSection.findFirstOrThrow({
              where: { taskId: fixture.modeId, key: 'settings' },
              select: { materializedMarkdown: true },
            });
          expect(canonicalSettings.materializedMarkdown).toBe(
            JSON.stringify(settings(true)),
          );

          const readback = await agentSessionService.findOne(
            fixture.organizationId,
            fixture.agentSessionId!,
          );
          const readbackSnapshot = (readback.config as AgentSessionConfigV2)
            .projectModeSnapshot as ProjectModeSnapshot;
          expect(readbackSnapshot.projectAssistant).toEqual({ enabled: false });
          expect(readbackSnapshot.sessionRole).toBe(sessionRole);
          expect(JSON.stringify(readbackSnapshot)).toBe(
            JSON.stringify(launchSnapshot),
          );
        } finally {
          await cleanupFixture(fixture);
          fixtures.splice(fixtures.indexOf(fixture), 1);
        }
      },
    );

    it('still reads and verifies a snapshot captured before the setting existed', async () => {
      const fixture = await createFixture();

      try {
        const launchConfig = await launch(fixture);
        const v2 = launchConfig.projectModeSnapshot as ProjectModeSnapshot;
        const v1Content = {
          schemaVersion: 'project-mode-snapshot.v1' as const,
          modeId: v2.modeId,
          catalogDescription: v2.catalogDescription,
          applicableWorkItemTypeKeys: v2.applicableWorkItemTypeKeys,
          files: v2.files,
        };
        const v1Snapshot = {
          ...v1Content,
          snapshotHash: createHash('sha256')
            .update(JSON.stringify(v1Content))
            .digest('hex'),
        };
        await prisma.db.agentSession.update({
          where: { id: fixture.agentSessionId },
          data: {
            config: { ...launchConfig, projectModeSnapshot: v1Snapshot } as any,
          },
        });

        const readback = await agentSessionService.findOne(
          fixture.organizationId,
          fixture.agentSessionId!,
        );
        const readbackSnapshot = (readback.config as AgentSessionConfigV2)
          .projectModeSnapshot as ProjectModeSnapshot;
        expect(JSON.stringify(readbackSnapshot)).toBe(
          JSON.stringify(v1Snapshot),
        );
        expect(readbackSnapshot).not.toHaveProperty('projectAssistant');
      } finally {
        await cleanupFixture(fixture);
        fixtures.splice(fixtures.indexOf(fixture), 1);
      }
    });

    it('returns the exact launch-time selection and snapshot after the canonical MODE changes', async () => {
      const fixture = await createFixture();

      try {
        const created = await agentSessionService.create(
          fixture.organizationId,
          fixture.projectId,
          fixture.userId,
          {
            projectId: fixture.projectId,
            sessionDate: new Date().toISOString(),
            title: 'Captured project MODE session',
            type: AgentSessionType.Coding,
            entityType: EntityType.TASK,
            entityId: fixture.focalTaskId,
            config: {
              type: AgentSessionConfigV2.TypeEnum.CodingSession,
              version: AgentSessionConfigV2.VersionEnum.V2,
              model: 'gpt-5',
              projectModeSelection: {
                schemaVersion: 'project-mode-selection.v1',
                modeId: fixture.modeId,
              },
            },
          },
        );
        fixture.agentSessionId = created.id;

        const launchConfig = created.config as AgentSessionConfigV2;
        const launchSnapshot = launchConfig.projectModeSnapshot;
        expect(launchSnapshot).toBeDefined();

        await editModeThroughMaterializationBoundary(
          fixture,
          editedDescription,
          editedFiles,
        );

        const canonicalMode = await prisma.db.task.findUniqueOrThrow({
          where: { id: fixture.modeId },
          select: {
            sections: {
              orderBy: { order: 'asc' },
              select: { key: true, materializedMarkdown: true },
            },
          },
        });
        expect(canonicalMode.sections).toEqual([
          { key: 'description', materializedMarkdown: editedDescription },
          { key: 'files', materializedMarkdown: JSON.stringify(editedFiles) },
        ]);

        const readback = await agentSessionService.findOne(
          fixture.organizationId,
          created.id,
        );
        const readbackConfig = readback.config as AgentSessionConfigV2;
        const readbackSnapshot =
          readbackConfig.projectModeSnapshot as ProjectModeSnapshot;

        expect(readbackConfig.projectModeSelection).toEqual(
          launchConfig.projectModeSelection,
        );
        expect(readbackSnapshot.snapshotHash).toBe(
          launchSnapshot?.snapshotHash,
        );
        expect(readbackSnapshot.catalogDescription).toBe(
          launchSnapshot?.catalogDescription,
        );
        expect(readbackSnapshot.files.files['MODE.md']).toBe(
          launchSnapshot?.files.files['MODE.md'],
        );
        expect(Object.keys(readbackSnapshot.files.files)).toEqual(
          Object.keys(launchSnapshot?.files.files ?? {}),
        );
        expect(readbackSnapshot.files).toEqual(launchSnapshot?.files);
        expect(readbackSnapshot.applicableWorkItemTypeKeys).toEqual(
          launchSnapshot?.applicableWorkItemTypeKeys,
        );
        expect(JSON.stringify(readbackSnapshot)).toBe(
          JSON.stringify(launchSnapshot),
        );

        expect(readbackSnapshot.catalogDescription).not.toBe(editedDescription);
        expect(readbackSnapshot.files).not.toEqual(editedFiles);
        expect(readbackSnapshot.files.files).not.toHaveProperty(
          'references/new-guidance.md',
        );
      } finally {
        try {
          await editModeThroughMaterializationBoundary(
            fixture,
            launchDescription,
            launchFiles,
          );
        } finally {
          await cleanupFixture(fixture);
          fixtures.splice(fixtures.indexOf(fixture), 1);
        }
      }
    });
  },
);
