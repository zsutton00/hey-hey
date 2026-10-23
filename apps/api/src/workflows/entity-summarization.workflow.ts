import {
  condition,
  defineSignal,
  log,
  patched,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import { WorkflowId } from 'src/types';
import { WorkflowSignals } from 'src/utils/workflow-signals.util';
import { ENTITY_SUMMARIZATION_NODES } from '../flows/constants/node-ids';
import {
  SummarizationJobInput,
  SummarizationRunResult,
} from '../services/summarization/summarization.types';
import type * as activities from './activities';
import { LLMResponsePayload } from './conversation-workflow-state';

const ENTITY_SUMMARIZATION_DISABLED_PATCH_ID =
  'disable-entity-summarization-2026-07-26';

const { startNonInteractiveNode } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '5 seconds',
    maximumInterval: '1 minute',
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
});

export async function entitySummarizationWorkflow(
  input: SummarizationJobInput,
): Promise<SummarizationRunResult> {
  // New executions stop here. Executions whose histories predate this patch
  // continue through the legacy branch so replay remains deterministic while
  // the old worker code is retained during the drain period.
  if (patched(ENTITY_SUMMARIZATION_DISABLED_PATCH_ID)) {
    log.info('[entitySummarizationWorkflow] disabled');
    return {
      trigger: input.trigger,
      since: input.since,
    };
  }

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

  log.info('[entitySummarizationWorkflow] starting', {
    workflowId,
    trigger: input.trigger,
    workflowAboutId: input.workflowAboutId,
    workflowAboutType: input.workflowAboutType,
  });

  const requestId = `entity-summary-${input.workflowAboutId}-${workflowId}`;

  await startNonInteractiveNode({
    job: input,
    workflowId,
    nodeId: ENTITY_SUMMARIZATION_NODES.SUMMARIZE,
    metadata: {
      workflowAboutId: input.workflowAboutId,
      workflowAboutType: input.workflowAboutType,
    },
    flowId: 'entity-summarization',
    requestId,
  });

  await condition(() => responses.has(requestId));
  const payload = responses.get(requestId);
  responses.delete(requestId);

  let error: string | undefined;

  if (payload?.responseData) {
    log.info('[entitySummarizationWorkflow] received summary', {
      summary: payload.responseData,
    });
  } else {
    error = 'No response received';
    log.error('[entitySummarizationWorkflow] failed to receive summary');
  }

  log.info('[entitySummarizationWorkflow] completed', {
    workflowId,
    error,
  });

  return {
    trigger: input.trigger,
    since: input.since,
  };
}
