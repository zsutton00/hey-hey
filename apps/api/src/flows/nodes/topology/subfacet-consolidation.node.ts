import { Injectable, Logger } from '@nestjs/common';
import { TOPOLOGY_NODES } from 'src/flows/constants';
import { topologyCategories } from 'src/flows/utils/topology-schemas';
import {
  NodeType,
  NonInteractiveNodeBase,
  PromptConfig,
  FlowContext,
  MutableContextHandle,
  IntermediateSystemMessageData,
  FlowUserMessage,
} from 'src/types/flow-internal.types';
import {
  topologyConsolidationSchema,
  topologyConsolidationStrictSchema,
  TopologyConsolidation,
} from 'src/flows/utils/topology-schemas';
import { EntitySummaryService } from 'src/services/entity-summary/entity-summary.service';
import { SubfacetService } from 'src/services/entity-summary/subfacet.service';
import { TopologyAuditService } from 'src/services/audit/topology-audit.service';
import { SystemMessageData } from 'src/generated';
import { LLMProviderName, SyntheticModel } from 'src/services/llm/llm-shared';
import {
  EntityType,
  SubfacetConsolidationRun,
  SubfacetStatus,
} from '@prisma/client';
import { InputJsonValue } from '@prisma/client/runtime/library';

type ConsolidationContext = FlowContext & {
  topologyConsolidationRunId?: string;
  temporalWorkflowId?: string;
  auditRequestId?: string;
  consolidationCategory: (typeof topologyCategories)[number];
  consolidationThreshold?: number;
  consolidationSince?: string;
  previousAudit?: SubfacetConsolidationRun;
  consolidatedSubfacetsSnapshot?: unknown;
  accumulatedSubfacetsJson?: string;
  accumulatedSubfacetCount?: number;
  selectedSubfacetCount?: number;
  activeSubfacetCount?: number;
  consolidationRunGate?:
    | 'threshold'
    | 'proliferation'
    | 'first_run'
    | 'selected';
  processedSubfacets?: string[];
  selectedSubfacetBlock?: string;
  selectedSubfacetNames?: string[];
  hasMoreSubfacets?: boolean;
  maxEntitiesPerRun?: number;
  maxEntitiesPerSubfacet?: number;
  maxSubfacetsPerRun?: number;
  explicitSubfacetSelection?: boolean;
};

const DRY_RUN = false;
const MIN_SUBFACETS_FOR_CONSOLIDATION = 24;
const DEFAULT_MAX_ENTITIES = 100;
const DEFAULT_MAX_ENTITIES_PER_SUBFACET = 3;
const DEFAULT_MAX_SUBFACETS_PER_RUN = 88;
const MAX_SUBFACET_SUMMARY_LENGTH = 280;
const SUBFACET_CONSOLIDATION_PROMPT_VERSION = 'topology-consolidation/v1';
const SUBFACET_CONSOLIDATION_PARSER_VERSION = 'topologyConsolidationSchema/v1';

/**
 * Consolidates overlapping subfacets for a single category to prevent facet proliferation.
 * Runs per-category; the flow should invoke once per allowed category.
 */
@Injectable()
export class SubfacetConsolidationNode extends NonInteractiveNodeBase {
  readonly id = TOPOLOGY_NODES.CONSOLIDATION;
  readonly type = NodeType.NON_INTERACTIVE;
  private readonly logger = new Logger(SubfacetConsolidationNode.name);

  constructor(
    private readonly entitySummaryService: EntitySummaryService,
    private readonly subfacetService: SubfacetService,
    private readonly auditService: TopologyAuditService,
  ) {
    super();
  }

