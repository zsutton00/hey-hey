import { Test } from '@nestjs/testing';
import { FlowExecutionStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LocalOnboardingService } from '../local-onboarding.service';
import { NodeExecutionService } from '../node-execution.service';
import { NodeRegistry } from '../../../flows/nodes/node-registry.service';
import { OnboardingEndNode } from '../../../flows/nodes/onboarding/onboarding-end.node';
import { OnboardingFinalizeNode } from '../../../flows/nodes/onboarding/onboarding-finalize.node';
import { onboardingFlow } from '../../../flows/templates/onboarding.flow';
import { ONBOARDING_NODES } from '../../../flows/constants/node-ids';
import { FlowSecurityService } from '../flow-security.service';
import { IntentDetectorService } from '../../intent-detector.service';
import { MessageService } from '../../message.service';
import { PromptBuilderService } from '../../llm/prompt-builder.service';
import { LLMClientService } from '../../llm/llm-client.service';
import { OnboardingNextStepsService } from '../../onboarding-next-steps.service';
import { JOB_ENQUEUER_TOKEN } from '../../job.tokens';
import {
  SerializableWorkflowState,
  WorkflowPhase,
  WorkflowStep,
} from '../../../workflows/conversation-workflow-state';
import * as TestUtils from '../../../utils/testUtils';

// Real execution and node owners; only the database boundary is exercised as
// an in-memory store. Provider generation is covered at the CLI runner boundary.
describe('local onboarding durable completion', () => {
  it.each([
    ['existing work', ONBOARDING_NODES.END],
    ['reviewed discovery', ONBOARDING_NODES.FINALIZE],
  ])(
    'resumes %s completion once after activation, including a lost acknowledgement',
    async (_route, nodeId) => {
      const context = TestUtils.createMockFlowContext({ flowId: 'onboarding' });
      const state: SerializableWorkflowState = {
        executionOwner: 'CLI',
        step: WorkflowStep.WAITING_FOR_USER_INPUT,
        phase: WorkflowPhase.WAITING_FOR_USER,
        nodeConfig: { id: nodeId, type: 'questions', supportsPhases: false },
        iterations: 0,
        context,
        currentNodeId: nodeId,
        currentNodeExecutionId: undefined,
        lastSystemMessageId: undefined,
        lastUserMessageId: undefined,
        timestamp: new Date().toISOString(),
        version: 1,
      };
      // An existing-work reply has already selected the terminal node. Discovery
      // finishes through the existing button's committed ACTIVE project state.
      if (nodeId === ONBOARDING_NODES.END) {
        state.step = WorkflowStep.EXECUTING_AUTO_NODE;
      }
      const execution = {
        id: 'execution',
        status: FlowExecutionStatus.IN_PROGRESS,
        flowState: state,
        currentNode: nodeId,
        version: 1,
      };
      const session = {
        id: '4ba9c88b-617b-4ba6-9765-60f10e31e43c',
        machineId: '8e6e9c59-f092-4657-b096-8f66b59cd0ed',
      };
      const db = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        flowExecution: {
          findFirst: jest.fn(async () => structuredClone(execution)),
          update: jest.fn(async ({ data }) => {
            if (data.status) {
              execution.status = data.status;
            }
            if (data.flowState) {
              execution.flowState = structuredClone(data.flowState);
            }
            if (data.currentNode) {
              execution.currentNode = data.currentNode;
            }
            return structuredClone(execution);
          }),
        },
        agentSession: { findFirst: jest.fn(async () => session) },
        project: { findFirst: jest.fn(async () => ({ status: 'ACTIVE' })) },
        conversation: { update: jest.fn().mockResolvedValue({}) },
      };
      const prisma = {
        withTransaction: jest.fn(async (callback) => callback(db)),
        db: { $transaction: jest.fn(async (callback) => callback(db)) },
      };
      const module = await Test.createTestingModule({
        providers: [
          LocalOnboardingService,
          NodeExecutionService,
          NodeRegistry,
          OnboardingEndNode,
          OnboardingFinalizeNode,
          { provide: PrismaService, useValue: prisma },
          // These collaborators are not used when reconciling committed completion.
          ...[
            FlowSecurityService,
            IntentDetectorService,
            MessageService,
            PromptBuilderService,
            LLMClientService,
            OnboardingNextStepsService,
            JOB_ENQUEUER_TOKEN,
          ].map((provide) => ({ provide, useValue: null })),
          { provide: 'APP_CONTEXT', useValue: {} },
        ],
      }).compile();
      const registry = module.get(NodeRegistry);
      registry.register(module.get(OnboardingEndNode));
      registry.register(module.get(OnboardingFinalizeNode));
      module.get(NodeExecutionService).registerFlow(onboardingFlow);
      const service = module.get(LocalOnboardingService);
      const input = {
        organizationId: context.core.organizationId,
        projectId: context.core.projectId,
        conversationId: context.core.conversationId,
        userId: context.core.user.id,
        request: { agentSessionId: session.id },
      };
      await expect(service.advance(input)).resolves.toEqual({
        state: 'COMPLETED',
      });
      // Reconnect reads the committed execution, rather than repeating completion.
      await expect(service.advance(input)).resolves.toEqual({
        state: 'COMPLETED',
      });
      expect(db.conversation.update).toHaveBeenCalledTimes(1);
      expect(execution.status).toBe(FlowExecutionStatus.COMPLETED);
      await module.close();
    },
  );
});
