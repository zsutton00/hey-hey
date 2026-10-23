import { Injectable, Logger } from '@nestjs/common';
import { EntityType } from '@prisma/client';
import { TOPOLOGY_NODES } from 'src/flows/constants';
import {
  subfacetSummarizationSchema,
  topologyCategories,
} from 'src/flows/utils/topology-schemas';
import { SystemMessageData } from 'src/generated';
import { TopologyAuditService } from 'src/services/audit/topology-audit.service';
import { EntitySummaryService } from 'src/services/entity-summary/entity-summary.service';
import { SubfacetService } from 'src/services/entity-summary/subfacet.service';
import { LLMProviderName, SyntheticModel } from 'src/services/llm/llm-shared';
import {
  FlowContext,
  FlowUserMessage,
  IntermediateSystemMessageData,
  MutableContextHandle,
  NodeType,
  NonInteractiveNodeBase,
  PromptConfig,
} from 'src/types/flow-internal.types';

type SubfacetSummarizationContext = FlowContext & {
  topologyConsolidationRunId?: string;
  temporalWorkflowId?: string;
  auditRequestId?: string;
  subfacetId: string;
  subfacetName?: string;
  subfacetSlug?: string;
  summarizationCategory?: (typeof topologyCategories)[number];
  summarizationSince?: string;
  maxEntities?: number;
  currentSubfacetSummary?: string;
  previousSubfacetSummary?: {
    summary: string;
    lastSummarizedAt?: Date | string | null;
  };
  entitySummarySnapshot?: Array<{
    entityId: string;
    entityType: EntityType;
    summary: string;
    lastUpdated: string;
  }>;
  changedEntityCount?: number;
  totalCurrentEntitiesForSubfacet?: number;
  changedEntitiesSinceCutoff?: number;
};

const DEFAULT_MAX_ENTITIES = 100;
const SUBFACET_SUMMARIZATION_PROMPT_VERSION =
  'topology-subfacet-summarization/v3';
const SUBFACET_SUMMARIZATION_PARSER_VERSION = 'subfacetSummarizationSchema/v2';

@Injectable()
export class SubfacetSummarizationNode extends NonInteractiveNodeBase {
  readonly id = TOPOLOGY_NODES.SUBFACET_SUMMARIZATION;
  readonly type = NodeType.NON_INTERACTIVE;
  private readonly logger = new Logger(SubfacetSummarizationNode.name);

  constructor(
    private readonly entitySummaryService: EntitySummaryService,
    private readonly subfacetService: SubfacetService,
    private readonly auditService: TopologyAuditService,
  ) {
    super();
  }

  readonly promptConfig: PromptConfig = {
    systemPromptTemplate: (context: FlowContext) =>
      this.buildSystemPrompt(context as SubfacetSummarizationContext),
    responseSchema: subfacetSummarizationSchema,
    temperature: 0.1,
    topP: 0.9,
    reasoningEffort: 'low',
    maxTokens: 5000,
    responseFormat: null,
    modelCriteria: {
      provider: LLMProviderName.SYNTHETIC,
      model: SyntheticModel.KIMI_K2_5,
    },
    timeout: 120000,
  };

