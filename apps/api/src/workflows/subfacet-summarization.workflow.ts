import {
  condition,
  defineSignal,
  log,
  patched,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import { TOPOLOGY_NODES } from 'src/flows/constants';
import { WorkflowSignals } from 'src/utils/workflow-signals.util';
import {
  SubfacetSummarizationJobInput,
  SubfacetSummarizationResult,
  SubfacetSummarizationRunResult,
} from '../services/topology/consolidation.types';
import type * as activities from './activities';
import { LLMResponsePayload } from './conversation-workflow-state';
import { buildSubfacetSummarizationRequestId } from './utils/subfacet-consolidation.utils';
import { WorkflowId } from 'src/types';

const {
  startNonInteractiveNode,
  getLatestSubfacetSummarizationRun,
  listSummarizableSubfacets,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '5 seconds',
    maximumInterval: '1 minute',
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
});

const SUBFACET_SUMMARIZABLE_SINCE_PATCH_ID =
  'subfacet-summarization-list-since-v1';

function resolveAuditHint(
  subfacetId: string,
  providedAudits: SubfacetSummarizationJobInput['auditBySubfacet'] | undefined,
) {
  if (!providedAudits) return undefined;
  if (Object.prototype.hasOwnProperty.call(providedAudits, subfacetId)) {
    return providedAudits[subfacetId] ?? null;
  }
  return undefined;
}

export async function subfacetSummarizationWorkflow(
  input: SubfacetSummarizationJobInput,
): Promise<SubfacetSummarizationRunResult> {
  const workflowId = workflowInfo().workflowId as WorkflowId;

  if (!input.organizationId) {
    throw new Error(
      '[subfacetSummarizationWorkflow] organizationId is required for summarization runs',
    );
  }
  if (!input.projectId) {
    throw new Error(
      '[subfacetSummarizationWorkflow] projectId is required for summarization runs',
    );
  }
  if (!input.since) {
    throw new Error(
      '[subfacetSummarizationWorkflow] since is required for summarization runs',
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

  log.info('[subfacetSummarizationWorkflow] starting', {
    workflowId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    trigger: input.trigger,
    workflowAboutId: input.workflowAboutId,
    workflowAboutType: input.workflowAboutType,
    categories: input.categories,
    subfacetIds: input.subfacetIds,
  });

  const useSincePrefilter = patched(SUBFACET_SUMMARIZABLE_SINCE_PATCH_ID);
  const subfacets = await (useSincePrefilter
    ? listSummarizableSubfacets({
        organizationId: input.organizationId,
        projectId: input.projectId,
        categories: input.categories,
        subfacetIds: input.subfacetIds,
        since: input.since,
      })
    : listSummarizableSubfacets({
        organizationId: input.organizationId,
        projectId: input.projectId,
        categories: input.categories,
        subfacetIds: input.subfacetIds,
      }));

  const processedSubfacetIds = new Set<string>();
  const results: SubfacetSummarizationResult[] = [];

  for (const [index, subfacet] of subfacets.entries()) {
    if (processedSubfacetIds.has(subfacet.id)) {
      continue;
    }

    const requestId = buildSubfacetSummarizationRequestId(
      workflowId,
      subfacet.slug,
      index,
    );
    const providedAudit = resolveAuditHint(subfacet.id, input.auditBySubfacet);
    const previousAudit =
      providedAudit === undefined
        ? await getLatestSubfacetSummarizationRun({
            organizationId: input.organizationId,
            projectId: input.projectId,
            category: subfacet.category,
            subfacetId: subfacet.id,
          })
        : providedAudit;

    await startNonInteractiveNode({
      job: input,
      workflowId,
      nodeId: TOPOLOGY_NODES.SUBFACET_SUMMARIZATION,
      metadata: {
        workflowAboutId: input.workflowAboutId ?? input.projectId,
        workflowAboutType: input.workflowAboutType,
      },
      flowId: 'topology-subfacet-summarization',
      requestId,
      contextOverrides: {
        topologyConsolidationRunId: input.topologyConsolidationRunId,
        temporalWorkflowId: input.temporalWorkflowId,
        auditRequestId: requestId,
        subfacetId: subfacet.id,
        subfacetName: subfacet.name,
        subfacetSlug: subfacet.slug,
        summarizationCategory: subfacet.category,
        summarizationSince: input.since,
        ...(input.maxEntities ? { maxEntities: input.maxEntities } : {}),
        processedSubfacetIds: Array.from(processedSubfacetIds),
      },
    });

    await condition(() => responses.has(requestId));
    const payload = responses.get(requestId);
    responses.delete(requestId);
    processedSubfacetIds.add(subfacet.id);

    if (payload?.responseData) {
      results.push({
        subfacetId: subfacet.id,
        subfacetSlug: subfacet.slug,
        category: subfacet.category,
        requestId,
        response:
          payload.responseData as unknown as SubfacetSummarizationResult['response'],
        previousAudit,
      });
    } else {
      results.push({
        subfacetId: subfacet.id,
        subfacetSlug: subfacet.slug,
        category: subfacet.category,
        requestId,
        error: 'No response received',
        previousAudit,
      });
    }
  }

  log.info('[subfacetSummarizationWorkflow] completed', {
    workflowId,
    subfacetCount: subfacets.length,
  });

  return {
    trigger: input.trigger,
    since: input.since,
    subfacets: results,
  };
}
