import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { REPOSITORY_IMPORT_NODES } from '../flows/constants';
import { OnboardingRepositoryGroundingPrerequisitesNode } from '../flows/nodes/onboarding/repository-grounding-prerequisites.node';
import { RepositoryImportEnrichmentChoiceNode } from '../flows/nodes/repository-import/repository-import-enrichment-choice.node';
import { RepositoryImportEndNode } from '../flows/nodes/repository-import/repository-import-finalize.node';
import { repositoryImportFlow } from '../flows/templates/repository-import.flow';
import { NodeRegistry } from '../flows/nodes/node-registry.service';
import { MessageStatus, WorkflowName } from '../generated';
import { PrismaService } from '../prisma/prisma.service';
import { JOB_ENQUEUER_TOKEN } from '../services/job.tokens';
import { IntentDetectorService } from '../services/intent-detector.service';
import { MachinePairingService } from '../services/machine-pairing/machine-pairing.service';
import { MachineExecutionReadinessService } from '../services/machine-pairing/machine-execution-readiness.service';
import {
  CreateMessageInput,
  MessageService,
} from '../services/message.service';
import { PromptBuilderService } from '../services/llm/prompt-builder.service';
import { LLMClientService } from '../services/llm/llm-client.service';
import { ServiceService } from '../services/service/service.service';
import { LocalRepositoryImportService } from '../services/workflows/local-repository-import.service';
import { FlowSecurityService } from '../services/workflows/flow-security.service';
import { NodeExecutionService } from '../services/workflows/node-execution.service';
import { MessageId, UserId } from '../types';
import { NodeType } from '../types/flow-internal.types';
import {
  createMockFlowContext,
  createMockFlowUserMessage,
} from '../utils/testUtils';
import { isSerializableWorkflowState } from '../workflows/conversation-workflow-state';

const databaseUrl = process.env.LOCAL_REPOSITORY_IMPORT_DATABASE_URL;

