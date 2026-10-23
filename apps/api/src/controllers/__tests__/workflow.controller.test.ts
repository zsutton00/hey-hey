import { NotFoundException } from '@nestjs/common';
import { LocalPromptType } from '../../generated/local';
import { WorkflowController } from '../workflow.controller';
import type {
  ConversationId,
  OrganizationId,
  ProjectId,
  WorkflowId,
} from '../../types';
import { PromptTypeResponseDto, WorkflowName } from '../../generated';

const WorkflowState = PromptTypeResponseDto.WorkflowStateEnum;

const ORG_ID = 'org-1' as OrganizationId;
const PROJECT_ID = 'project-1' as ProjectId;
const CONVERSATION_ID = 'conv-1' as ConversationId;
const WORKFLOW_ID = 'wf-1' as WorkflowId;

function buildController(options: {
  conversation: unknown;
  query?: jest.Mock;
  resolveConversationPromptType?: jest.Mock;
}) {
  const findFirst = jest.fn().mockResolvedValue(options.conversation);

  const prisma = {
    db: { conversation: { findFirst } },
  };

  const handle = {
    query: options.query ?? jest.fn(),
  };

  const temporalClient = {
    workflow: {
      getHandle: jest.fn().mockReturnValue(handle),
    },
  };

  const flowExecutionService = {
    resolveConversationPromptType:
      options.resolveConversationPromptType ??
      jest.fn().mockResolvedValue({
        workflowState: WorkflowState.Terminal,
        promptType: null,
        nodeId: null,
        triggerMessageId: null,
      }),
  };

  const controller = new WorkflowController(
    {} as any,
    prisma as any,
    flowExecutionService as any,
    temporalClient as any,
  );

  return {
    controller,
    prisma,
    temporalClient,
    handle,
    findFirst,
    flowExecutionService,
  };
}

