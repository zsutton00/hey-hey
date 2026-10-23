import { Injectable, Logger } from '@nestjs/common';
import type {
  RepositoryFirstWorkCompletion,
  RepositoryFirstWorkQuestions,
  RepositoryFirstWorkRequest,
  RepositoryFirstWorkRetryableFailure,
  RepositoryFirstWorkSuccess,
  RepositoryFirstWorkTerminalFailure,
  RepositoryGroundingSuccess,
} from 'src/generated';
import { LocalPromptType } from 'src/generated/local';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  ExternalAgentActionSchemas,
  ExternalAgentFlowData,
  ExternalAgentNodeBase,
  ExternalAgentTriggerMessage,
  FlowUserMessage,
  MutableContextHandle,
  RepositoryImportFlowContext,
} from 'src/types/flow-internal.types';
import { REPOSITORY_IMPORT_NODES } from '../../constants/node-ids';
import { createOpenApiRuntimeSchema } from '../shared/openapi-runtime-schema';
import { MAX_FIRST_WORK_FOLLOW_UP_ROUNDS } from './repository-import-first-work-follow-up.node';

const questionsSchema =
  createOpenApiRuntimeSchema<RepositoryFirstWorkQuestions>(
    'RepositoryFirstWorkQuestions',
  );
const successSchema = createOpenApiRuntimeSchema<RepositoryFirstWorkSuccess>(
  'RepositoryFirstWorkSuccess',
);
const retryableSchema =
  createOpenApiRuntimeSchema<RepositoryFirstWorkRetryableFailure>(
    'RepositoryFirstWorkRetryableFailure',
  );
const terminalSchema =
  createOpenApiRuntimeSchema<RepositoryFirstWorkTerminalFailure>(
    'RepositoryFirstWorkTerminalFailure',
  );

export const repositoryFirstWorkActions: ExternalAgentActionSchemas = {
  questions: { schema: questionsSchema, waitForUser: false },
  success: { schema: successSchema, waitForUser: false },
  retryable_failure: { schema: retryableSchema, waitForUser: false },
  terminal_failure: { schema: terminalSchema, waitForUser: false },
};

function parseCompletion(
  action: string,
  payload: unknown,
): RepositoryFirstWorkCompletion | undefined {
  const schema =
    action === 'questions'
      ? questionsSchema
      : action === 'success'
        ? successSchema
        : action === 'retryable_failure'
          ? retryableSchema
          : action === 'terminal_failure'
            ? terminalSchema
            : undefined;
  const parsed = schema?.safeParse(payload);
  return parsed?.success ? parsed.data : undefined;
}

function acceptedAnalysis(
  context: Readonly<RepositoryImportFlowContext>,
): RepositoryGroundingSuccess | undefined {
  return (
    context.repositoryFeatureEnrichmentAcceptedAnalysis ??
    context.repositoryGroundingBaseline
  );
}

/** Proposal payload shapes vary by type; the parent is found by key, not path. */
function findParentTaskIds(value: unknown, found = new Set<string>()) {
  if (Array.isArray(value))
    value.forEach((item) => findParentTaskIds(item, found));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'parentTaskId' && typeof child === 'string') found.add(child);
      else findParentTaskIds(child, found);
    }
  }
  return found;
}

