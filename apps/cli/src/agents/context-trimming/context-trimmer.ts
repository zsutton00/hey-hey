import type { z } from 'zod';
import { DEFAULT_JEV_MODEL } from '../../jev/client';
import { jevCostUsd } from '../../jev/pricing';
import {
  CONTEXT_SELECTION,
  JEV_CUTOFFS,
  DEFAULT_WORDING,
  judge,
  tierOf,
  type Cutoffs,
  type Focal,
  type JevEvaluator,
  type RelevanceJudgment,
  type Tier,
} from '../../jev/scenarios';
import { recordJevCalls } from '../project-assistant/parent-requirements-attempt-log';
import type { ServerLogger } from '../../server/logger';
import type { JsonObject, JsonValue } from '../platform-mcp-proxy/session';
import {
  contextResultSchema,
  rebuild,
  slotsOf,
  type Placed,
  type RelationToFocal,
  type Slot,
} from './get-context-result';
import {
  writeGraphResultAttemptRecord,
  type GetContextAttemptRecord,
  type GetContextEntryRecord,
  type GetEdgesAttemptRecord,
  type GetEdgesEntryRecord,
} from './get-context-attempt-log';
import { edgeIndex, edgeSlotsOf, edgesResultSchema, type EdgeSlot } from './get-edges-result';

export interface GetContextTrimmerConfig {
  decisionModel: DecisionModel;
  focal: Focal;
  focalEntityId: string;
  ancestorEntityIds?: ReadonlySet<string>;
  logger: ServerLogger;
  model?: string;
  cutoffs?: Cutoffs;
  /** Where each get_context call writes its development trace, narrowed or not; null writes none. */
  attemptLogDir?: string | null;
  /** Where each get_edges call writes its development trace, narrowed or not; null writes none. */
  edgesAttemptLogDir?: string | null;
}

/** Provider-neutral interface used by the graph-result wrapper. */
export type DecisionModel = JevEvaluator;

export interface DecisionModelResultNarrower {
  narrowContextResult(upstream: JsonValue): Promise<JsonValue>;
  narrowEdgesResult(upstream: JsonValue): Promise<JsonValue>;
}

const TIER_RANK: Record<Tier, number> = { full: 0, short: 1, index: 2 };

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const relationToFocalOf = ({ relationships }: RelevanceJudgment): RelationToFocal =>
  relationships.implements >= relationships.informs ? 'implements' : 'informs';

const describeIssues = (error: z.ZodError): string[] =>
  error.issues.map((issue) => `${issue.path.join('.')}: ${issue.code}`);

/** Why a result was returned as the upstream sent it. Never carries entity content. */
class Untrimmed extends Error {
  public constructor(
    public readonly reason: string,
    public readonly fields: Record<string, unknown> = {},
  ) {
    super(reason);
  }
}

export class GetContextTrimmer implements DecisionModelResultNarrower {
  private readonly model: string;
  private readonly cutoffs: Cutoffs;

  public constructor(private readonly config: GetContextTrimmerConfig) {
    this.model = config.model ?? DEFAULT_JEV_MODEL;
    this.cutoffs = config.cutoffs ?? JEV_CUTOFFS;
  }

  /**
   * The `get_context` tool result with its non-ancestor entries abbreviated by relevance to
   * the focal work. Whatever prevents that (a Decision Model failure, a result of another shape) logs
   * its cause and returns the upstream result itself: a helper that cannot help must not
   * block the session. Either way the call leaves a development trace.
   */
  public async trimResult(upstream: JsonValue): Promise<JsonValue> {
    const recorder = recordJevCalls(this.config.decisionModel);
    try {
      return await this.trim(upstream, recorder);
    } catch (error) {
      let reason: string;
      let fields: Record<string, unknown>;
      if (error instanceof Untrimmed) {
        reason = error.reason;
        fields = error.fields;
        this.config.logger.warn('local.platform_mcp_proxy.get_context_trim.untrimmed', {
          reason,
          ...fields,
        });
      } else {
        reason = 'unexpected_error';
        fields = { error: error instanceof Error ? (error.stack ?? error.message) : String(error) };
        this.config.logger.error('local.platform_mcp_proxy.get_context_trim.failed', {
          errorName: error instanceof Error ? error.name : 'unknown',
        });
      }

      await this.writeAttempt({
        outcome: 'passed_through',
        at: new Date().toISOString(),
        focalEntityId: this.config.focalEntityId,
        focal: this.config.focal,
        model: this.model,
        reason,
        fields,
        jevCalls: recorder.calls,
      });
      return upstream;
    }
  }

