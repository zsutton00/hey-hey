import { executeChild, log, workflowInfo } from '@temporalio/workflow';
import { WorkflowId } from 'src/types';
import {
  CategorySummarizationRunResult,
  SubfacetConsolidationRunResult,
  SubfacetSummarizationRunResult,
  TopologyScheduledConsolidationWorkflowInput,
  TopologyScheduledConsolidationWorkflowResult,
} from '../services/topology/consolidation.types';

function toChildWorkflowId(
  parentWorkflowId: WorkflowId,
  suffix: string,
): WorkflowId {
  return `${parentWorkflowId}-${suffix}` as WorkflowId;
}

export async function topologyScheduledConsolidationWorkflow(
  input: TopologyScheduledConsolidationWorkflowInput,
): Promise<TopologyScheduledConsolidationWorkflowResult> {
  const workflowId = workflowInfo().workflowId as WorkflowId;

  log.info('[topologyScheduledConsolidationWorkflow] starting', {
    workflowId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    since: input.since,
  });

  const subfacetSummarization = (await executeChild(
    'subfacetSummarizationWorkflow',
    {
      args: [
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          workflowAboutId: input.workflowAboutId,
          workflowAboutType: input.workflowAboutType,
          trigger: input.trigger,
          since: input.since,
          topologyConsolidationRunId: input.topologyConsolidationRunId,
          temporalWorkflowId: input.temporalWorkflowId,
          categories: input.categories,
          maxEntities: input.maxEntitiesPerSubfacetSummary,
        },
      ],
      workflowId: toChildWorkflowId(workflowId, 'subfacet-summary'),
      taskQueue: 'conversation-queue',
    },
  )) as SubfacetSummarizationRunResult;

  const subfacetConsolidation = (await executeChild(
    'subfacetConsolidationWorkflow',
    {
      args: [
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          workflowAboutId: input.workflowAboutId,
          workflowAboutType: input.workflowAboutType,
          trigger: input.trigger,
          since: input.since,
          topologyConsolidationRunId: input.topologyConsolidationRunId,
          temporalWorkflowId: input.temporalWorkflowId,
          categories: input.categories,
          threshold: input.threshold,
          maxIterations: input.maxIterations,
          maxEntitiesPerRun: input.maxEntitiesPerRun,
          maxEntitiesPerSubfacet: input.maxEntitiesPerSubfacet,
        },
      ],
      workflowId: toChildWorkflowId(workflowId, 'subfacet-consolidation'),
      taskQueue: 'conversation-queue',
    },
  )) as SubfacetConsolidationRunResult;

  const hasSubfacetUpdates = subfacetSummarization.subfacets.some(
    (result) => !!result.response && !result.error,
  );
  const hasConsolidationUpdates = subfacetConsolidation.categories.some(
    (result) =>
      !!result.response &&
      !result.error &&
      ((result.response as { triggered?: boolean }).triggered ?? true),
  );
  const hadUpstreamChanges = hasSubfacetUpdates || hasConsolidationUpdates;

  let categorySummarization:
    | TopologyScheduledConsolidationWorkflowResult['categorySummarization']
    | undefined;
  if (hadUpstreamChanges) {
    categorySummarization = (await executeChild(
      'categorySummarizationWorkflow',
      {
        args: [
          {
            organizationId: input.organizationId,
            projectId: input.projectId,
            workflowAboutId: input.workflowAboutId,
            workflowAboutType: input.workflowAboutType,
            trigger: input.trigger,
            since: input.since,
            topologyConsolidationRunId: input.topologyConsolidationRunId,
            temporalWorkflowId: input.temporalWorkflowId,
            categoryPromptMode: input.categoryPromptMode,
            maxSubfacetsInPrompt: input.maxSubfacetsInPrompt,
            changedEntitySamplePerSubfacet:
              input.changedEntitySamplePerSubfacet,
            categories: input.categories,
            maxPerCategory: input.maxPerCategory,
            maxPerSubfacet: input.maxPerSubfacet,
          },
        ],
        workflowId: toChildWorkflowId(workflowId, 'category-summary'),
        taskQueue: 'conversation-queue',
      },
    )) as CategorySummarizationRunResult;
  }

  log.info('[topologyScheduledConsolidationWorkflow] completed', {
    workflowId,
    hadUpstreamChanges,
    ranCategorySummarization: !!categorySummarization,
  });

  return {
    since: input.since,
    trigger: input.trigger,
    hadUpstreamChanges,
    ranCategorySummarization: !!categorySummarization,
    subfacetSummarization,
    subfacetConsolidation,
    categorySummarization,
  };
}
