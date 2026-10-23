import { Injectable, Logger } from '@nestjs/common';
import { SubfacetStatus } from '@prisma/client';
import { TOPOLOGY_NODES } from 'src/flows/constants';
import {
  categoryConsolidationSchema,
  topologyCategories,
} from 'src/flows/utils/topology-schemas';
import { SystemMessageData } from 'src/generated';
import { TopologyAuditService } from 'src/services/audit/topology-audit.service';
import { EntitySummaryService } from 'src/services/entity-summary/entity-summary.service';
import { SubfacetService } from 'src/services/entity-summary/subfacet.service';
import { ClaudeModel, LLMProviderName } from 'src/services/llm/llm-shared';
import { TopologyCategorySummaryService } from 'src/services/topology/topology-category-summary.service';
import {
  FlowContext,
  FlowUserMessage,
  IntermediateSystemMessageData,
  MutableContextHandle,
  NodeType,
  NonInteractiveNodeBase,
  PromptConfig,
} from 'src/types/flow-internal.types';

type CategorySummarizationContext = FlowContext & {
  topologyConsolidationRunId?: string;
  temporalWorkflowId?: string;
  auditRequestId?: string;
  categoryPromptMode?: 'legacy' | 'large';
  maxSubfacetsInPrompt?: number;
  changedEntitySamplePerSubfacet?: number;
  summarizationCategory: (typeof topologyCategories)[number];
  summarizationSince?: string;
  maxPerCategory?: number;
  currentCategorySummary?: string;
  previousCategorySummary?: {
    summary: string;
    briefSummary?: string | null;
    lastUpdated: Date;
  };
  subfacetSummarySnapshot?: Array<{
    subfacet: string;
    summary: string;
    lastSummarizedAt?: string;
    updatedSinceCutoff: boolean;
    isNew: boolean;
    entitySamples?: string[];
  }>;
};

const MAX_PER_CATEGORY = 50;
const DEFAULT_MAX_SUBFACETS_IN_PROMPT = 100;
const DEFAULT_CHANGED_ENTITY_SAMPLE_PER_SUBFACET = 5;
const CATEGORY_SUMMARIZATION_PROMPT_VERSION =
  'topology-category-summarization/v3';
const CATEGORY_SUMMARIZATION_PARSER_VERSION = 'categoryConsolidationSchema/v3';

@Injectable()
export class CategorySummarizationNode extends NonInteractiveNodeBase {
  readonly id = TOPOLOGY_NODES.CATEGORY_CONSOLIDATION;
  readonly type = NodeType.NON_INTERACTIVE;
  private readonly logger = new Logger(CategorySummarizationNode.name);

  constructor(
    private readonly subfacetService: SubfacetService,
    private readonly entitySummaryService: EntitySummaryService,
    private readonly categorySummaryService: TopologyCategorySummaryService,
    private readonly auditService: TopologyAuditService,
  ) {
    super();
  }

  readonly promptConfig: PromptConfig = {
    systemPromptTemplate: (context: FlowContext) =>
      this.buildSystemPrompt(context as CategorySummarizationContext),
    responseSchema: categoryConsolidationSchema,
    temperature: 0.1,
    maxTokens: 5000,
    responseFormat: null,
    modelCriteria: {
      provider: LLMProviderName.CLAUDE,
      model: ClaudeModel.CLAUDE_4_HAIKU_5,
    },
    timeout: 120000,
  };

