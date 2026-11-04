import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createServer, Server } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { JiraIntegrationHandler } from '../integration/handlers/jira.integration.handler';
import { AppModule } from '../app.module';
import { TEMPORAL_CLIENT } from '../prisma/temporal.module';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectService } from '../services/project.service';
import { OnboardingReplyService } from '../services/onboarding-reply.service';
import { LocalOnboardingController } from '../controllers/local-onboarding.controller';
import { NodeExecutionService } from '../services/workflows/node-execution.service';
import { OnboardingNodesModule } from '../flows/nodes/onboarding/onboarding-nodes.module';
import { SharedNodesModule } from '../flows/nodes/shared/shared-nodes.module';
import { onboardingFlow } from '../flows/templates/onboarding.flow';
import { OrganizationId, UserId, ProjectId, ConversationId } from '../types';
import { WorkItemTypeRegistryService } from '../services/tasks/work-item-type-registry.service';
import { isSerializableWorkflowState } from '../workflows/conversation-workflow-state';
import { ONBOARDING_NODES, SHARED_NODES } from '../flows/constants/node-ids';
import {
  assertLoopbackDatabaseHost,
  assertSafeWorktreeDatabaseTarget,
} from '../utils/worktree-database';
import { resolveWorktreeContext } from '../utils/worktree-context';
import { UserMessageData, LocalOnboardingStepRequest } from '../generated';

Object.assign(process.env, {
  INTEGRATION_ENCRYPTION_KEY: 'test-master-key-32-chars-long123',
  BROWSER_ACCESS_TOKEN_TTL_SECONDS: '900',
  BROWSER_SESSION_INACTIVITY_TTL_SECONDS: '604800',
  BROWSER_SESSION_ABSOLUTE_TTL_SECONDS: '2592000',
  PASSWORD_CHANGE_TOKEN_TTL_SECONDS: '900',
  MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'localhost.test',
  MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://localhost.test',
});

const enabled = process.env.RUN_LOCAL_ONBOARDING_DB_TESTS === '1';
const describeDatabase = enabled ? describe : describe.skip;