  readonly promptConfig: PromptConfig = {
    systemPromptTemplate: (context: FlowContext) =>
      this.buildSystemPrompt(context as ConsolidationContext),
    responseSchema: topologyConsolidationSchema,
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
    const ctx = tracker.getContext() as ConsolidationContext;
    if (!ctx.core.projectId) {
      throw new Error(
        '[SubfacetConsolidationNode] projectId is required for consolidation',
      );
    }
    const category = ctx.consolidationCategory;
    const threshold =
      ctx.consolidationThreshold ?? MIN_SUBFACETS_FOR_CONSOLIDATION;
    const processedSubfacets = new Set(
      (ctx.processedSubfacets || []).map((n) => n.toLowerCase()),
    );
    const maxEntitiesPerRun = ctx.maxEntitiesPerRun ?? DEFAULT_MAX_ENTITIES;
    const maxEntitiesPerSubfacet =
      ctx.maxEntitiesPerSubfacet ?? DEFAULT_MAX_ENTITIES_PER_SUBFACET;
    const maxSubfacetsPerRun =
      ctx.maxSubfacetsPerRun ?? DEFAULT_MAX_SUBFACETS_PER_RUN;

    if (!ctx.consolidationSince) {
      throw new Error(
        '[SubfacetConsolidationNode] consolidationSince is required to compute accumulated candidates',
      );
    }
    const since = new Date(ctx.consolidationSince);
    if (Number.isNaN(since.getTime())) {
      throw new Error(
        `[SubfacetConsolidationNode] Invalid consolidationSince: ${ctx.consolidationSince}`,
      );
    }

    const subfacets = await this.subfacetService.listByStatusAndCategory({
      organizationId: ctx.core.organizationId,
      projectId: ctx.core.projectId,
      category,
      statuses: [SubfacetStatus.ACTIVE, SubfacetStatus.PROVISIONAL],
      orderByUpdatedAtDesc: true,
    });

    const filteredSubfacets = subfacets.filter(
      (sf) => !processedSubfacets.has(sf.name.toLowerCase()),
    );
    const selectedSubfacetPool = filteredSubfacets.slice(0, maxSubfacetsPerRun);

    const selectedSubfacets: Array<{
      name: string;
      subfacetSummary: string;
      lastUpdated?: Date;
      updatedSinceCutoff: boolean;
      entities: Array<{
        entityType: EntityType;
        entityId: string;
        summary: string;
        updatedAt: Date;
      }>;
      omittedCount: number;
      entitySamplingSkipped: boolean;
    }> = [];

    let entityCount = 0;
    for (const sf of selectedSubfacetPool) {
      const subfacetSummary = this.normalizeSubfacetSummary(sf.summary);
      let useSummaries: Array<{
        entityType: EntityType;
        entityId: string;
        summary: string;
        updatedAt: Date;
      }> = [];
      let omitted = 0;
      let entitySamplingSkipped = false;

      if (entityCount < maxEntitiesPerRun) {
        const summaries =
          await this.entitySummaryService.getCurrentSummariesForSubfacet({
            organizationId: ctx.core.organizationId,
            projectId: ctx.core.projectId,
            subfacetId: sf.id,
            category,
            since,
            take: maxEntitiesPerSubfacet,
          });
        const remaining = maxEntitiesPerRun - entityCount;
        useSummaries = summaries.slice(0, remaining);
        omitted = summaries.length - useSummaries.length;
      } else {
        entitySamplingSkipped = true;
      }

      const latestUpdated = useSummaries[0]?.updatedAt ?? sf.updatedAt;
      const updatedSinceCutoff =
        !!since &&
        ((sf.updatedAt && sf.updatedAt.getTime() >= since.getTime()) ||
          useSummaries.some((e) => e.updatedAt.getTime() >= since.getTime()));

      selectedSubfacets.push({
        name: sf.name,
        subfacetSummary,
        lastUpdated: latestUpdated,
        updatedSinceCutoff,
        entities: useSummaries,
        omittedCount: omitted > 0 ? omitted : 0,
        entitySamplingSkipped,
      });

      entityCount += useSummaries.length;
    }

    const hasMoreSubfacets =
      selectedSubfacetPool.length < filteredSubfacets.length;

    const selectedSubfacetBlock =
      selectedSubfacets.length === 0
        ? 'No subfacet summaries available.'
        : selectedSubfacets
            .map((sf) => {
              const header = `  - subfacet: ${sf.name} (last_updated: ${sf.lastUpdated?.toISOString() ?? 'unknown'}, updated_since_cutoff: ${sf.updatedSinceCutoff ? 'yes' : 'no'})`;
              const summaryLine = `    summary: ${sf.subfacetSummary}`;
              const entities = sf.entities
                .map((e) => {
                  const updated = e.updatedAt?.toISOString() ?? 'unknown';
                  const idPart = e.entityId ? `:${e.entityId}` : '';
                  return `    • ${e.entityType}${idPart} (updated ${updated}): ${e.summary}`;
                })
                .join('\n');
              const omitted =
                sf.omittedCount > 0
                  ? `\n    • … ${sf.omittedCount} more entities omitted (sampling recent-first; max ${maxEntitiesPerSubfacet} per subfacet)`
                  : '';
              const samplingSkipped = sf.entitySamplingSkipped
                ? `\n    • entity samples omitted (run sample budget reached: max ${maxEntitiesPerRun})`
                : '';
              return [header, summaryLine, entities, omitted, samplingSkipped]
                .filter(Boolean)
                .join('\n');
            })
            .join('\n');

    tracker.mutate((draft) => {
      const consolidationDraft = draft as ConsolidationContext;
      consolidationDraft.consolidationCategory = category;
      consolidationDraft.consolidationThreshold = threshold;
      consolidationDraft.consolidationSince = since.toISOString();
      consolidationDraft.consolidatedSubfacetsSnapshot = selectedSubfacets;
      consolidationDraft.accumulatedSubfacetsJson = JSON.stringify(
        selectedSubfacets,
        null,
        2,
      );
      consolidationDraft.accumulatedSubfacetCount = filteredSubfacets.length;
      consolidationDraft.selectedSubfacetCount = selectedSubfacets.length;
      consolidationDraft.activeSubfacetCount = subfacets.length;
      consolidationDraft.selectedSubfacetBlock = selectedSubfacetBlock;
      consolidationDraft.selectedSubfacetNames = selectedSubfacets.map(
        (sf) => sf.name,
      );
      consolidationDraft.hasMoreSubfacets = hasMoreSubfacets;
      consolidationDraft.maxEntitiesPerRun = maxEntitiesPerRun;
      consolidationDraft.maxEntitiesPerSubfacet = maxEntitiesPerSubfacet;
      consolidationDraft.maxSubfacetsPerRun = maxSubfacetsPerRun;
    });

    this.logger.log(
      `[beforeGeneration] category=${category} since=${since.toISOString()} filtered=${filteredSubfacets.length} selected=${selectedSubfacets.length} entities=${entityCount} hasMore=${hasMoreSubfacets} maxSubfacetsPerRun=${maxSubfacetsPerRun} maxEntitiesPerRun=${maxEntitiesPerRun} maxPerSubfacet=${maxEntitiesPerSubfacet} processedBefore=${processedSubfacets.size}`,
    );
  }

