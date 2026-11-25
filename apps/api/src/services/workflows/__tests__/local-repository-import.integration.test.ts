import { Test } from '@nestjs/testing';
import { FlowExecutionStatus } from '@prisma/client';
import { ConversationStatus } from '../../../generated';
import { PrismaService } from '../../../prisma/prisma.service';
import { LocalRepositoryImportService } from '../local-repository-import.service';
import { NodeExecutionService } from '../node-execution.service';
import { NodeRegistry } from '../../../flows/nodes/node-registry.service';
import { OnboardingRepositoryGroundingPrerequisitesNode } from '../../../flows/nodes/onboarding/repository-grounding-prerequisites.node';
import { repositoryImportFlow } from '../../../flows/templates/repository-import.flow';
import { REPOSITORY_IMPORT_NODES } from '../../../flows/constants/node-ids';
import { FlowSecurityService } from '../flow-security.service';
import { IntentDetectorService } from '../../intent-detector.service';
import { MessageService } from '../../message.service';
import { ServiceService } from '../../service/service.service';
import { MachinePairingService } from '../../machine-pairing/machine-pairing.service';
import { MachineExecutionReadinessService } from '../../machine-pairing/machine-execution-readiness.service';
import { JOB_ENQUEUER_TOKEN } from '../../job.tokens';
import { PromptBuilderService } from '../../llm/prompt-builder.service';
import { LLMClientService } from '../../llm/llm-client.service';
import { isSerializableWorkflowState } from '../../../workflows/conversation-workflow-state';
import * as TestUtils from '../../../utils/testUtils';

// Real runner, flow template and readiness step. The database and the
// message store are in-memory stand-ins at the persistence boundary.
describe('local repository import start', () => {
  it('saves a CLI-owned execution and shows the readiness form in one transaction', async () => {
    let saved: Record<string, unknown> = {};
    const messages: Array<{ id: string; data: { nodeId?: string } }> = [];
    const conversationUpdate = jest.fn().mockResolvedValue({});
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      flowExecution: {
        create: jest.fn(async ({ data }) => {
          saved = structuredClone({ id: 'execution', version: 1, ...data });
          return saved;
        }),
        findFirst: jest.fn(async () => structuredClone(saved)),
        update: jest.fn(async ({ data }) => {
          saved.currentNode = data.currentNode;
          saved.flowState = structuredClone(data.flowState);
          return structuredClone(saved);
        }),
      },
      conversation: {
        update: conversationUpdate,
        findUnique: jest
          .fn()
          .mockResolvedValue({ workflowName: 'repository-import' }),
      },
    };
    const transaction = jest.fn(async (work) => work(db));
    const addMessageInTransaction = jest.fn(async (_tx, message) => {
      const row = { id: `message-${messages.length + 1}`, data: message.data };
      messages.push(row);
      return row;
    });

    const module = await Test.createTestingModule({
      providers: [
        LocalRepositoryImportService,
        NodeExecutionService,
        NodeRegistry,
        OnboardingRepositoryGroundingPrerequisitesNode,
        { provide: PrismaService, useValue: { withTransaction: transaction } },
        { provide: MessageService, useValue: { addMessageInTransaction } },
        {
          provide: FlowSecurityService,
          useValue: { validateFlowExecution: jest.fn() },
        },
        {
          provide: ServiceService,
          useValue: { findAll: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: MachinePairingService,
          useValue: { listMachines: jest.fn().mockResolvedValue([]) },
        },
        { provide: MachineExecutionReadinessService, useValue: {} },
        { provide: IntentDetectorService, useValue: null },
        { provide: PromptBuilderService, useValue: null },
        { provide: LLMClientService, useValue: null },
        { provide: JOB_ENQUEUER_TOKEN, useValue: null },
        { provide: 'APP_CONTEXT', useValue: {} },
      ],
    }).compile();
    module
      .get(NodeRegistry)
      .register(module.get(OnboardingRepositoryGroundingPrerequisitesNode));
    module.get(NodeExecutionService).registerFlow(repositoryImportFlow);

    const context = TestUtils.createMockFlowContext({
      flowId: 'repository-import',
    });
    const progress = await module
      .get(LocalRepositoryImportService)
      .begin({ context, userId: context.core.user.id });

    expect(progress).toBe('WAITING_FOR_USER');
    expect(transaction).toHaveBeenCalledTimes(1);

    // The launching user owns the execution: Agent Session binding requires it.
    expect(saved).toMatchObject({
      userId: context.core.user.id,
      flowId: 'repository-import',
      conversationId: context.core.conversationId,
      status: FlowExecutionStatus.IN_PROGRESS,
      currentNode: REPOSITORY_IMPORT_NODES.PREREQUISITES,
      resumable: true,
    });
    const state = saved.flowState;
    if (!isSerializableWorkflowState(state)) {
      throw new Error('Expected a canonical saved import state');
    }
    expect(state.executionOwner).toBe('CLI');
    expect(state.step).toBe('waiting_for_user_input');

    // Replies are admitted against this form as the current node's message.
    expect(messages).toHaveLength(1);
    const [form] = messages;
    if (!form) {
      throw new Error('Expected the readiness form');
    }
    expect(form.data.nodeId).toBe(REPOSITORY_IMPORT_NODES.PREREQUISITES);
    expect(state.lastSystemMessageId).toBe(form.id);
    expect(conversationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: ConversationStatus.InProgress },
      }),
    );

    await module.close();
  });
});