// The application and database are real. This loopback adapter supplies the
// already-authenticated fixture identity to the actual controller. CLI execution
// happens in a separate process with a fake AgentSessionRunner, using generated HTTP.
describeDatabase('CLI onboarding with PostgreSQL persistence', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let server: Server;
  let endpoint: string;
  let scope: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    conversationId: ConversationId;
    agentSessionId: string;
  };
  let route: 'existing' | 'discovery';
  let expectDisconnect = false;
  let dropAfterReview = false;
  let refinements = 0;
  let providerCalls = 0;
  let committedReviewRequest: LocalOnboardingStepRequest | undefined;
  const temporalStart = jest.fn(() => {
    throw new Error('Local onboarding reached Temporal');
  });

  async function saved() {
    const execution = await prisma.db.flowExecution.findFirstOrThrow({
      where: { conversationId: scope.conversationId },
    });
    if (!isSerializableWorkflowState(execution.flowState)) {
      throw new Error('Expected canonical onboarding state');
    }
    return { execution, state: execution.flowState };
  }

  async function reply(answers: UserMessageData) {
    const { state } = await saved();
    if (!state.lastSystemMessageId) {
      throw new Error('Expected a waiting form');
    }
    const conversation = await prisma.db.conversation.findUniqueOrThrow({
      where: { id: scope.conversationId },
    });
    await module.get(OnboardingReplyService).admit({
      ...scope,
      request: {
        parentMessageId: state.lastSystemMessageId,
        expectedConversationVersion: conversation.version,
        answers,
      },
    });
  }

  async function answerWaitingForm() {
    const { state } = await saved();
    switch (state.currentNodeId) {
      case ONBOARDING_NODES.WELCOME:
        await reply({
          project_concept:
            'A team reporting product with dashboards and shared reports',
          project_maturity: 'greenfield',
          team_size: 'solo',
          project_age: 'not_started',
          org_context: 'new_company',
        });
        return;
      case ONBOARDING_NODES.REPOSITORY_GROUNDING_INTENT:
        await reply({
          repository_grounding_intent: {
            choice: route === 'existing' ? 'yes' : 'no',
          },
        });
        return;
      case SHARED_NODES.GENERATE_FEATURES:
        if (refinements === 0) {
          refinements += 1;
          await reply({
            'feature-list': {
              action: 'REFINE',
              payload: { sections: {}, overall: 'Focus reporting on teams.' },
            },
          });
        } else {
          await reply({ 'feature-list': { action: 'APPROVED', payload: {} } });
        }
        return;
      case ONBOARDING_NODES.FINALIZE:
        await module
          .get(ProjectService)
          .update(
            scope.projectId,
            { status: 'ACTIVE' },
            scope.organizationId,
            scope.userId,
          );
        return;
      default:
        throw new Error(`Unexpected waiting node: ${state.currentNodeId}`);
    }
  }

  async function providerOutput() {
    providerCalls += 1;
    const { state } = await saved();
    const common = {
      response: 'Product discovery',
      detectedIntent: 'ready_to_proceed',
      intentConfidence: 1,
      uiElements: [],
    };
    if (state.localOnboarding?.pending?.kind === 'NEXT_STEPS') {
      const features = await prisma.db.task.findMany({
        where: {
          projectId: scope.projectId,
          type: 'FEATURE',
          parentTaskId: null,
        },
      });
      return {
        suggestions: features.map((feature) => ({
          featureId: feature.id,
          kind: 'TASKS',
          rationale: 'Start with team reporting',
          starterPrompt: 'Plan the first team dashboard',
        })),
      };
    }
    switch (state.currentNodeId) {
      case ONBOARDING_NODES.CLARIFY_CONCEPT:
        return common;
      case ONBOARDING_NODES.ANALYZE_PROJECT_CONCEPT:
        return {
          ...common,
          type: 'QUESTIONS',
          category: 'product',
          summary: 'Team reporting',
          projectContext: {
            whatUserWantsToDo: 'Share reports',
            whatUserWantsToBuild: 'Reporting product',
            nativeCapabilities: [
              {
                capability: 'features',
                rationale: 'Organize the delivered reporting capabilities',
              },
            ],
          },
        };
      case SHARED_NODES.GENERATE_ARTIFACTS:
        return { ...common, type: 'ARTIFACTS_GENERATION', insights: [] };
      case SHARED_NODES.GENERATE_FEATURES:
        return {
          type: 'FEATURES',
          response: 'Review reporting',
          detectedIntent: 'ready_to_proceed',
          intentConfidence: 1,
          narrative: 'Reporting for teams',
          topLevels: [
            {
              name: refinements ? 'Team Reporting' : 'Reporting',
              description: 'Shared reports and dashboards',
              tag: 'product',
              children: [
                {
                  name: 'Dashboards',
                  description: 'View team dashboards',
                  tag: 'frontend',
                },
                {
                  name: 'Shared Reports',
                  description: 'Share reports with teammates',
                  tag: 'backend',
                },
              ],
            },
          ],
        };
      default:
        throw new Error(`Unexpected provider node: ${state.currentNodeId}`);
    }
  }

  beforeAll(async () => {
    Logger.overrideLogger(['error']);
    const context = resolveWorktreeContext();
    if (!context.isLinkedWorktree || !process.env.PROJECT_DATABASE_URL) {
      throw new Error(
        'Run this suite through worktree:exec with an isolated local database',
      );
    }
    assertLoopbackDatabaseHost(process.env.PROJECT_DATABASE_URL);
    assertSafeWorktreeDatabaseTarget(
      context,
      process.env.PROJECT_DATABASE_URL,
      process.env.FLYWAY_URL,
    );
    module = await Test.createTestingModule({ imports: [AppModule] })
      // Jira's unrelated connector starts a constructor-owned rate-limit timer.
      // This suite exercises onboarding, not external issue-tracker transport.
      .overrideProvider(JiraIntegrationHandler)
      .useValue({})
      .overrideProvider(TEMPORAL_CLIENT)
      .useValue({ workflow: { start: temporalStart } })
      .compile();
    prisma = module.get(PrismaService);
    module.get(OnboardingNodesModule).onModuleInit();
    module.get(SharedNodesModule).onModuleInit();
    module.get(NodeExecutionService).registerFlow(onboardingFlow);
    await module.get(WorkItemTypeRegistryService).refresh();
    server = createServer((request, response) => {
      void (async () => {
        response.setHeader('content-type', 'application/json');
        if (request.url === '/fixture') {
          const session = await prisma.db.agentSession.findUniqueOrThrow({
            where: { id: scope.agentSessionId },
          });
          response.end(
            JSON.stringify({
              ...scope,
              route,
              expectDisconnect,
              runtime: session.config,
              provider: session.provider,
            }),
          );
          return;
        }
        if (request.url === '/provider-output') {
          response.end(JSON.stringify(await providerOutput()));
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const step = await module
          .get(LocalOnboardingController)
          .advance(
            scope.organizationId,
            scope.userId,
            scope.projectId,
            scope.conversationId,
            body,
          );
        const { state } = await saved();
        if (
          dropAfterReview &&
          body.requestId &&
          state.currentNodeId === SHARED_NODES.GENERATE_FEATURES &&
          step.state === 'WAITING_FOR_USER'
        ) {
          dropAfterReview = false;
          committedReviewRequest = body;
          request.socket.destroy();
          return;
        }
        if (step.state === 'WAITING_FOR_USER') {
          await answerWaitingForm();
        }
        response.end(JSON.stringify({ data: step }));
      })().catch((error: Error) => {
        if (!expectDisconnect) {
          console.error('onboarding fixture failure', error.message);
        }
        response.statusCode = 500;
        response.end(JSON.stringify({ message: error.message }));
      });
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, '127.0.0.1', resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected loopback server');
    }
    endpoint = `http://127.0.0.1:${address.port}`;
  }, 60000);

  afterAll(async () => {
    await new Promise<void>((resolveClose) =>
      server?.close(() => resolveClose()),
    );
    await module?.close();
  }, 60000);

  async function setup(selectedRoute: typeof route) {
    route = selectedRoute;
    refinements = 0;
    providerCalls = 0;
    expectDisconnect = false;
    committedReviewRequest = undefined;
    const organizationId = randomUUID() as OrganizationId;
    const userId = randomUUID() as UserId;
    await prisma.db.organization.create({
      data: {
        id: organizationId,
        name: 'Local onboarding',
        slug: organizationId,
      },
    });
    await prisma.db.user.create({
      data: {
        id: userId,
        email: userId + '@example.test',
        name: 'Local user',
        passwordHash: 'unused',
      },
    });
    await prisma.db.organizationMember.create({
      data: { userId, organizationId, role: 'OWNER' },
    });
    const project = await module
      .get(ProjectService)
      .create({ name: 'Reporting', organizationId }, userId);
    const conversation = await prisma.db.conversation.findFirstOrThrow({
      where: { projectId: project.id },
    });
    const machine = await prisma.db.machine.create({
      data: {
        userId,
        organizationId,
        name: 'Fixture machine',
        publicKey: 'fixture',
        tokenHash: randomUUID(),
      },
    });
    const session = await prisma.db.agentSession.create({
      data: {
        organizationId,
        projectId: project.id,
        userId,
        machineId: machine.id,
        conversationId: conversation.id,
        title: 'Local onboarding',
        sessionDate: new Date(),
        provider: 'codex',
        config: {
          type: 'CODING_SESSION',
          version: 'v2',
          model: 'selected-model',
          effort: 'high',
          fastMode: true,
        },
      },
    });
    scope = {
      organizationId,
      userId,
      projectId: project.id,
      conversationId: conversation.id,
      agentSessionId: session.id,
    };
  }

  async function runCli() {
    const child = spawn(
      'pnpm',
      [
        'exec',
        'vitest',
        'run',
        'src/agents/local-onboarding/local-onboarding.database.test.ts',
      ],
      {
        cwd: resolve(process.cwd(), '../cli'),
        env: { ...process.env, LOCAL_ONBOARDING_DATABASE_URL: endpoint },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    await new Promise<void>((resolveExit, reject) => {
      child.on('error', reject);
      child.on('exit', (code) =>
        code === 0 ? resolveExit() : reject(new Error(output)),
      );
    });
  }

  async function assertDiscoveryCompleted() {
    const features = await prisma.db.task.findMany({
      where: { projectId: scope.projectId, type: 'FEATURE' },
    });
    const root = features.find((feature) => feature.parentTaskId === null);
    expect(root).toMatchObject({ name: 'Team Reporting', tag: 'product' });
    expect(
      features
        .filter((feature) => feature.parentTaskId === root?.id)
        .map((feature) => feature.name)
        .sort(),
    ).toEqual(['Dashboards', 'Shared Reports']);
    expect(features).toHaveLength(3);
    expect(
      await prisma.db.message.count({
        where: {
          conversationId: scope.conversationId,
          data: { path: ['type'], equals: 'FEATURE_LIST' },
        },
      }),
    ).toBe(2);
    expect(
      await prisma.db.project.findUniqueOrThrow({
        where: { id: scope.projectId },
      }),
    ).toMatchObject({
      status: 'ACTIVE',
      config: {
        featureNextSteps: expect.arrayContaining([
          expect.objectContaining({
            featureId: root?.id,
            starterPrompt: expect.any(String),
          }),
        ]),
      },
    });
  }

  async function completionSnapshot() {
    const { execution } = await saved();
    return {
      executionVersion: execution.version,
      completedAt: execution.completedAt,
      conversation: await prisma.db.conversation.findUniqueOrThrow({
        where: { id: scope.conversationId },
        select: { version: true, status: true },
      }),
      messages: await prisma.db.message.count({
        where: { conversationId: scope.conversationId },
      }),
      events: await prisma.db.outboxEvent.count({
        where: { payload: { path: ['projectId'], equals: scope.projectId } },
      }),
      providerCalls,
    };
  }

  it('completes existing work and replays completion without another project or completion event', async () => {
    await setup('existing');
    await runCli();
    const completed = await completionSnapshot();
    await runCli();
    expect(await completionSnapshot()).toEqual(completed);
    expect(providerCalls).toBe(0);
    expect(
      await prisma.db.project.count({
        where: { organizationId: scope.organizationId },
      }),
    ).toBe(1);
    expect((await saved()).execution.status).toBe('COMPLETED');
    expect(
      await prisma.db.project.findUniqueOrThrow({
        where: { id: scope.projectId },
      }),
    ).toMatchObject({
      status: 'ACTIVE',
      config: { existingWorkIntent: 'selected' },
    });
    expect(temporalStart).not.toHaveBeenCalled();
  }, 120000);

  it.each(['review', 'refinement', 'approval'] as const)(
    'rolls back %s effects when saving coordination fails, then retries once',
    async (stage) => {
      await setup('discovery');
      const { execution } = await saved();
      // Fault injection is at the PostgreSQL write boundary, after the node's
      // lifecycle/message operations. Only this fixture execution can trigger it.
      await prisma.db.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION local_onboarding_fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected coordination failure'; END $$`,
      );
      const condition =
        stage === 'review'
          ? `NEW.current_node = '${SHARED_NODES.GENERATE_FEATURES}' AND NEW.flow_state->>'step' = 'waiting_for_user_input'`
          : stage === 'refinement'
            ? `NEW.flow_state->'context'->'onboardingFeatureProposal'->'structuredRefinement' IS NOT NULL`
            : `NEW.current_node = '${ONBOARDING_NODES.FINALIZE}'`;
      await prisma.db.$executeRawUnsafe(
        `CREATE TRIGGER local_onboarding_fixture_failure BEFORE UPDATE ON flow_executions FOR EACH ROW WHEN (NEW.id = '${execution.id}' AND (${condition})) EXECUTE FUNCTION local_onboarding_fixture_failure()`,
      );
      expectDisconnect = true;
      try {
        await runCli();
      } finally {
        await prisma.db.$executeRawUnsafe(
          'DROP TRIGGER local_onboarding_fixture_failure ON flow_executions',
        );
        await prisma.db.$executeRawUnsafe(
          'DROP FUNCTION local_onboarding_fixture_failure()',
        );
      }
      const committedReviews =
        stage === 'review' ? 0 : stage === 'refinement' ? 1 : 2;
      expect(
        await prisma.db.proposalGroup.count({
          where: { projectId: scope.projectId },
        }),
      ).toBe(committedReviews);
      expect(
        await prisma.db.message.count({
          where: {
            conversationId: scope.conversationId,
            data: { path: ['type'], equals: 'FEATURE_LIST' },
          },
        }),
      ).toBe(committedReviews);
      expect(
        await prisma.db.task.count({
          where: { projectId: scope.projectId, type: 'FEATURE' },
        }),
      ).toBe(0);
      expectDisconnect = false;
      await runCli();
      const completed = await completionSnapshot();
      await runCli();
      expect(await completionSnapshot()).toEqual(completed);
      expect((await saved()).execution.status).toBe('COMPLETED');
      expect(
        await prisma.db.proposalGroup.count({
          where: { projectId: scope.projectId },
        }),
      ).toBe(2);
      expect(
        await prisma.db.task.count({
          where: { projectId: scope.projectId, type: 'FEATURE' },
        }),
      ).toBe(3);
      await assertDiscoveryCompleted();
    },
    180000,
  );

  it('discovers, refines and approves after losing a committed review acknowledgement', async () => {
    await setup('discovery');
    expectDisconnect = true;
    dropAfterReview = true;
    await runCli();
    expect(
      await prisma.db.proposalGroup.count({
        where: { projectId: scope.projectId },
      }),
    ).toBe(1);
    if (!committedReviewRequest) {
      throw new Error('Expected the lost acknowledgement request');
    }
    await module
      .get(LocalOnboardingController)
      .advance(
        scope.organizationId,
        scope.userId,
        scope.projectId,
        scope.conversationId,
        committedReviewRequest,
      );
    expect(
      await prisma.db.proposalGroup.count({
        where: { projectId: scope.projectId },
      }),
    ).toBe(1);
    expect(
      await prisma.db.message.count({
        where: {
          conversationId: scope.conversationId,
          data: { path: ['type'], equals: 'FEATURE_LIST' },
        },
      }),
    ).toBe(1);
    expectDisconnect = false;
    await runCli();
    const completed = await completionSnapshot();
    await runCli();
    expect(await completionSnapshot()).toEqual(completed);
    expect((await saved()).execution.status).toBe('COMPLETED');
    expect(
      await prisma.db.proposalGroup.count({
        where: { projectId: scope.projectId },
      }),
    ).toBe(2);
    expect(
      await prisma.db.task.count({
        where: { projectId: scope.projectId, type: 'FEATURE' },
      }),
    ).toBe(3);
    await assertDiscoveryCompleted();
    expect(
      await prisma.db.project.count({
        where: { organizationId: scope.organizationId },
      }),
    ).toBe(1);
    expect(temporalStart).not.toHaveBeenCalled();
  }, 180000);
});