  public narrowContextResult(upstream: JsonValue): Promise<JsonValue> {
    return this.trimResult(upstream);
  }

  /** Narrow direct graph edges with the same context-selection judgment as get_context. */
  public async trimEdgesResult(upstream: JsonValue): Promise<JsonValue> {
    const recorder = recordJevCalls(this.config.decisionModel);
    try {
      if (!isJsonObject(upstream) || upstream['isError'] === true) {
        throw new Untrimmed('upstream_error_or_invalid_result');
      }
      const structured = upstream['structuredContent'];
      let original: JsonValue;
      let isStructured = false;
      if (isJsonObject(structured)) {
        original = structured;
        isStructured = true;
      } else {
        const content = upstream['content'];
        const block = Array.isArray(content) && content.length === 1 ? content[0] : undefined;
        if (!isJsonObject(block) || block['type'] !== 'text' || typeof block['text'] !== 'string') {
          throw new Untrimmed('not_a_single_text_block');
        }
        try {
          original = JSON.parse(block['text']) as JsonValue;
        } catch {
          throw new Untrimmed('result_text_not_json');
        }
      }

      const parsed = edgesResultSchema.safeParse(original);
      if (!parsed.success) {
        throw new Untrimmed('unrecognized_edges_shape', { issues: describeIssues(parsed.error) });
      }
      if (!isJsonObject(original) || !isJsonObject(original['edgesByEntity'])) {
        throw new Untrimmed('unrecognized_edges_shape');
      }
      const rawEdgesByEntity = original['edgesByEntity'];
      const slots = edgeSlotsOf(
        parsed.data,
        new Set([this.config.focalEntityId, ...(this.config.ancestorEntityIds ?? [])]),
      );
      const candidates = slots.flatMap(({ candidate }) => (candidate ? [candidate] : []));
      if (candidates.length === 0) throw new Untrimmed('no_candidates');

      const judged = await judge(
        recorder.evaluator,
        this.model,
        CONTEXT_SELECTION,
        this.config.focal,
        candidates,
        DEFAULT_WORDING,
      );
      if (!judged.ok) {
        throw new Untrimmed('decision_model_failed', {
          failureCode: judged.failure.code,
          ...(judged.failure.providerStatus !== undefined
            ? { providerStatus: judged.failure.providerStatus }
            : {}),
        });
      }
      const judgmentById = new Map(judged.judgments.map((judgment) => [judgment.id, judgment]));
      const tierCounts: Record<Tier, number> = { full: 0, short: 0, index: 0 };
      const records: GetEdgesEntryRecord[] = [];
      const entriesBySeed = new Map<
        string,
        Array<{ entry: JsonValue; tier: Tier; score: number }>
      >();
      for (const slot of slots) {
        const seedEdges = rawEdgesByEntity[slot.seedId];
        const rawEntry = Array.isArray(seedEdges) ? seedEdges[slot.position] : undefined;
        if (rawEntry === undefined) throw new Untrimmed('unrecognized_edges_shape');
        if (!slot.candidate) {
          tierCounts.full += 1;
          records.push({
            seedId: slot.seedId,
            position: slot.position,
            tier: 'full',
            judgedByDecisionModel: false,
            text: JSON.stringify(rawEntry),
          });
          const entries = entriesBySeed.get(slot.seedId) ?? [];
          entries.push({ entry: rawEntry, tier: 'full', score: 1 });
          entriesBySeed.set(slot.seedId, entries);
          continue;
        }
        const judgment = judgmentById.get(slot.candidate.id);
        if (!judgment) throw new Error('Decision Model omitted an edge judgment.');
        const tier = tierOf(judgment, this.cutoffs);
        tierCounts[tier] += 1;
        records.push({
          seedId: slot.seedId,
          position: slot.position,
          tier,
          relevance: judgment.relevance,
          judgedByDecisionModel: true,
          text: slot.candidate.text,
        });
        const entry = tier === 'index' ? edgeIndex(slot.entry) : rawEntry;
        const entries = entriesBySeed.get(slot.seedId) ?? [];
        entries.push({ entry, tier, score: judgment.relevance });
        entriesBySeed.set(slot.seedId, entries);
      }
      const rank: Record<Tier, number> = { full: 0, short: 1, index: 2 };
      const edgesByEntity: JsonObject = Object.fromEntries(
        Object.entries(rawEdgesByEntity).map(([seedId, seedEdges]) => {
          if (!Array.isArray(seedEdges)) throw new Untrimmed('unrecognized_edges_shape');
          const ordered = (entriesBySeed.get(seedId) ?? [])
            .sort((a, b) => rank[a.tier] - rank[b.tier] || b.score - a.score)
            .map(({ entry }) => entry);
          return [seedId, ordered];
        }),
      );
      const narrowed: JsonObject = { ...original, edgesByEntity };
      const resultText = JSON.stringify(narrowed);
      const rawText = JSON.stringify(original);
      const rawSize = rawText.length;
      this.config.logger.debug('local.platform_mcp_proxy.get_edges_trim.trimmed', {
        rawSize,
        narrowedSize: resultText.length,
        candidateCount: candidates.length,
        tierCounts,
        decisionModelDurationMs: judged.durationMs,
        inputTokens: judged.usage.inputTokens,
        outputTokens: judged.usage.outputTokens,
      });
      await this.writeEdgesAttempt({
        outcome: 'narrowed',
        at: new Date().toISOString(),
        costUsd: jevCostUsd(judged.usage),
        inputTokens: judged.usage.inputTokens,
        outputTokens: judged.usage.outputTokens,
        decisionModelDurationMs: judged.durationMs,
        rawResultChars: rawSize,
        narrowedResultChars: resultText.length,
        tierCounts,
        focalEntityId: this.config.focalEntityId,
        model: this.model,
        focal: this.config.focal,
        jevCalls: recorder.calls,
        entries: records,
        rawResult: rawText,
        narrowedResult: resultText,
      });
      if (isStructured) {
        const content = upstream['content'];
        const block = Array.isArray(content) && content.length === 1 ? content[0] : undefined;
        if (isJsonObject(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
          try {
            const contentResult: unknown = JSON.parse(block['text']);
            if (edgesResultSchema.safeParse(contentResult).success) {
              return {
                ...upstream,
                structuredContent: narrowed,
                content: [{ ...block, text: resultText }],
              };
            }
          } catch {
            // Structured output is authoritative when the text block is not JSON.
          }
        }
        return { ...upstream, structuredContent: narrowed };
      }
      const content = upstream['content'];
      const block = Array.isArray(content) ? content[0] : undefined;
      return isJsonObject(block)
        ? { ...upstream, content: [{ ...block, text: resultText }] }
        : upstream;
    } catch (error) {
      let reason: string;
      let fields: Record<string, unknown>;
      if (error instanceof Untrimmed) {
        reason = error.reason;
        fields = error.fields;
        this.config.logger.warn('local.platform_mcp_proxy.get_edges_trim.untrimmed', {
          reason,
          ...fields,
        });
      } else {
        reason = 'unexpected_error';
        fields = { error: error instanceof Error ? (error.stack ?? error.message) : String(error) };
        this.config.logger.error('local.platform_mcp_proxy.get_edges_trim.failed', {
          errorName: error instanceof Error ? error.name : 'unknown',
        });
      }

      await this.writeEdgesAttempt({
        outcome: 'passed_through',
        at: new Date().toISOString(),
        focalEntityId: this.config.focalEntityId,
        focal: this.config.focal,
        model: this.model,
        reason,
        fields,
        jevCalls: recorder.calls,
      });
      return upstream;
    }
  }

  public narrowEdgesResult(upstream: JsonValue): Promise<JsonValue> {
    return this.trimEdgesResult(upstream);
  }

  private async trim(
    upstream: JsonValue,
    recorder: ReturnType<typeof recordJevCalls>,
  ): Promise<JsonValue> {
    if (!isJsonObject(upstream)) throw new Untrimmed('tool_result_not_object');
    if (upstream['isError'] === true) throw new Untrimmed('upstream_error_result');
    if ('structuredContent' in upstream) throw new Untrimmed('structured_content_present');
    const content = upstream['content'];
    const block = Array.isArray(content) && content.length === 1 ? content[0] : undefined;
    if (!isJsonObject(block) || block['type'] !== 'text') {
      throw new Untrimmed('not_a_single_text_block');
    }
    const text = block['text'];
    if (typeof text !== 'string') throw new Untrimmed('not_a_single_text_block');

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(text);
    } catch {
      throw new Untrimmed('result_text_not_json');
    }
    const parsed = contextResultSchema.safeParse(rawJson);
    if (!parsed.success) {
      throw new Untrimmed('unrecognized_context_shape', { issues: describeIssues(parsed.error) });
    }

    const slots = slotsOf(parsed.data, this.config.focalEntityId);
    const candidates = slots.flatMap(({ candidate }) => (candidate ? [candidate] : []));
    if (candidates.length === 0) {
      throw new Untrimmed('no_candidates', { slotCount: slots.length });
    }

    const judged = await judge(
      recorder.evaluator,
      this.model,
      CONTEXT_SELECTION,
      this.config.focal,
      candidates,
      DEFAULT_WORDING,
    );
    if (!judged.ok) {
      throw new Untrimmed('decision_model_failed', {
        failureCode: judged.failure.code,
        ...(judged.failure.providerStatus !== undefined
          ? { providerStatus: judged.failure.providerStatus }
          : {}),
      });
    }

    const judgmentById = new Map(judged.judgments.map((judgment) => [judgment.id, judgment]));
    const tierCounts: Record<Tier, number> = { full: 0, short: 0, index: 0 };
    const entries: GetContextEntryRecord[] = [];
    const placed = slots.map((slot): Placed => {
      const { tier, placement } = this.place(slot, judgmentById);
      tierCounts[tier] += 1;
      const judgment = slot.candidate ? judgmentById.get(slot.candidate.id) : undefined;
      entries.push({
        section: slot.section,
        position: slot.position,
        tier,
        ...(judgment ? { relevance: judgment.relevance } : {}),
        judgedByDecisionModel: slot.candidate !== null,
        text: slot.candidate ? slot.candidate.text : JSON.stringify(slot.entry),
      });
      return placement;
    });
    const abbreviated = tierCounts.short + tierCounts.index;
    const trimmed = rebuild(parsed.data, placed);
    const trimmedText = JSON.stringify(
      abbreviated > 0
        ? {
            ...trimmed,
            contextTrimmed: `${String(abbreviated)} entries were abbreviated by relevance to the current work; read any entity itself for its full text.`,
          }
        : trimmed,
      null,
      text.includes('\n') ? 2 : undefined,
    );

    this.config.logger.debug('local.platform_mcp_proxy.get_context_trim.trimmed', {
      rawSize: text.length,
      narrowedSize: trimmedText.length,
      candidateCount: candidates.length,
      keptInFullWithoutDecisionModel: slots.length - candidates.length,
      tierCounts,
      decisionModelDurationMs: judged.durationMs,
      inputTokens: judged.usage.inputTokens,
      outputTokens: judged.usage.outputTokens,
    });
    await this.writeAttempt({
      outcome: 'narrowed',
      at: new Date().toISOString(),
      costUsd: jevCostUsd(judged.usage),
      inputTokens: judged.usage.inputTokens,
      outputTokens: judged.usage.outputTokens,
      decisionModelDurationMs: judged.durationMs,
      rawResultChars: text.length,
      narrowedResultChars: trimmedText.length,
      tierCounts,
      focalEntityId: this.config.focalEntityId,
      model: this.model,
      focal: this.config.focal,
      jevCalls: recorder.calls,
      entries,
    });
    return { ...upstream, content: [{ ...block, text: trimmedText }] };
  }