describe('WorkflowController.getConversationWorkflowNode', () => {
  it('returns the live currentNodeId and workflowName for a running workflow', async () => {
    const { controller, temporalClient, handle, findFirst } = buildController({
      conversation: {
        id: CONVERSATION_ID,
        workflowId: WORKFLOW_ID,
        workflowName: 'feature-sync',
      },
      query: jest.fn().mockResolvedValue({
        isComplete: false,
        currentNodeId: 'FeatureSyncAnalyze',
      }),
    });

    const result = await controller.getConversationWorkflowNode(
      ORG_ID,
      PROJECT_ID,
      CONVERSATION_ID,
    );

    expect(result).toEqual({
      currentNodeId: 'FeatureSyncAnalyze',
      workflowName: 'feature-sync',
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: CONVERSATION_ID,
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
      },
      select: { id: true, workflowId: true, workflowName: true },
    });
    expect(temporalClient.workflow.getHandle).toHaveBeenCalledWith(WORKFLOW_ID);
    expect(handle.query).toHaveBeenCalledTimes(1);
  });

  it('returns null currentNodeId (and the preserved workflowName) when the workflow has gracefully completed', async () => {
    const { controller } = buildController({
      conversation: {
        id: CONVERSATION_ID,
        workflowId: WORKFLOW_ID,
        workflowName: 'feature-sync',
      },
      query: jest.fn().mockResolvedValue({
        isComplete: true,
        currentNodeId: 'TerminalNode',
      }),
    });

    const result = await controller.getConversationWorkflowNode(
      ORG_ID,
      PROJECT_ID,
      CONVERSATION_ID,
    );

    expect(result).toEqual({
      currentNodeId: null,
      workflowName: 'feature-sync',
    });
  });

  it('returns fully-null payload when the conversation has no workflow attached', async () => {
    const { controller, temporalClient } = buildController({
      conversation: {
        id: CONVERSATION_ID,
        workflowId: null,
        workflowName: null,
      },
    });

    const result = await controller.getConversationWorkflowNode(
      ORG_ID,
      PROJECT_ID,
      CONVERSATION_ID,
    );

    expect(result).toEqual({ currentNodeId: null, workflowName: null });
    expect(temporalClient.workflow.getHandle).not.toHaveBeenCalled();
  });

  it('returns null currentNodeId when the Temporal workflow has been reaped (WorkflowNotFoundError)', async () => {
    const error = Object.assign(new Error('workflow not found'), {
      name: 'WorkflowNotFoundError',
    });

    const { controller } = buildController({
      conversation: {
        id: CONVERSATION_ID,
        workflowId: WORKFLOW_ID,
        workflowName: 'feature-sync',
      },
      query: jest.fn().mockRejectedValue(error),
    });

    const result = await controller.getConversationWorkflowNode(
      ORG_ID,
      PROJECT_ID,
      CONVERSATION_ID,
    );

    expect(result).toEqual({
      currentNodeId: null,
      workflowName: 'feature-sync',
    });
  });

  it('returns null currentNodeId when Temporal reports the workflow execution already completed', async () => {
    const error = new Error(
      'workflow execution already completed: cannot query',
    );

    const { controller } = buildController({
      conversation: {
        id: CONVERSATION_ID,
        workflowId: WORKFLOW_ID,
        workflowName: 'feature-sync',
      },
      query: jest.fn().mockRejectedValue(error),
    });

    const result = await controller.getConversationWorkflowNode(
      ORG_ID,
      PROJECT_ID,
      CONVERSATION_ID,
    );

    expect(result).toEqual({
      currentNodeId: null,
      workflowName: 'feature-sync',
    });
  });

  it('rethrows unexpected Temporal errors instead of silently coercing to null', async () => {
    const error = Object.assign(new Error('query handler not registered'), {
      name: 'QueryNotRegisteredError',
    });

    const { controller } = buildController({
      conversation: {
        id: CONVERSATION_ID,
        workflowId: WORKFLOW_ID,
        workflowName: 'feature-sync',
      },
      query: jest.fn().mockRejectedValue(error),
    });

    await expect(
      controller.getConversationWorkflowNode(
        ORG_ID,
        PROJECT_ID,
        CONVERSATION_ID,
      ),
    ).rejects.toBe(error);
  });

  it('throws NotFoundException when the conversation does not exist', async () => {
    const { controller } = buildController({ conversation: null });

    await expect(
      controller.getConversationWorkflowNode(
        ORG_ID,
        PROJECT_ID,
        CONVERSATION_ID,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('WorkflowController.getConversationPromptType', () => {
  it('forwards workflowState=agent-pending verdicts from the resolver verbatim', async () => {
    const serviceResult = {
      workflowState: WorkflowState.AgentPending,
      promptType: LocalPromptType.feature_sync_analyze,
      nodeId: 'FeatureSyncAnalyze',
      triggerMessageId: 'trigger-msg-1',
    };
    const resolveConversationPromptType = jest
      .fn()
      .mockResolvedValue(serviceResult);

    const { controller, flowExecutionService } = buildController({
      conversation: {
        id: CONVERSATION_ID,
        workflowId: WORKFLOW_ID,
        workflowName: WorkflowName.Adr,
      },
      resolveConversationPromptType,
    });

    const result = await controller.getConversationPromptType(
      ORG_ID,
      PROJECT_ID,
      CONVERSATION_ID,
    );

    expect(result).toEqual(serviceResult);
    expect(
      flowExecutionService.resolveConversationPromptType,
    ).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      workflowId: WORKFLOW_ID,
      workflowName: WorkflowName.Adr,
      organizationId: ORG_ID,
    });
  });

  it('forwards workflowState=live-non-agent verdicts (plan-from-design-doc parked on a QUESTIONS gate) verbatim', async () => {
    const serviceResult = {
      workflowState: WorkflowState.LiveNonAgent,
      promptType: LocalPromptType.implement,
      nodeId: null,
      triggerMessageId: null,
    };
    const resolveConversationPromptType = jest
      .fn()
      .mockResolvedValue(serviceResult);

    const { controller } = buildController({
      conversation: {
        id: CONVERSATION_ID,
        workflowId: WORKFLOW_ID,
        workflowName: WorkflowName.Adr,
      },
      resolveConversationPromptType,
    });

    const result = await controller.getConversationPromptType(
      ORG_ID,
      PROJECT_ID,
      CONVERSATION_ID,
    );

    expect(result).toEqual(serviceResult);
    expect(result.workflowState).toBe(WorkflowState.LiveNonAgent);
  });

  it('forwards workflowState=terminal verdicts verbatim', async () => {
    const serviceResult = {
      workflowState: WorkflowState.Terminal,
      promptType: LocalPromptType.implement,
      nodeId: null,
      triggerMessageId: null,
    };
    const resolveConversationPromptType = jest
      .fn()
      .mockResolvedValue(serviceResult);

    const { controller } = buildController({
      conversation: {
        id: CONVERSATION_ID,
        workflowId: WORKFLOW_ID,
        workflowName: WorkflowName.Adr,
      },
      resolveConversationPromptType,
    });

    const result = await controller.getConversationPromptType(
      ORG_ID,
      PROJECT_ID,
      CONVERSATION_ID,
    );

    expect(result).toEqual(serviceResult);
    expect(result.workflowState).toBe(WorkflowState.Terminal);
  });

  it('throws NotFoundException when the conversation does not exist', async () => {
    const { controller } = buildController({ conversation: null });

    await expect(
      controller.getConversationPromptType(ORG_ID, PROJECT_ID, CONVERSATION_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('passes null workflowId and workflowName for conversations with no workflow', async () => {
    const resolveConversationPromptType = jest.fn().mockResolvedValue({
      workflowState: WorkflowState.Terminal,
      promptType: null,
      nodeId: null,
      triggerMessageId: null,
    });

    const { controller } = buildController({
      conversation: {
        id: CONVERSATION_ID,
        workflowId: null,
        workflowName: null,
      },
      resolveConversationPromptType,
    });

    await controller.getConversationPromptType(
      ORG_ID,
      PROJECT_ID,
      CONVERSATION_ID,
    );

    expect(resolveConversationPromptType).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      workflowId: null,
      workflowName: null,
      organizationId: ORG_ID,
    });
  });
});