  async shouldRun(
    tracker: MutableContextHandle<FlowContext>,
  ): Promise<{ run: boolean; reason?: string }> {
    const ctx = tracker.getContext() as ConsolidationContext;
    const threshold =
      ctx.consolidationThreshold ?? MIN_SUBFACETS_FOR_CONSOLIDATION;
    const active = ctx.activeSubfacetCount ?? 0;

    // Hard minimum — skip if too few subfacets to meaningfully consolidate
    if (active < MIN_SUBFACETS_FOR_CONSOLIDATION) {
      return {
        run: false,
        reason: `Only ${active} active subfacets; minimum ${MIN_SUBFACETS_FOR_CONSOLIDATION} required`,
      };
    }

    // Explicit selection gate — only when caller specifically requested these subfacets
    if (
      ctx.explicitSubfacetSelection &&
      (ctx.selectedSubfacetNames?.length ?? 0) > 0
    ) {
      tracker.mutate((draft) => {
        (draft as ConsolidationContext).consolidationRunGate = 'selected';
      });
      return {
        run: true,
        reason: `Selected ${ctx.selectedSubfacetNames?.length ?? 0} subfacets for consolidation`,
      };
    }
    const accumulated = ctx.accumulatedSubfacetCount ?? 0;

    // Gate 1: first run to establish baseline
    if (!ctx.previousAudit) {
      tracker.mutate((draft) => {
        (draft as ConsolidationContext).consolidationRunGate = 'first_run';
      });
      return { run: true, reason: 'No previous consolidation audit' };
    }

    // Gate 2: recent accumulated candidates exceed threshold
    if (accumulated >= threshold) {
      tracker.mutate((draft) => {
        (draft as ConsolidationContext).consolidationRunGate = 'threshold';
      });
      return {
        run: true,
        reason: `Accumulated subfacets (${accumulated}) meet/exceed threshold ${threshold}`,
      };
    }

    // Gate 3: proliferation of existing active subfacets
    if (active >= threshold) {
      tracker.mutate((draft) => {
        (draft as ConsolidationContext).consolidationRunGate = 'proliferation';
      });
      return {
        run: true,
        reason: `Active subfacets (${active}) meet/exceed threshold ${threshold}`,
      };
    }

    return {
      run: false,
      reason: `Skip consolidation: accumulated=${accumulated}, active=${active}, threshold=${threshold}`,
    };
  }