  async beforeGeneration(
    tracker: MutableContextHandle<FlowContext>,
  ): Promise<void> {
    const ctx = tracker.getContext() as SubfacetSummarizationContext;
    if (!ctx.core.projectId) {
      throw new Error(
        '[SubfacetSummarizationNode] projectId is required for summarization',
      );
    }
    const subfacetId = ctx.subfacetId;
    if (!subfacetId) {
      throw new Error(
        '[SubfacetSummarizationNode] subfacetId is required for summarization runs',
      );
    }

    let since: Date | undefined;
    if (ctx.summarizationSince) {
      since = new Date(ctx.summarizationSince);
      if (Number.isNaN(since.getTime())) {
        throw new Error(
          `[SubfacetSummarizationNode] Invalid summarizationSince: ${ctx.summarizationSince}`,
        );
      }
    }

    const subfacet = await this.subfacetService.getSubfacetById(subfacetId);
    if (!subfacet) {
      throw new Error(
        `[SubfacetSummarizationNode] Subfacet not found for id: ${subfacetId}`,
      );
    }

    if (!since) {
      since = subfacet.lastSummarizedAt ?? undefined;
    }

    const maxEntities = Math.max(ctx.maxEntities ?? DEFAULT_MAX_ENTITIES, 1);

    const entitySummaries =
      await this.entitySummaryService.getCurrentSummariesForSubfacet({
        organizationId: ctx.core.organizationId,
        projectId: ctx.core.projectId,
        subfacetId,
        category: subfacet.category,
        since,
        take: maxEntities,
      });

    const entitySummarySnapshot = entitySummaries.map((item) => ({
      entityId: item.entityId,
      entityType: item.entityType,
      summary: item.summary,
      lastUpdated: item.updatedAt.toISOString(),
    }));
    const { totalCurrent, changedSinceCutoff } =
      await this.entitySummaryService.getSubfacetCurrentSummaryCounts({
        organizationId: ctx.core.organizationId,
        projectId: ctx.core.projectId,
        subfacetId,
        category: subfacet.category,
        since,
      });

    tracker.mutate((draft) => {
      const summarizationDraft = draft as SubfacetSummarizationContext;
      summarizationDraft.subfacetName = subfacet.name;
      summarizationDraft.subfacetSlug = subfacet.slug;
      summarizationDraft.summarizationCategory = subfacet.category;
      summarizationDraft.maxEntities = maxEntities;
      if (since) {
        summarizationDraft.summarizationSince = since.toISOString();
      }
      if (subfacet.summary) {
        summarizationDraft.currentSubfacetSummary = subfacet.summary;
        summarizationDraft.previousSubfacetSummary = {
          summary: subfacet.summary,
          lastSummarizedAt: subfacet.lastSummarizedAt,
        };
      }
      summarizationDraft.entitySummarySnapshot = entitySummarySnapshot;
      summarizationDraft.changedEntityCount = entitySummaries.length;
      summarizationDraft.totalCurrentEntitiesForSubfacet = totalCurrent;
      summarizationDraft.changedEntitiesSinceCutoff = changedSinceCutoff;
    });

    this.logger.log(
      `[beforeGeneration] subfacetId=${subfacetId} name=${subfacet.name} category=${subfacet.category} entities=${entitySummaries.length} changedSinceCutoff=${changedSinceCutoff} totalCurrent=${totalCurrent} maxEntities=${maxEntities} since=${since?.toISOString() ?? 'none'}`,
    );
  }

  async shouldRun(
    tracker: MutableContextHandle<FlowContext>,
  ): Promise<{ run: boolean; reason?: string }> {
    const ctx = tracker.getContext() as SubfacetSummarizationContext;
    const changedEntityCount = ctx.changedEntityCount ?? 0;
    if (changedEntityCount === 0) {
      return {
        run: false,
        reason:
          'Skip subfacet summarization: no changed entity summaries since cutoff',
      };
    }

    return {
      run: true,
      reason: `Changed entity summaries since cutoff: ${changedEntityCount}`,
    };
  }

  async processLlmResponse(
    systemMessageData: IntermediateSystemMessageData,
    _userMessage: FlowUserMessage | undefined,
    tracker: MutableContextHandle<FlowContext>,
  ): Promise<{ modifiedResult?: SystemMessageData }> {
    const parsed = subfacetSummarizationSchema.safeParse(systemMessageData);
    if (!parsed.success) {
      throw new Error(
        `[SubfacetSummarizationNode] Invalid summarization response: ${parsed.error.message}`,
      );
    }

    const ctx = tracker.getContext() as SubfacetSummarizationContext;
    const runAt = new Date();
    if (!ctx.summarizationCategory) {
      throw new Error(
        '[SubfacetSummarizationNode] summarizationCategory is required in context',
      );
    }
    const since = ctx.summarizationSince
      ? new Date(ctx.summarizationSince)
      : runAt;
    if (Number.isNaN(since.getTime())) {
      throw new Error(
        `[SubfacetSummarizationNode] Invalid summarizationSince: ${ctx.summarizationSince}`,
      );
    }

    await this.subfacetService.updateSummary({
      subfacetId: ctx.subfacetId,
      summary: parsed.data.summary,
    });

    const thresholdApplied = Math.max(
      ctx.maxEntities ?? DEFAULT_MAX_ENTITIES,
      1,
    );

    await this.auditService.recordSubfacetSummaryRun({
      organizationId: ctx.core.organizationId,
      projectId: ctx.core.projectId,
      topologyConsolidationRunId: ctx.topologyConsolidationRunId,
      temporalWorkflowId: ctx.temporalWorkflowId,
      requestId: ctx.auditRequestId,
      nodeName: TOPOLOGY_NODES.SUBFACET_SUMMARIZATION,
      promptVersion: SUBFACET_SUMMARIZATION_PROMPT_VERSION,
      parserVersion: SUBFACET_SUMMARIZATION_PARSER_VERSION,
      category: ctx.summarizationCategory,
      subfacetId: ctx.subfacetId,
      since,
      until: runAt,
      thresholdApplied,
      accumulatedSnapshot: ctx.entitySummarySnapshot ?? [],
      consolidatedBefore: ctx.previousSubfacetSummary,
      consolidationResult: parsed.data,
    });

    this.logger.log(
      `[processLlmResponse] subfacetId=${ctx.subfacetId} category=${ctx.summarizationCategory} entities=${ctx.entitySummarySnapshot?.length ?? 0} thresholdApplied=${thresholdApplied}`,
    );

    return { modifiedResult: parsed.data as unknown as SystemMessageData };
  }

