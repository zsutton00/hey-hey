import { repositoryImportAnalysis } from './repository-grounding-review.mapper';
import { Injectable, Logger } from '@nestjs/common';
import type { RepositoryFeatureEnrichmentRequest } from 'src/generated';
import { LocalPromptType } from 'src/generated/local';
import {
  AgentHandoffNodeBase,
  ExternalAgentTriggerMessage,
  MutableContextHandle,
  RepositoryImportFlowContext,
} from 'src/types/flow-internal.types';
import { REPOSITORY_IMPORT_NODES } from '../../constants/node-ids';

/** Completes the import workflow and hands the conversation to the CLI once. */
@Injectable()
export class RepositoryFeatureEnrichmentNode extends AgentHandoffNodeBase<RepositoryImportFlowContext> {
  readonly id = REPOSITORY_IMPORT_NODES.ENRICHMENT;
  readonly title = 'Explore Feature intent';
  private readonly logger = new Logger(RepositoryFeatureEnrichmentNode.name);

  async buildTriggerMessage(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
  ): Promise<ExternalAgentTriggerMessage> {
    const context = tracker.getContext();
    const accepted = context.repositoryGrounding;
    const analysis = repositoryImportAnalysis(context);
    const featureIds = context.repositoryImportMaterializedFeatureIds;
    if (!accepted || !analysis || !featureIds?.length)
      throw new Error(
        'Enrichment requires repository evidence and approved, created Features.',
      );
    const payload = {
      promptType: 'repository_feature_enrichment',
      projectId: context.core.projectId,
      conversationId: context.core.conversationId,
      workflowId: context.core.workflowId,
      workflowNodeId: this.id,
      serviceId: accepted.prerequisites.serviceId,
      machineId: accepted.prerequisites.machineId,
      provider: accepted.analysisConfiguration.provider,
      resolvedFrontierModel:
        accepted.analysisConfiguration.resolvedFrontierModel,
      reasoningEffort: accepted.analysisConfiguration.reasoningEffort,
      ...(accepted.analysisConfiguration.fastMode === undefined
        ? {}
        : { fastMode: accepted.analysisConfiguration.fastMode }),
      analysis: {
        outcome: analysis.outcome,
        serviceId: analysis.serviceId,
        provider: analysis.provider,
        resolvedFrontierModel: analysis.resolvedFrontierModel,
        narrative: analysis.narrative,
        hierarchy: analysis.hierarchy,
        evidence: analysis.evidence,
        briefDiscrepancies: analysis.briefDiscrepancies,
      },
      materializedFeatureIds: featureIds,
    } satisfies RepositoryFeatureEnrichmentRequest;
    this.logger.debug('Handing created Features to the CLI conversation', {
      conversationId: context.core.conversationId,
      featureCount: featureIds.length,
      serviceId: payload.serviceId,
    });
    return {
      uiElements: [],
      response:
        'Continuing with questions about your Features and their intended behavior.',
      triggersAgent: {
        promptType: LocalPromptType.repository_feature_enrichment,
        nodeId: this.id,
        payload,
      },
    };
  }
}
