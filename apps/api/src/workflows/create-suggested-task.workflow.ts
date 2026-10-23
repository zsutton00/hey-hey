import {
  condition,
  defineSignal,
  log,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import { WorkflowId } from 'src/types';
import { WorkflowSignals } from 'src/utils/workflow-signals.util';
import { SUGGESTED_TASK_NODES } from 'src/flows/constants';
import type * as activities from './activities';
import { LLMResponsePayload } from './conversation-workflow-state';
import {
  CreateSuggestedTaskRunResult,
  CreateSuggestedTaskWorkflowInput,
} from './create-suggested-task.types';

const { startSuggestedTaskGenerationNode } = proxyActivities<typeof activities>(
  {
    startToCloseTimeout: '5 minutes',
    retry: {
      initialInterval: '5 seconds',
      maximumInterval: '1 minute',
      backoffCoefficient: 2,
      maximumAttempts: 5,
    },
  },
);

export async function createSuggestedTaskWorkflow(
  input: CreateSuggestedTaskWorkflowInput,
): Promise<CreateSuggestedTaskRunResult> {
  const workflowId = workflowInfo().workflowId as WorkflowId;
  const responses = new Map<string, LLMResponsePayload>();

  const setLLMResponse = defineSignal<[LLMResponsePayload]>(
    WorkflowSignals.getLLMResponseSignalName(workflowId),
  );

  setHandler(setLLMResponse, (payload: LLMResponsePayload) => {
    if (payload?.requestId) {
      responses.set(payload.requestId, payload);
    }
  });

  log.info('[createSuggestedTaskWorkflow] starting', {
    workflowId,
    projectId: input.projectId,
    sourceConversationId: input.sourceConversationId,
    sourceMessageId: input.sourceMessageId,
  });

  const requestId = `create-suggested-task-${input.sourceMessageId}-${workflowId}`;

  await startSuggestedTaskGenerationNode({
    job: input,
    workflowId,
    nodeId: SUGGESTED_TASK_NODES.GENERATE,
    flowId: 'create-suggested-task',
    requestId,
  });

  await condition(() => responses.has(requestId));
  const payload = responses.get(requestId);
  responses.delete(requestId);

  let error: string | undefined;
  let taskIds: string[] | undefined;

  if (payload?.responseData) {
    const responseData = payload.responseData as {
      generatedTaskIds?: string[];
    };
    taskIds = responseData.generatedTaskIds;
    log.info('[createSuggestedTaskWorkflow] received task generation', {
      taskIds,
    });
  } else {
    error = 'No response received';
    log.error('[createSuggestedTaskWorkflow] failed to receive response');
  }

  log.info('[createSuggestedTaskWorkflow] completed', {
    workflowId,
    error,
  });

  return {
    workflowId,
    taskIds,
    ...(error ? { error } : {}),
  };
}