  async beforeGeneration(
    tracker: MutableContextHandle<FlowContext>,
  ): Promise<void> {
    const ctx = tracker.getContext() as CategorySummarizationContext;
    const category = ctx.summarizationCategory;
    if (!category) {
      throw new Error(
        '[CategorySummarizationNode] summarizationCategory is required',
      );
    }
    if (!ctx.core.projectId) {
      throw new Error(
        '[CategorySummarizationNode] projectId is required for category summarization',
      );
    }

    let since: Date | undefined;
    if (ctx.summarizationSince) {
      since = new Date(ctx.summarizationSince);
      if (Number.isNaN(since.getTime())) {
        throw new Error(
          `[CategorySummarizationNode] Invalid summarizationSince: ${ctx.summarizationSince}`,
        );
      }
    }

    const currentSummary = await this.categorySummaryService.getCurrentSummary({
      organizationId: ctx.core.organizationId,
      projectId: ctx.core.projectId,
      category,
    });

    // Default cutoff is explicit since, otherwise the last category summary time.
    const cutoff = since ?? currentSummary?.lastUpdated;

    const subfacetSummarySnapshot = await this.buildSubfacetSummarySnapshot({
      organizationId: ctx.core.organizationId,
      projectId: ctx.core.projectId,
      category,
      cutoff,
      mode: ctx.categoryPromptMode ?? 'legacy',
      maxSubfacetsInPrompt: ctx.maxSubfacetsInPrompt,
      changedEntitySamplePerSubfacet: ctx.changedEntitySamplePerSubfacet,
      maxUpdated: ctx.maxPerCategory,
    });

    this.logger.debug(
      `[beforeGeneration] category=${category} cutoff=${cutoff?.toISOString() ?? 'none'} mode=${ctx.categoryPromptMode ?? 'legacy'} subfacets(new/updated=${subfacetSummarySnapshot.filter((s) => s.isNew || s.updatedSinceCutoff).length}, sampled=${subfacetSummarySnapshot.filter((s) => !s.isNew && !s.updatedSinceCutoff).length})`,
    );

    tracker.mutate((draft) => {
      const summarizationDraft = draft as CategorySummarizationContext;
      if (
        !summarizationDraft.currentCategorySummary &&
        currentSummary?.summary
      ) {
        summarizationDraft.currentCategorySummary = currentSummary.summary;
      }
      if (cutoff) {
        summarizationDraft.summarizationSince = cutoff.toISOString();
      }
      if (currentSummary) {
        summarizationDraft.previousCategorySummary = {
          summary: currentSummary.summary,
          briefSummary: currentSummary.briefSummary,
          lastUpdated: currentSummary.lastUpdated,
        };
      }
      summarizationDraft.subfacetSummarySnapshot = subfacetSummarySnapshot;
    });
  }

  async processLlmResponse(
    systemMessageData: IntermediateSystemMessageData,
    _userMessage: FlowUserMessage | undefined,
    tracker: MutableContextHandle<FlowContext>,
  ): Promise<{ modifiedResult?: SystemMessageData }> {
    const parsed = categoryConsolidationSchema.safeParse(systemMessageData);
    if (!parsed.success) {
      throw new Error(
        `[CategorySummarizationNode] Invalid summarization response: ${parsed.error.message}`,
      );
    }

    const ctx = tracker.getContext() as CategorySummarizationContext;
    const runAt = new Date();
    const since = ctx.summarizationSince
      ? new Date(ctx.summarizationSince)
      : runAt;
    if (Number.isNaN(since.getTime())) {
      throw new Error(
        `[CategorySummarizationNode] Invalid summarizationSince: ${ctx.summarizationSince}`,
      );
    }

    await this.categorySummaryService.upsertSummary({
      organizationId: ctx.core.organizationId,
      projectId: ctx.core.projectId,
      category: ctx.summarizationCategory,
      summary: parsed.data.summary,
      briefSummary: parsed.data.briefSummary,
    });

    const thresholdApplied =
      ctx.subfacetSummarySnapshot?.length ??
      Math.max(ctx.maxPerCategory ?? MAX_PER_CATEGORY, 1);

    await this.auditService.recordCategoryRun({
      organizationId: ctx.core.organizationId,
      projectId: ctx.core.projectId,
      topologyConsolidationRunId: ctx.topologyConsolidationRunId,
      temporalWorkflowId: ctx.temporalWorkflowId,
      requestId: ctx.auditRequestId,
      nodeName: TOPOLOGY_NODES.CATEGORY_CONSOLIDATION,
      promptVersion: CATEGORY_SUMMARIZATION_PROMPT_VERSION,
      parserVersion: CATEGORY_SUMMARIZATION_PARSER_VERSION,
      category: ctx.summarizationCategory,
      since,
      until: runAt,
      thresholdApplied,
      accumulatedSnapshot: ctx.subfacetSummarySnapshot ?? [],
      consolidatedBefore: ctx.previousCategorySummary,
      consolidationResult: parsed.data,
    });

    this.logger.log(
      `[processLlmResponse] category=${ctx.summarizationCategory} subfacets=${ctx.subfacetSummarySnapshot?.length ?? 0} thresholdApplied=${thresholdApplied}`,
    );

    return { modifiedResult: parsed.data as unknown as SystemMessageData };
  }

