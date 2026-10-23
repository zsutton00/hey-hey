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
  SubfacetConsolidationJobInput,
  SubfacetConsolidationResult,
  SubfacetConsolidationRunResult,
} from '../services/topology/consolidation.types';
import type * as activities from './activities';
import { LLMResponsePayload } from './conversation-workflow-state';
import {
  buildConsolidationRequestId,
  resolveConsolidationCategories,
} from './utils/subfacet-consolidation.utils';
import { WorkflowId } from 'src/types';
import { applyContextPatch } from '../utils/mutable-context';

const DEFAULT_MAX_ITERATIONS = 3;
const MAX_ITERATIONS_CAP = 10;

const { startNonInteractiveNode, getLatestSubfacetConsolidationRun } =
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
  providedAudits: SubfacetConsolidationJobInput['auditByCategory'] | undefined,
): SubfacetConsolidationResult['previousAudit'] | undefined {
  if (!providedAudits) return undefined;
  if (Object.prototype.hasOwnProperty.call(providedAudits, category)) {
    return providedAudits[category] ?? null;
  }
  return undefined;
}

export async function subfacetConsolidationWorkflow(
  input: SubfacetConsolidationJobInput,
): Promise<SubfacetConsolidationRunResult> {
  const workflowId = workflowInfo().workflowId as WorkflowId;

  if (!input.organizationId) {
    throw new Error(
      '[subfacetConsolidationWorkflow] organizationId is required for consolidation runs',
    );
  }
  if (!input.projectId) {
    throw new Error(
      '[subfacetConsolidationWorkflow] projectId is required for consolidation runs',
    );
  }
  if (!input.since) {
    throw new Error(
      '[subfacetConsolidationWorkflow] since is required for consolidation runs',
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

  log.info('[subfacetConsolidationWorkflow] starting', {
    workflowId,
    organizationId: input.organizationId,
    trigger: input.trigger,
    workflowAboutId: input.workflowAboutId,
    workflowAboutType: input.workflowAboutType,
    categories: input.categories,
  });

  const categories = resolveConsolidationCategories(input.categories);
  const results: SubfacetConsolidationResult[] = [];
  const maxIterations = Math.min(
    Math.max(input.maxIterations ?? DEFAULT_MAX_ITERATIONS, 1),
    MAX_ITERATIONS_CAP,
  );

  for (const [index, category] of categories.entries()) {
    const contextState: {
      processedSubfacets: string[];
      hasMoreSubfacets?: boolean;
    } = {
      processedSubfacets: [],
    };
    let iteration = 0;
    let lastResponse: SubfacetConsolidationResult['response'] | undefined;
    let lastError: string | undefined;
    let lastRequestId: string | undefined;

    const providedAudit = resolveAuditHint(category, input.auditByCategory);
    const fetchedAudit =
      providedAudit === undefined
        ? await getLatestSubfacetConsolidationRun({
            organizationId: input.organizationId,
            projectId: input.projectId,
            category,
          })
        : providedAudit;
    const threshold = input.threshold;

    // Loop until no merges/triggered or maxIterations reached
    while (iteration < maxIterations) {
      const requestId = buildConsolidationRequestId(
        workflowId,
        `${category}`,
        `${index}-${iteration}`,
      );
      lastRequestId = requestId;

      await startNonInteractiveNode({
        job: input,
        workflowId,
        nodeId: TOPOLOGY_NODES.CONSOLIDATION,
        metadata: {
          workflowAboutId: input.workflowAboutId ?? input.projectId,
          workflowAboutType: input.workflowAboutType,
        },
        flowId: 'topology-consolidation',
        requestId,
        contextOverrides: {
          topologyConsolidationRunId: input.topologyConsolidationRunId,
          temporalWorkflowId: input.temporalWorkflowId,
          auditRequestId: requestId,
          consolidationCategory: category,
          consolidationSince: input.since,
          ...(threshold ? { consolidationThreshold: threshold } : {}),
          // Only pass previousAudit on the first iteration to avoid gate suppression on follow-ups
          ...(iteration === 0 && fetchedAudit
            ? { previousAudit: fetchedAudit }
            : {}),
          processedSubfacets: Array.from(contextState.processedSubfacets),
          ...(input.maxEntitiesPerRun
            ? { maxEntitiesPerRun: input.maxEntitiesPerRun }
            : {}),
          ...(input.maxEntitiesPerSubfacet
            ? { maxEntitiesPerSubfacet: input.maxEntitiesPerSubfacet }
            : {}),
        },
      });

      await condition(() => responses.has(requestId));
      const payload = responses.get(requestId);
      responses.delete(requestId);

      if (!payload?.responseData) {
        lastError = 'No response received';
        break;
      }

      if (payload.contextUpdates) {
        applyContextPatch(contextState, payload.contextUpdates);
      }

      const responseData =
        payload.responseData as unknown as SubfacetConsolidationResult['response'];
      lastResponse = responseData;

      const hasMoreSubfacets = contextState.hasMoreSubfacets === true;

      iteration += 1;

      if (!(iteration < maxIterations && hasMoreSubfacets)) {
        break;
      }
    }

    results.push({
      category,
      requestId:
        lastRequestId ??
        buildConsolidationRequestId(workflowId, category, index),
      response: lastResponse,
      error: lastError,
      previousAudit: fetchedAudit,
    });
  }

  log.info('[subfacetConsolidationWorkflow] completed', {
    workflowId,
    categoryCount: categories.length,
  });

  return {
    trigger: input.trigger,
    since: input.since,
    categories: results,
  };
}