  /**
   * Pass through response; any persistence or downstream usage can hook here.
   */
  async processLlmResponse(
    systemMessageData: IntermediateSystemMessageData,
    _userMessage: FlowUserMessage | undefined,
    tracker: MutableContextHandle<FlowContext>,
  ): Promise<{ modifiedResult?: SystemMessageData }> {
    const { normalizedPayload, normalizationWarnings } =
      this.normalizeConsolidationNameConstraints(systemMessageData);
    const parsed =
      topologyConsolidationStrictSchema.safeParse(normalizedPayload);
    if (!parsed.success) {
      throw new Error(
        `[SubfacetConsolidationNode] Invalid consolidation response: ${parsed.error.message}`,
      );
    }

    const ctx = tracker.getContext() as ConsolidationContext;
    const runAt = new Date();
    const threshold =
      ctx.consolidationThreshold ?? MIN_SUBFACETS_FOR_CONSOLIDATION;
    const accumulatedCount = ctx.accumulatedSubfacetCount ?? 0;
    const gate = ctx.consolidationRunGate ?? 'threshold';
    const gateAllows = gate !== 'threshold' || accumulatedCount >= threshold;
    const hasMerges = (parsed.data.mergedSubfacets || []).length > 0;
    const hasKept = (parsed.data.keptSubfacets || []).length > 0;
    const shouldApply = gateAllows && (hasMerges || hasKept);
    const skipReason = shouldApply
      ? undefined
      : !hasMerges && !hasKept
        ? 'LLM returned no mergedSubfacets/keptSubfacets'
        : `Only ${accumulatedCount} accumulated subfacets; threshold is ${threshold}`;

    if (shouldApply) {
      await this.applyConsolidation(ctx, parsed.data);
    }

    const consolidationResult = {
      ...parsed.data,
      triggered: shouldApply,
      gate,
      skipReason,
      processedSubfacetsThisRun: ctx.selectedSubfacetNames ?? [],
      hasMoreSubfacets: ctx.hasMoreSubfacets ?? false,
      ...(normalizationWarnings.length ? { normalizationWarnings } : {}),
    } as unknown as Record<string, unknown>;

    // Persist processed subfacet bookkeeping back into context so workflows can read via contextUpdates
    const processed = new Set(
      (ctx.processedSubfacets || []).map((n) => n.toLowerCase()),
    );
    for (const name of ctx.selectedSubfacetNames ?? []) {
      processed.add(name.toLowerCase());
    }
    tracker.mutate((draft) => {
      (draft as ConsolidationContext).processedSubfacets =
        Array.from(processed);
      (draft as ConsolidationContext).hasMoreSubfacets =
        ctx.hasMoreSubfacets ?? false;
    });

    await this.auditService.recordRun({
      organizationId: ctx.core.organizationId,
      projectId: ctx.core.projectId,
      topologyConsolidationRunId: ctx.topologyConsolidationRunId,
      temporalWorkflowId: ctx.temporalWorkflowId,
      requestId: ctx.auditRequestId,
      nodeName: TOPOLOGY_NODES.CONSOLIDATION,
      promptVersion: SUBFACET_CONSOLIDATION_PROMPT_VERSION,
      parserVersion: SUBFACET_CONSOLIDATION_PARSER_VERSION,
      category: ctx.consolidationCategory,
      since: ctx.consolidationSince
        ? new Date(ctx.consolidationSince)
        : new Date(),
      until: runAt,
      thresholdApplied: threshold,
      accumulatedSnapshot: ctx.accumulatedSubfacetsJson
        ? JSON.parse(ctx.accumulatedSubfacetsJson)
        : [],
      consolidatedBefore: ctx.consolidatedSubfacetsSnapshot as InputJsonValue,
      consolidationResult: consolidationResult as InputJsonValue,
    });

    this.logger.log(
      `[processLlmResponse] category=${ctx.consolidationCategory} shouldApply=${shouldApply} merges=${(parsed.data.mergedSubfacets || []).length} kept=${(parsed.data.keptSubfacets || []).length} processedThisRun=${ctx.selectedSubfacetNames?.length ?? 0} hasMore=${ctx.hasMoreSubfacets ?? false} gate=${gate} skipReason=${skipReason ?? 'none'}`,
    );
    if (normalizationWarnings.length > 0) {
      this.logger.warn(
        `[processLlmResponse] category=${ctx.consolidationCategory} normalized ${normalizationWarnings.length} subfacet names to satisfy naming constraints`,
      );
    }

    return {
      modifiedResult: consolidationResult as unknown as SystemMessageData,
    };
  }