  private buildSystemPrompt(context: CategorySummarizationContext): string {
    const category = context.summarizationCategory;
    if (!category) {
      throw new Error(
        '[CategorySummarizationNode] summarizationCategory is required',
      );
    }

    if (context.summarizationSince) {
      const since = new Date(context.summarizationSince);
      if (Number.isNaN(since.getTime())) {
        throw new Error(
          `[CategorySummarizationNode] Invalid summarizationSince: ${context.summarizationSince}`,
        );
      }
    }

    const categorySummaryBlock = context.currentCategorySummary
      ? `Current category summary:\n${context.currentCategorySummary.trim()}`
      : '';
    const subfacetSummaryBlock = this.formatSubfacetSummarySnapshot(
      context.subfacetSummarySnapshot,
      context.summarizationSince,
    );

    return `You are a category summarization assistant. Synthesize multiple subfacet summaries within a single category into two outputs:
- summary: comprehensive but high-level
- briefSummary: single-paragraph, narrative-style brief. Include only high-confidence, important information.

Category: ${category}
${categorySummaryBlock ? `${categorySummaryBlock}\n` : ''}
Recent subfacet summaries (new or updated since cutoff, with sampled changed entities when available):
${subfacetSummaryBlock.recentBlock}

Existing subfacet summaries (sampled):
${subfacetSummaryBlock.unchangedBlock}

Tasks:
- Identify cross-cutting themes that appear across multiple subfacets.
- Eliminate redundancy; mention each distinct idea once.
- Preserve critical decisions, outcomes, constraints, and dependencies found in the subfacets at a strategy level.
- If evidence is thin or conflicting, call it out explicitly in summary prose; do not invent facts.

Quality checks:
- summary reflects the provided subfacet summaries only.
    - Coverage: every subfacet used is listed in subfacets and represented in the summary.
    - Write 2-3 short paragraphs with high information density.
    - Be comprehensive but avoid enumerating low-level implementations (for example: credential backends, exact file paths, endpoint paths, latency/throughput numbers, class names, or internal library choices) unless essential to a core product constraint.
- briefSummary reflects the same evidence as summary.
    - Exactly one paragraph.
    - Maximum 90 words.
    - High-level orientation only; no implementation enumeration.

Return only the JSON object; arrays may be empty if not supported by evidence.`;
  }

