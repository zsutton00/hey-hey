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
import { SUGGESTED_DESIGN_DOC_NODES } from 'src/flows/constants';
import type * as activities from './activities';
import { LLMResponsePayload } from './conversation-workflow-state';
import {
  CreateSuggestedDesignDocRunResult,
  CreateSuggestedDesignDocWorkflowInput,
} from './create-suggested-design-doc.types';

const { startSuggestedDesignDocGenerationNode } = proxyActivities<
  typeof activities
>({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '5 seconds',
    maximumInterval: '1 minute',
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
});

export async function createSuggestedDesignDocWorkflow(
  input: CreateSuggestedDesignDocWorkflowInput,
): Promise<CreateSuggestedDesignDocRunResult> {
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

  log.info('[createSuggestedDesignDocWorkflow] starting', {
    workflowId,
    projectId: input.projectId,
    sourceConversationId: input.sourceConversationId,
    sourceMessageId: input.sourceMessageId,
  });

  const requestId = `create-suggested-design-doc-${input.sourceMessageId}-${workflowId}`;

  await startSuggestedDesignDocGenerationNode({
    job: input,
    workflowId,
    nodeId: SUGGESTED_DESIGN_DOC_NODES.GENERATE,
    flowId: 'create-suggested-design-doc',
    requestId,
  });

  await condition(() => responses.has(requestId));
  const payload = responses.get(requestId);
  responses.delete(requestId);

  let error: string | undefined;
  let designDocId: string | undefined;

  if (payload?.responseData) {
    const responseData = payload.responseData as {
      generatedDesignDocId?: string;
    };
    designDocId = responseData.generatedDesignDocId;
    log.info('[createSuggestedDesignDocWorkflow] received design doc', {
      designDocId,
    });
  } else {
    error = 'No response received';
    log.error('[createSuggestedDesignDocWorkflow] failed to receive response');
  }

  log.info('[createSuggestedDesignDocWorkflow] completed', {
    workflowId,
    error,
  });

  return {
    workflowId,
    designDocId,
    ...(error ? { error } : {}),
  };
}