  private async applyConsolidation(
    ctx: ConsolidationContext,
    result: TopologyConsolidation,
  ): Promise<void> {
    const category = ctx.consolidationCategory;
    const mergedSubfacets = result.mergedSubfacets || [];
    const keptNames = Array.from(
      new Set(
        (result.keptSubfacets || [])
          .map((subfacet) => subfacet.name)
          .filter(Boolean),
      ),
    );
    if (!mergedSubfacets.length && !keptNames.length) {
      this.logger.log(
        '[applyConsolidation] no mergedSubfacets or keptSubfacets returned; nothing to apply',
      );
      return;
    }

    const targetNames = Array.from(
      new Set(mergedSubfacets.map((m) => m.name).filter(Boolean)),
    );
    const targetSummaries = Object.fromEntries(
      mergedSubfacets
        .filter((m) => m.name && m.summary)
        .map((m) => [m.name, m.summary]),
    );
    const mergedFromNames = Array.from(
      new Set(
        mergedSubfacets.flatMap((m) => m.mergedFrom || []).filter(Boolean),
      ),
    );

    if (!DRY_RUN && mergedSubfacets.length && targetNames.length) {
      await this.subfacetService.createSubfacets({
        names: targetNames,
        category,
        max: targetNames.length,
        summaries: targetSummaries,
        organizationId: ctx.core.organizationId,
        projectId: ctx.core.projectId,
      });
    }

    let updatedSummaries = 0;
    if (mergedSubfacets.length) {
      const allRelevantNames = Array.from(
        new Set([...targetNames, ...mergedFromNames]),
      );
      const allRelevantNamesLower = new Set(
        allRelevantNames.map((name) => name.toLowerCase()),
      );
      const existingSubfacets =
        await this.subfacetService.listByStatusAndCategory({
          organizationId: ctx.core.organizationId,
          projectId: ctx.core.projectId,
          category,
          statuses: [SubfacetStatus.ACTIVE, SubfacetStatus.PROVISIONAL],
        });
      const subfacetByName = new Map(
        existingSubfacets
          .filter((sf) => allRelevantNamesLower.has(sf.name.toLowerCase()))
          .map((sf) => [sf.name.toLowerCase(), sf]),
      );

      for (const merged of mergedSubfacets) {
        const target = subfacetByName.get(merged.name.toLowerCase());
        if (target && merged.summary && !DRY_RUN) {
          await this.subfacetService.updateSummary({
            subfacetId: target.id,
            summary: merged.summary,
          });
        }
      }

      const mergedFromToTarget = new Map<string, string>();
      for (const merged of mergedSubfacets) {
        for (const from of merged.mergedFrom || []) {
          mergedFromToTarget.set(from.toLowerCase(), merged.name);
        }
      }

      const currentSummaries =
        await this.entitySummaryService.getCurrentSummariesForSubfacetNames({
          organizationId: ctx.core.organizationId,
          projectId: ctx.core.projectId,
          category,
          subfacetNames: mergedFromNames,
          statuses: [SubfacetStatus.ACTIVE, SubfacetStatus.PROVISIONAL],
        });

      for (const summary of currentSummaries) {
        const currentNames = (summary.subfacets || []).map((sf) => sf.name);
        const nextNames: string[] = [];
        const touchedTargets = new Set<string>();

        for (const name of currentNames) {
          const target = mergedFromToTarget.get(name.toLowerCase());
          if (target) {
            touchedTargets.add(target);
            continue;
          }
          if (!nextNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
            nextNames.push(name);
          }
        }

        for (const target of touchedTargets) {
          if (
            !nextNames.some((n) => n.toLowerCase() === target.toLowerCase())
          ) {
            nextNames.push(target);
          }
        }

        const existingSet = new Set(currentNames.map((n) => n.toLowerCase()));
        const nextSet = new Set(nextNames.map((n) => n.toLowerCase()));
        const unchanged =
          existingSet.size === nextSet.size &&
          Array.from(existingSet).every((n) => nextSet.has(n));
        if (unchanged) {
          continue;
        }

        if (!DRY_RUN) {
          await this.entitySummaryService.createSummaryWithSubfacets({
            entityType: summary.entityType,
            entityId: summary.entityId,
            organizationId: ctx.core.organizationId,
            projectId: ctx.core.projectId,
            summary: summary.summary,
            category,
            subfacets: nextNames,
          });
        }
        updatedSummaries += 1;
      }

      if (mergedFromNames.length && !DRY_RUN) {
        await this.subfacetService.deprecateSubfacetsWithMetadata({
          category,
          names: mergedFromNames,
          organizationId: ctx.core.organizationId,
          projectId: ctx.core.projectId,
        });
      }

      // Clean up any current summaries still referencing deprecated subfacets
      if (!DRY_RUN) {
        const cleanup =
          await this.entitySummaryService.removeDeprecatedSubfacetsFromCurrentSummaries(
            {
              organizationId: ctx.core.organizationId,
              projectId: ctx.core.projectId,
              category,
            },
          );
        this.logger.log(
          `[applyConsolidation] cleanup: ${cleanup.updated} summaries updated, ${cleanup.skipped} unchanged`,
        );
      }
    }

    if (!DRY_RUN) {
      const keepAndTargetNames = Array.from(
        new Set([...targetNames, ...keptNames]),
      );
      const keepAndTargetNamesLower = new Set(
        keepAndTargetNames.map((name) => name.toLowerCase()),
      );
      const activeAndProvisionalSubfacets =
        await this.subfacetService.listByStatusAndCategory({
          organizationId: ctx.core.organizationId,
          projectId: ctx.core.projectId,
          category,
          statuses: [SubfacetStatus.ACTIVE, SubfacetStatus.PROVISIONAL],
        });
      const keepAndTargetIds = activeAndProvisionalSubfacets
        .filter((subfacet) =>
          keepAndTargetNamesLower.has(subfacet.name.toLowerCase()),
        )
        .map((subfacet) => subfacet.id);
      if (keepAndTargetIds.length) {
        await this.subfacetService.markSeenInConsolidation({
          subfacetIds: keepAndTargetIds,
          organizationId: ctx.core.organizationId,
          projectId: ctx.core.projectId,
        });
      }

      await this.subfacetService.promoteProvisionalsToActive({
        organizationId: ctx.core.organizationId,
        projectId: ctx.core.projectId,
        category,
      });
    }

    this.logger.log(
      `[applyConsolidation] category=${category} mergedGroups=${mergedSubfacets.length} targetsCreated=${targetNames.length} mergedFrom=${mergedFromNames.length} summariesUpdated=${updatedSummaries}`,
    );
  }