  private async buildSubfacetSummarySnapshot(params: {
    organizationId: FlowContext['core']['organizationId'];
    projectId: FlowContext['core']['projectId'];
    category: CategorySummarizationContext['summarizationCategory'];
    cutoff?: Date;
    mode: 'legacy' | 'large';
    maxSubfacetsInPrompt?: number;
    changedEntitySamplePerSubfacet?: number;
    maxUpdated?: number;
  }): Promise<
    Array<{
      subfacet: string;
      summary: string;
      lastSummarizedAt?: string;
      updatedSinceCutoff: boolean;
      isNew: boolean;
      entitySamples?: string[];
    }>
  > {
    const mode = params.mode;
    const maxUpdated = Math.max(params.maxUpdated ?? MAX_PER_CATEGORY, 1);
    const maxUnchangedSample = Math.min(5, maxUpdated);
    const maxSubfacetsInPrompt = Math.max(
      params.maxSubfacetsInPrompt ?? DEFAULT_MAX_SUBFACETS_IN_PROMPT,
      1,
    );
    const changedEntitySamplePerSubfacet = Math.max(
      params.changedEntitySamplePerSubfacet ??
        DEFAULT_CHANGED_ENTITY_SAMPLE_PER_SUBFACET,
      1,
    );

    const subfacets = await this.subfacetService.listSubfacets({
      organizationId: params.organizationId,
      projectId: params.projectId,
      category: params.category,
      status: SubfacetStatus.ACTIVE,
      orderByUpdatedAtDesc: true,
    });

    if (!subfacets.length) {
      return [];
    }

    const cutoffTime = params.cutoff?.getTime();

    const updatedOrNew: typeof subfacets = [];
    const unchanged: typeof subfacets = [];

    for (const sf of subfacets) {
      const lastSummarizedAt = sf.lastSummarizedAt?.getTime();
      const isNew = !lastSummarizedAt;
      const updatedSinceCutoff =
        !!cutoffTime && !!lastSummarizedAt && lastSummarizedAt >= cutoffTime;

      if (isNew || updatedSinceCutoff) {
        updatedOrNew.push(sf);
        continue;
      }

      unchanged.push(sf);
    }

    const snapshot: Array<{
      subfacet: string;
      summary: string;
      lastSummarizedAt?: string;
      updatedSinceCutoff: boolean;
      isNew: boolean;
      entitySamples?: string[];
    }> = [];

    const selectedUpdated =
      mode === 'large'
        ? updatedOrNew.slice(0, maxSubfacetsInPrompt)
        : updatedOrNew.slice(0, maxUpdated);
    const entitySamplesBySubfacetId = new Map<string, string[]>();

    if (mode === 'large') {
      await Promise.all(
        selectedUpdated.map(async (sf) => {
          const entities =
            await this.entitySummaryService.getCurrentSummariesForSubfacet({
              organizationId: params.organizationId,
              projectId: params.projectId,
              subfacetId: sf.id,
              category: params.category,
              since: params.cutoff,
              take: changedEntitySamplePerSubfacet,
            });
          entitySamplesBySubfacetId.set(
            sf.id,
            entities.map((entry) => {
              const updatedAt = entry.updatedAt.toISOString();
              return `${entry.entityType}:${entry.entityId} (updated ${updatedAt}): ${entry.summary}`;
            }),
          );
        }),
      );
    }

    for (const sf of selectedUpdated) {
      snapshot.push({
        subfacet: sf.name,
        summary: sf.summary?.trim() || 'No subfacet summary available.',
        lastSummarizedAt: sf.lastSummarizedAt?.toISOString(),
        updatedSinceCutoff:
          !!cutoffTime &&
          !!sf.lastSummarizedAt &&
          sf.lastSummarizedAt.getTime() >= cutoffTime,
        isNew: !sf.lastSummarizedAt,
        ...(mode === 'large'
          ? { entitySamples: entitySamplesBySubfacetId.get(sf.id) ?? [] }
          : {}),
      });
    }

    const remaining = Math.max(maxSubfacetsInPrompt - snapshot.length, 0);
    const unchangedLimit = mode === 'large' ? remaining : maxUnchangedSample;
    for (const sf of unchanged.slice(0, unchangedLimit)) {
      snapshot.push({
        subfacet: sf.name,
        summary: sf.summary?.trim() || 'No subfacet summary available.',
        lastSummarizedAt: sf.lastSummarizedAt?.toISOString(),
        updatedSinceCutoff: false,
        isNew: false,
      });
    }

    return snapshot;
  }

  private formatSubfacetSummarySnapshot(
    snapshot: CategorySummarizationContext['subfacetSummarySnapshot'],
    since?: string,
  ): { recentBlock: string; unchangedBlock: string } {
    if (!snapshot || snapshot.length === 0) {
      return {
        recentBlock: 'No subfacet summaries available.',
        unchangedBlock: 'No additional subfacet summaries available.',
      };
    }

    let cutoff: Date | undefined;
    if (since) {
      const parsed = new Date(since);
      cutoff = Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }

    const recentLines: string[] = [];
    const unchangedLines: string[] = [];

    for (const entry of snapshot) {
      const pieces: string[] = [];
      if (entry.lastSummarizedAt) {
        pieces.push(`last_summarized: ${entry.lastSummarizedAt}`);
      }
      if (cutoff && entry.lastSummarizedAt) {
        const updatedAt = new Date(entry.lastSummarizedAt);
        const updatedSince = updatedAt >= cutoff ? 'yes' : 'no';
        pieces.push(`updated_since_cutoff: ${updatedSince}`);
      }
      if (entry.isNew) {
        pieces.push('status: new');
      }
      const meta = pieces.length ? ` (${pieces.join(', ')})` : '';
      const line = `- ${entry.subfacet}${meta}: ${entry.summary}`;

      if (entry.isNew || entry.updatedSinceCutoff) {
        recentLines.push(line);
        if (entry.entitySamples?.length) {
          for (const sample of entry.entitySamples) {
            recentLines.push(`  • ${sample}`);
          }
        }
      } else {
        unchangedLines.push(line);
      }
    }

    return {
      recentBlock:
        recentLines.length > 0
          ? recentLines.join('\n')
          : 'No new or recently updated subfacet summaries.',
      unchangedBlock:
        unchangedLines.length > 0
          ? unchangedLines.join('\n')
          : 'No additional subfacet summaries available.',
    };
  }
}