  private writeAttempt(record: GetContextAttemptRecord): Promise<void> {
    return this.writeTrace(this.config.attemptLogDir, 'get_context_trim', record);
  }

  private writeEdgesAttempt(record: GetEdgesAttemptRecord): Promise<void> {
    return this.writeTrace(this.config.edgesAttemptLogDir, 'get_edges_trim', record);
  }

  /** A trace that cannot be written must not change the result the agent receives. */
  private async writeTrace(
    dir: string | null | undefined,
    eventPrefix: 'get_context_trim' | 'get_edges_trim',
    record: GetContextAttemptRecord | GetEdgesAttemptRecord,
  ): Promise<void> {
    if (!dir) {
      return;
    }

    try {
      const file = await writeGraphResultAttemptRecord(dir, record);
      this.config.logger.debug(`local.platform_mcp_proxy.${eventPrefix}.attempt_logged`, {
        file,
      });
    } catch (error) {
      this.config.logger.warn(`local.platform_mcp_proxy.${eventPrefix}.attempt_log_failed`, {
        errorName: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  private place(
    slot: Slot,
    judgments: ReadonlyMap<string, RelevanceJudgment>,
  ): { tier: Tier; placement: Placed } {
    if (!slot.candidate) {
      return { tier: 'full', placement: { slot, entry: slot.entry, tierRank: 0, relevance: 1 } };
    }
    const judgment = judgments.get(slot.candidate.id);
    if (!judgment) throw new Error(`Jev returned no judgment for candidate ${slot.candidate.id}.`);
    const tier = tierOf(judgment, this.cutoffs);
    const entry =
      tier === 'full'
        ? slot.entry
        : tier === 'short'
          ? slot.short(relationToFocalOf(judgment))
          : slot.index();
    return {
      tier,
      placement: { slot, entry, tierRank: TIER_RANK[tier], relevance: judgment.relevance },
    };
  }
}
