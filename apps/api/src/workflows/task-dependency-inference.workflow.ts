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
import { TASK_DEPENDENCY_INFERENCE_NODES } from 'src/flows/constants';
import type * as activities from './activities';
import { LLMResponsePayload } from './conversation-workflow-state';
import {
  TaskDependencyInferenceRunResult,
  TaskDependencyInferenceWorkflowInput,
} from './task-dependency-inference.types';

const { startTaskDependencyInferenceNode } = proxyActivities<typeof activities>(
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

export async function taskDependencyInferenceWorkflow(
  input: TaskDependencyInferenceWorkflowInput,
): Promise<TaskDependencyInferenceRunResult> {
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

  log.info('[taskDependencyInferenceWorkflow] starting', {
    workflowId,
    initiativeId: input.initiativeId,
    projectId: input.projectId,
    targetTaskCount: input.targetTaskIds.length,
  });

  const requestId = `task-dependency-inference-${input.initiativeId}-${workflowId}`;

  await startTaskDependencyInferenceNode({
    job: input,
    workflowId,
    nodeId: TASK_DEPENDENCY_INFERENCE_NODES.GENERATE,
    flowId: 'task-dependency-inference',
    requestId,
  });

  await condition(() => responses.has(requestId));
  const payload = responses.get(requestId);
  responses.delete(requestId);

  let error: string | undefined;
  let inferredCount: number | undefined;

  if (payload?.responseData) {
    const responseData = payload.responseData as { dependencies?: unknown[] };
    inferredCount = responseData.dependencies?.length ?? 0;
    log.info('[taskDependencyInferenceWorkflow] received inference', {
      inferredCount,
    });
  } else {
    error = 'No response received';
    log.error('[taskDependencyInferenceWorkflow] failed to receive response');
  }

  log.info('[taskDependencyInferenceWorkflow] completed', {
    workflowId,
    error,
  });

  return {
    workflowId,
    inferredCount,
    ...(error ? { error } : {}),
  };
}