(databaseUrl ? describe : describe.skip)(
  'local import PostgreSQL recovery',
  () => {
    it('reopens a failed import once and ends the saved Done step once', async () => {
      const endpoint = new URL(databaseUrl!);
      if (endpoint.hostname !== '127.0.0.1' || endpoint.port !== '55483') {
        throw new Error(
          'Use the disposable repository-import PostgreSQL instance',
        );
      }
      process.env.PROJECT_DATABASE_URL = databaseUrl;

      const prisma = new PrismaService();
      const userId = randomUUID() as UserId;
      const organization = await prisma.db.organization.create({
        data: { name: 'Repository import test', slug: randomUUID() },
      });
      const organizationId = organization.id;
      await prisma.db.user.create({
        data: {
          id: userId,
          email: `${userId}@example.test`,
          name: 'Import tester',
          passwordHash: 'unused',
        },
      });
      const project = await prisma.db.project.create({
        data: { name: 'Team Reporting', organizationId, createdBy: userId },
      });
      const projectId = project.id;
      const conversation = await prisma.db.conversation.create({
        data: {
          projectId,
          organizationId,
          createdBy: userId,
          initiatedBy: 'USER',
          status: 'FAILED',
          workflowName: WorkflowName.RepositoryImport,
          workflowAboutType: 'project',
          workflowAboutId: projectId,
        },
      });
      const conversationId = conversation.id;

      const module = await Test.createTestingModule({
        providers: [
          LocalRepositoryImportService,
          NodeExecutionService,
          NodeRegistry,
          OnboardingRepositoryGroundingPrerequisitesNode,
          RepositoryImportEnrichmentChoiceNode,
          RepositoryImportEndNode,
          { provide: PrismaService, useValue: prisma },
          {
            provide: MessageService,
            useValue: {
              addMessageInTransaction: (
                tx: Prisma.TransactionClient,
                input: CreateMessageInput,
              ) =>
                tx.message.create({
                  data: {
                    conversationId,
                    projectId,
                    id: input.id,
                    type: input.type,
                    userId: input.userId ?? 'system',
                    status: input.status ?? MessageStatus.Open,
                    parentMessageId: input.parentMessageId,
                    data: input.data as Prisma.InputJsonValue,
                  },
                }),
            },
          },
          {
            provide: FlowSecurityService,
            useValue: { validateFlowExecution: jest.fn() },
          },
          {
            provide: ServiceService,
            useValue: { findAll: () => Promise.resolve([]) },
          },
          {
            provide: MachinePairingService,
            useValue: { listMachines: () => Promise.resolve([]) },
          },
          { provide: MachineExecutionReadinessService, useValue: {} },
          { provide: IntentDetectorService, useValue: null },
          { provide: PromptBuilderService, useValue: null },
          { provide: LLMClientService, useValue: null },
          { provide: JOB_ENQUEUER_TOKEN, useValue: null },
          { provide: 'APP_CONTEXT', useValue: {} },
        ],
      }).compile();

      try {
        const registry = module.get(NodeRegistry);
        registry.register(
          module.get(OnboardingRepositoryGroundingPrerequisitesNode),
        );
        registry.register(module.get(RepositoryImportEnrichmentChoiceNode));
        registry.register(module.get(RepositoryImportEndNode));
        module.get(NodeExecutionService).registerFlow(repositoryImportFlow);
        const runner = module.get(LocalRepositoryImportService);
        const fixture = createMockFlowContext({
          flowId: WorkflowName.RepositoryImport,
        });
        const context = {
          ...fixture,
          core: {
            ...fixture.core,
            workflowId: randomUUID() as typeof fixture.core.workflowId,
            organizationId,
            projectId,
            conversationId,
            workflowAboutId: projectId,
            workflowAboutType: 'project' as const,
            user: { ...fixture.core.user, id: userId },
          },
        };
        const recovered = await Promise.all([
          runner.recoverStart(context, userId),
          runner.recoverStart(context, userId),
        ]);
        expect(recovered.sort()).toEqual([false, true]);
        const execution = await prisma.db.flowExecution.findFirstOrThrow({
          where: { conversationId },
        });
        expect(
          await prisma.db.flowExecution.count({ where: { conversationId } }),
        ).toBe(1);
        expect(
          await prisma.db.message.count({ where: { conversationId } }),
        ).toBe(1);
        const state: unknown = execution.flowState;
        if (!isSerializableWorkflowState(state) || !state.lastSystemMessageId) {
          throw new Error('Expected a persisted local import form');
        }

        // Restore a checkpoint already past Feature creation. Deliver the same
        // admitted answer twice as the durable message outbox can do after a crash.
        const nodeId = REPOSITORY_IMPORT_NODES.ENRICHMENT_CHOICE;
        await prisma.db.flowExecution.update({
          where: { id: execution.id },
          data: {
            currentNode: nodeId,
            flowState: JSON.parse(
              JSON.stringify({
                ...state,
                currentNodeId: nodeId,
                nodeConfig: {
                  id: nodeId,
                  type: NodeType.QUESTIONS,
                  supportsPhases: false,
                },
              }),
            ),
          },
        });
        const answerId = randomUUID() as MessageId;
        const answer = createMockFlowUserMessage({
          id: answerId,
          conversationId,
          projectId,
          userId,
          parentMessageId: state.lastSystemMessageId,
          data: { repository_feature_enrichment_choice: 'SKIP' },
        });
        await prisma.db.message.create({
          data: {
            id: answerId,
            conversationId,
            projectId,
            userId,
            type: 'USER',
            parentMessageId: answer.parentMessageId,
            status: MessageStatus.Completed,
            data: answer.data as Prisma.InputJsonValue,
          },
        });
        await runner.advance(answer, organizationId, { nodeId });
        await runner.advance(answer, organizationId, { nodeId });
        expect(
          await prisma.db.flowExecution.findUnique({
            where: { id: execution.id },
          }),
        ).toMatchObject({
          currentNode: REPOSITORY_IMPORT_NODES.END,
          status: 'COMPLETED',
          resumable: false,
        });
        expect(
          await prisma.db.conversation.findUnique({
            where: { id: conversationId },
          }),
        ).toMatchObject({ status: 'COMPLETED' });
        expect(
          await prisma.db.message.count({ where: { conversationId } }),
        ).toBe(3);
      } finally {
        await prisma.db.message.deleteMany({ where: { conversationId } });
        await prisma.db.flowExecution.deleteMany({ where: { conversationId } });
        await prisma.db.organization.delete({ where: { id: organizationId } });
        await prisma.db.user.delete({ where: { id: userId } });
        await module.close();
      }
    }, 30_000);
  },
);