@Injectable()
export class RepositoryImportFirstWorkNode extends ExternalAgentNodeBase<RepositoryImportFlowContext> {
  readonly id = REPOSITORY_IMPORT_NODES.FIRST_WORK;
  readonly promptType = LocalPromptType.repository_first_work;
  readonly actions = repositoryFirstWorkActions;
  readonly acceptsUserMessages = false;
  private readonly logger = new Logger(RepositoryImportFirstWorkNode.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async buildTriggerMessage(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
  ): Promise<ExternalAgentTriggerMessage> {
    const context = tracker.getContext();
    const accepted = context.repositoryGrounding;
    const analysis = acceptedAnalysis(context);
    const featureIds = context.repositoryImportMaterializedFeatureIds ?? [];
    if (
      !accepted ||
      !analysis ||
      !featureIds.length ||
      !context.repositoryFirstWorkRequest
    )
      throw new Error(
        'First work requires an accepted analysis, materialized Features, and a work request.',
      );
    const payload = {
      promptType: 'repository_first_work',
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
      workRequest: context.repositoryFirstWorkRequest,
      followUpRoundCount: context.repositoryFirstWorkFollowUpRoundCount ?? 0,
      followUpAnswers: context.repositoryFirstWorkFollowUpAnswers ?? [],
    } as RepositoryFirstWorkRequest;
    this.logger.debug('Repository first-work request built', {
      conversationId: context.core.conversationId,
      serviceId: payload.serviceId,
      followUpRoundCount: payload.followUpRoundCount,
      materializedFeatureCount: featureIds.length,
    });
    return {
      response: 'Preparing a first task under your imported Features.',
      uiElements: [],
      triggersAgent: { promptType: this.promptType, nodeId: this.id, payload },
      data: {
        detectedIntent: 'repository_first_work_started',
        intentConfidence: 1,
        ragEnabled: false,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    message: FlowUserMessage,
  ): Promise<void> {
    const data = (message.data ?? {}) as Partial<ExternalAgentFlowData>;
    if (typeof data.action !== 'string') return;
    const completion = parseCompletion(data.action, data.payload);
    if (!completion) return;
    const context = tracker.getContext();
    if (
      completion.outcome === 'questions' &&
      (context.repositoryFirstWorkFollowUpRoundCount ?? 0) >=
        MAX_FIRST_WORK_FOLLOW_UP_ROUNDS
    ) {
      this.rejectCompletion(
        tracker,
        'The first-work stage already used its follow-up round.',
      );
      return;
    }
    if (completion.outcome === 'success') {
      const error = await this.validateSuccess(completion, context);
      if (error) {
        this.rejectCompletion(tracker, error);
        return;
      }
    }
    tracker.mutate((draft) => {
      draft.repositoryFirstWorkLatestOutcome = completion;
      if (completion.outcome === 'success')
        draft.repositoryFirstWorkFinal = completion;
    });
    this.logger.debug('Repository first-work outcome stored', {
      conversationId: context.core.conversationId,
      outcome: completion.outcome,
    });
  }

  async determineRoutingFromAgentCompletion(
    context: Readonly<RepositoryImportFlowContext>,
    action: string,
  ): Promise<string | undefined> {
    const outcome = context.repositoryFirstWorkLatestOutcome?.outcome;
    if (action === 'questions' && outcome === 'questions')
      return REPOSITORY_IMPORT_NODES.FIRST_WORK_FOLLOW_UP;
    if (
      action === 'success' &&
      outcome === 'success' &&
      context.repositoryFirstWorkFinal
    )
      return REPOSITORY_IMPORT_NODES.END;
    return REPOSITORY_IMPORT_NODES.FIRST_WORK_RECOVERY;
  }

  private async validateSuccess(
    completion: RepositoryFirstWorkSuccess,
    context: Readonly<RepositoryImportFlowContext>,
  ): Promise<string | undefined> {
    const featureIds = new Set(context.repositoryImportMaterializedFeatureIds);
    const ids = [
      ...completion.taskProposalIds,
      ...completion.featureProposalIds,
    ];
    const proposals = await this.prisma.db.proposal.findMany({
      where: {
        id: { in: ids },
        organizationId: context.core.organizationId,
        projectId: context.core.projectId,
      },
      select: {
        id: true,
        action: true,
        status: true,
        targetEntityId: true,
        targetEntityType: true,
        updates: true,
      },
    });
    const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
    if (byId.size !== new Set(ids).size)
      return 'First-work success references unknown proposals.';
    if (proposals.some((proposal) => proposal.status === 'REJECTED'))
      return 'First-work success references a rejected proposal.';
    for (const id of completion.taskProposalIds) {
      const proposal = byId.get(id)!;
      const parents = findParentTaskIds(proposal.updates);
      if (
        proposal.action !== 'CREATE' ||
        proposal.targetEntityType !== 'TASK' ||
        ![...parents].some((parent) => featureIds.has(parent))
      )
        return 'Every first-work task must be created under an imported Feature.';
    }
    for (const id of completion.featureProposalIds) {
      const proposal = byId.get(id)!;
      if (
        proposal.action !== 'UPDATE' ||
        !featureIds.has(proposal.targetEntityId)
      )
        return 'First-work Feature updates must edit an imported Feature.';
    }
    return undefined;
  }

  private rejectCompletion(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    reason: string,
  ): void {
    tracker.mutate((draft) => {
      draft.repositoryFirstWorkLatestOutcome = {
        outcome: 'terminal_failure',
        code: 'invalid_completion',
        message: reason,
      };
    });
    this.logger.warn('Repository first-work completion rejected', {
      conversationId: tracker.getContext().core.conversationId,
      reason,
    });
  }
}