  private buildSystemPrompt(context: SubfacetSummarizationContext): string {
    const { subfacetName, summarizationCategory, entitySummarySnapshot } =
      context;
    if (!subfacetName || !summarizationCategory) {
      throw new Error(
        '[SubfacetSummarizationNode] subfacetName and summarizationCategory are required',
      );
    }

    if (context.summarizationSince) {
      const since = new Date(context.summarizationSince);
      if (Number.isNaN(since.getTime())) {
        throw new Error(
          `[SubfacetSummarizationNode] Invalid summarizationSince: ${context.summarizationSince}`,
        );
      }
    }

    const subfacetSummaryBlock = context.currentSubfacetSummary
      ? `Current subfacet summary:\n${context.currentSubfacetSummary.trim()}`
      : '';
    const entitySummaryBlock = this.formatEntitySummaries(
      entitySummarySnapshot,
      context.summarizationSince,
    );

    const totalCurrentEntities = context.totalCurrentEntitiesForSubfacet ?? 0;
    const changedEntities = context.changedEntitiesSinceCutoff ?? 0;
    const hasExistingSummary = !!context.currentSubfacetSummary?.trim();
    const taskLines = hasExistingSummary
      ? [
          '- Treat the current subfacet summary as the baseline state; use the provided entity-summary updates as new evidence to update that baseline, not to rewrite from scratch.',
          '- Keep the summary grounded in the provided updates and existing baseline; do not invent entities, decisions, or implementation details.',
          '- Apply the smallest effective change needed.',
          '- If updates do not materially change status or decisions, preserve structure and wording with only minor edits.',
          '- If updates show clear progression, update the summary to reflect the new state.',
          '- Capture key decisions, outcomes, constraints, and dependencies only when supported by the updates.',
        ]
      : [
          '- Create an initial subfacet summary from the provided entity summaries.',
          '- Keep the summary grounded in the provided entity summaries; do not invent entities, decisions, or implementation details.',
          '- Focus on current state: capture key decisions, outcomes, constraints, and dependencies explicitly present in the summaries.',
          '- Keep wording clear and compact while preserving the most decision-relevant information.',
        ];

    return `You are a subfacet summarization assistant. Synthesize entity summaries within a single subfacet into a concise, rolling subfacet summary.

Category: ${summarizationCategory}
Subfacet: ${subfacetName}
${subfacetSummaryBlock ? `${subfacetSummaryBlock}\n` : ''}Entity summaries (latest first):
${entitySummaryBlock}
Evidence scale:
- Total current entities linked to this subfacet: ${totalCurrentEntities}
- Changed entities since cutoff: ${changedEntities}

Tasks:
${taskLines.join('\n')}

Quality checks:
- Summary reflects only this subfacet and the listed entities.
- Keep the summary concise (70-120 words) and information-dense.

Return only the JSON object; arrays may be empty if evidence is insufficient.`;
  }

  private formatEntitySummaries(
    snapshot: SubfacetSummarizationContext['entitySummarySnapshot'],
    since?: string,
  ): string {
    if (!snapshot || snapshot.length === 0) {
      return 'No entity summaries available.';
    }

    let cutoff: Date | undefined;
    if (since) {
      const parsed = new Date(since);
      cutoff = Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }

    return snapshot
      .map((entry) => {
        const pieces: string[] = [];
        if (entry.lastUpdated) {
          pieces.push(`last_updated: ${entry.lastUpdated}`);
        }
        if (cutoff && entry.lastUpdated) {
          const updatedAt = new Date(entry.lastUpdated);
          const updatedSince = updatedAt >= cutoff ? 'yes' : 'no';
          pieces.push(`updated_since_cutoff: ${updatedSince}`);
        }
        const meta = pieces.length ? ` (${pieces.join(', ')})` : '';
        return `- ${entry.entityType}:${entry.entityId}${meta}: ${entry.summary}`;
      })
      .join('\n');
  }
}