  private normalizeSubfacetSummary(summary: string | null | undefined): string {
    const compact = (summary || '').replace(/\s+/g, ' ').trim();
    if (!compact) {
      return 'No subfacet summary available.';
    }
    if (compact.length <= MAX_SUBFACET_SUMMARY_LENGTH) {
      return compact;
    }
    return `${compact.slice(0, MAX_SUBFACET_SUMMARY_LENGTH - 1)}…`;
  }

  private normalizeConsolidationNameConstraints(
    payload: IntermediateSystemMessageData,
  ): {
    normalizedPayload: IntermediateSystemMessageData;
    normalizationWarnings: string[];
  } {
    if (!payload || typeof payload !== 'object') {
      return { normalizedPayload: payload, normalizationWarnings: [] };
    }
    const result = payload as Record<string, unknown>;
    const normalizationWarnings: string[] = [];
    const normalizeNameField = (
      item: unknown,
      path: string,
    ): Record<string, unknown> | unknown => {
      if (!item || typeof item !== 'object') {
        return item;
      }
      const raw = item as Record<string, unknown>;
      const currentName = raw.name;
      if (typeof currentName !== 'string') {
        return item;
      }
      const normalizedName = this.normalizeSubfacetName(currentName);
      if (normalizedName !== currentName.trim()) {
        normalizationWarnings.push(
          `${path} name normalized: "${currentName}" -> "${normalizedName}"`,
        );
      }
      return {
        ...raw,
        name: normalizedName,
      };
    };

    const mergedSubfacets = Array.isArray(result.mergedSubfacets)
      ? result.mergedSubfacets.map((item, idx) =>
          normalizeNameField(item, `mergedSubfacets[${idx}]`),
        )
      : result.mergedSubfacets;
    const keptSubfacets = Array.isArray(result.keptSubfacets)
      ? result.keptSubfacets.map((item, idx) =>
          normalizeNameField(item, `keptSubfacets[${idx}]`),
        )
      : result.keptSubfacets;

    return {
      normalizedPayload: {
        ...result,
        mergedSubfacets,
        keptSubfacets,
      } as unknown as IntermediateSystemMessageData,
      normalizationWarnings,
    };
  }

