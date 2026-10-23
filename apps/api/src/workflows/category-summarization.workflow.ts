import {
  condition,
  defineSignal,
  log,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import { SummaryCategory } from '@prisma/client';
import { TOPOLOGY_NODES } from 'src/flows/constants';
import { WorkflowSignals } from 'src/utils/workflow-signals.util';
import {
  CategorySummarizationJobInput,
  CategorySummarizationResult,
  CategorySummarizationRunResult,
} from '../services/topology/consolidation.types';
import type * as activities from './activities';
import { LLMResponsePayload } from './conversation-workflow-state';
import {
  buildCategorySummarizationRequestId,
  resolveConsolidationCategories,
} from './utils/subfacet-consolidation.utils';
import { WorkflowId } from 'src/types';

const { startNonInteractiveNode, getLatestCategorySummarizationRun } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: '5 minutes',
    retry: {
      initialInterval: '5 seconds',
      maximumInterval: '1 minute',
      backoffCoefficient: 2,
      maximumAttempts: 5,
    },
  });

function resolveAuditHint(
  category: SummaryCategory,
  providedAudits: CategorySummarizationJobInput['auditByCategory'] | undefined,
): CategorySummarizationResult['previousAudit'] | undefined {
  if (!providedAudits) return undefined;
  if (Object.prototype.hasOwnProperty.call(providedAudits, category)) {
    return providedAudits[category] ?? null;
  }
  return undefined;
}

export async function categorySummarizationWorkflow(
  input: CategorySummarizationJobInput,
): Promise<CategorySummarizationRunResult> {
  const workflowId = workflowInfo().workflowId as WorkflowId;

  if (!input.organizationId) {
    throw new Error(
      '[categorySummarizationWorkflow] organizationId is required for summarization runs',
    );
  }
  if (!input.projectId) {
    throw new Error(
      '[categorySummarizationWorkflow] projectId is required for summarization runs',
    );
  }
  if (!input.since) {
    throw new Error(
      '[categorySummarizationWorkflow] since is required for summarization runs',
    );
  }

  const responses = new Map<string, LLMResponsePayload>();
  const setLLMResponse = defineSignal<[LLMResponsePayload]>(
    WorkflowSignals.getLLMResponseSignalName(workflowId),
  );

  setHandler(setLLMResponse, (payload: LLMResponsePayload) => {
    if (payload?.requestId) {
      responses.set(payload.requestId, payload);
    }
  });

  log.info('[categorySummarizationWorkflow] starting', {
    workflowId,
    organizationId: input.organizationId,
    trigger: input.trigger,
    workflowAboutId: input.workflowAboutId,
    workflowAboutType: input.workflowAboutType,
    categories: input.categories,
  });

  const categories = resolveConsolidationCategories(input.categories);
  const results: CategorySummarizationResult[] = [];

  for (const [index, category] of categories.entries()) {
    const requestId = buildCategorySummarizationRequestId(
      workflowId,
      category,
      index,
    );
    const providedAudit = resolveAuditHint(category, input.auditByCategory);
    const previousAudit =
      providedAudit === undefined
        ? await getLatestCategorySummarizationRun({
            organizationId: input.organizationId,
            projectId: input.projectId,
            category,
          })
        : providedAudit;

    await startNonInteractiveNode({
      job: input,
      workflowId,
      nodeId: TOPOLOGY_NODES.CATEGORY_CONSOLIDATION,
      metadata: {
        workflowAboutId: input.workflowAboutId ?? input.projectId,
        workflowAboutType: input.workflowAboutType,
      },
      flowId: 'topology-category-summarization',
      requestId,
      contextOverrides: {
        topologyConsolidationRunId: input.topologyConsolidationRunId,
        temporalWorkflowId: input.temporalWorkflowId,
        auditRequestId: requestId,
        summarizationCategory: category,
        summarizationSince: input.since,
        categoryPromptMode: input.categoryPromptMode,
        maxSubfacetsInPrompt: input.maxSubfacetsInPrompt,
        changedEntitySamplePerSubfacet: input.changedEntitySamplePerSubfacet,
        ...(input.maxPerCategory
          ? { maxPerCategory: input.maxPerCategory }
          : {}),
        ...(input.maxPerSubfacet
          ? { maxPerSubfacet: input.maxPerSubfacet }
          : {}),
        ...(previousAudit ? { previousAudit } : {}),
      },
    });

    await condition(() => responses.has(requestId));
    const payload = responses.get(requestId);
    responses.delete(requestId);

    if (payload?.responseData) {
      results.push({
        category,
        requestId,
        response:
          payload.responseData as unknown as CategorySummarizationResult['response'],
        previousAudit,
      });
    } else {
      results.push({
        category,
        requestId,
        error: 'No response received',
        previousAudit,
      });
    }
  }

  log.info('[categorySummarizationWorkflow] completed', {
    workflowId,
    categoryCount: categories.length,
  });

  return {
    trigger: input.trigger,
    since: input.since,
    categories: results,
  };
}