  private normalizeSubfacetName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) {
      return trimmed;
    }
    const ampersandRemoved = trimmed.replace(/&/g, ' ');
    const words = ampersandRemoved.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return trimmed;
    }
    return words.slice(0, 3).join(' ');
  }

  private buildSystemPrompt(context: ConsolidationContext): string {
    const category = context.consolidationCategory;
    const subfacetBlock =
      context.selectedSubfacetBlock ?? 'No subfacet summaries available.';
    const maxEntities = context.maxEntitiesPerRun ?? DEFAULT_MAX_ENTITIES;
    const maxPerSubfacet =
      context.maxEntitiesPerSubfacet ?? DEFAULT_MAX_ENTITIES_PER_SUBFACET;
    const maxSubfacets =
      context.maxSubfacetsPerRun ?? DEFAULT_MAX_SUBFACETS_PER_RUN;
    const totalCandidates = context.accumulatedSubfacetCount ?? 0;
    const selectedCandidates = context.selectedSubfacetCount ?? 0;

    const activeCount = context.activeSubfacetCount ?? 0;
    const targetCount = MIN_SUBFACETS_FOR_CONSOLIDATION;
    const reductionNeeded = Math.max(0, activeCount - targetCount);

    const targetGuidance =
      reductionNeeded > 0
        ? `\nConsolidation target: reduce from ${activeCount} to approximately ${targetCount} subfacets (net reduction of ~${reductionNeeded}). Only merge subfacets with genuine semantic overlap — do not force merges to hit the target.\n`
        : '';

    return `You are a topology consolidation assistant. Merge overlapping subfacets within a single category to avoid facet proliferation while keeping rollups queryable.

Category: ${category}
${targetGuidance}
Subfacet candidates in this run: ${selectedCandidates}/${totalCandidates} (max ${maxSubfacets} subfacets per run)
Candidate subfacet roster (each row includes the subfacet summary; entity evidence is sampled):
${subfacetBlock}

Entity sampling budget: max ${maxEntities} entities per run, max ${maxPerSubfacet} per subfacet.

Tasks:
- Identify redundancy/overlap; propose merges with concise merged labels, mergedFrom list, summary, and justification.
- Keep unmerged subfacets explicit (reasonKept) when they should remain separate.
- Stay within the given category; do not invent new categories. Prefer renaming only when it improves clarity; justify any rename.
- Naming rule for all output subfacet names (merged + kept): maximum 3 words and never use "&".

Output shape (validated via zod):
- category
- mergedSubfacets[]: { name, mergedFrom[], summary, justification }
- keptSubfacets[]: { name, reasonKept }`;
  }
}
