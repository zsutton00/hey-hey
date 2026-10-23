import type { z } from 'zod';
import { DEFAULT_JEV_MODEL, type JevInput, type JevResult } from '../../jev/client';
import {
  CONTEXT_SELECTION,
  JEV_CUTOFFS,
  cacheKey,
  DEFAULT_WORDING,
  judge,
  tierOf,
  type Cutoffs,
  type Focal,
  type JevEvaluator,
  type RelevanceJudgment,
  type Tier,
} from '../../jev/scenarios';
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

export type JevResponseCache = Map<string, Extract<JevResult, { ok: true }>>;

export interface GetContextTrimmerConfig {
  client: JevEvaluator;
  focal: Focal;
  focalEntityId: string;
  /** Held by the Run, so a Turn's trimmer reuses answers an earlier Turn paid for. */
  cache: JevResponseCache;
  logger: ServerLogger;
  model?: string;
  cutoffs?: Cutoffs;
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

export class GetContextTrimmer {
  private readonly model: string;
  private readonly cutoffs: Cutoffs;

  public constructor(private readonly config: GetContextTrimmerConfig) {
    this.model = config.model ?? DEFAULT_JEV_MODEL;
    this.cutoffs = config.cutoffs ?? JEV_CUTOFFS;
  }

  /**
   * The `get_context` tool result with its non-ancestor entries abbreviated by relevance to
   * the focal work. Whatever prevents that (a Jev failure, a result of another shape) logs
   * its cause and returns the upstream result itself: a helper that cannot help must not
   * block the session.
   */
  public async trimResult(upstream: JsonValue): Promise<JsonValue> {
    try {
      return await this.trim(upstream);
    } catch (error) {
      if (error instanceof Untrimmed) {
        this.config.logger.warn('local.platform_mcp_proxy.get_context_trim.untrimmed', {
          reason: error.reason,
          ...error.fields,
        });
      } else {
        this.config.logger.error('local.platform_mcp_proxy.get_context_trim.failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return upstream;
    }
  }

  private async trim(upstream: JsonValue): Promise<JsonValue> {
    const startedAt = performance.now();
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
    if (candidates.length === 0) throw new Untrimmed('no_candidates');

    const lookup = { cacheHit: false };
    const evaluator: JevEvaluator = {
      evaluate: async (input: JevInput) => {
        const key = cacheKey(input.state, input.questions, input.model);
        const cached = this.config.cache.get(key);
        if (cached) {
          lookup.cacheHit = true;
          return cached;
        }
        const result = await this.config.client.evaluate(input);
        if (result.ok) this.config.cache.set(key, result);
        return result;
      },
    };
    const judged = await judge(
      evaluator,
      this.model,
      CONTEXT_SELECTION,
      this.config.focal,
      candidates,
      DEFAULT_WORDING,
    );
    if (!judged.ok) {
      throw new Untrimmed('jev_failed', {
        failureCode: judged.failure.code,
        ...(judged.failure.providerStatus !== undefined
          ? { providerStatus: judged.failure.providerStatus }
          : {}),
      });
    }

    const judgmentById = new Map(judged.judgments.map((judgment) => [judgment.id, judgment]));
    const tierCounts: Record<Tier, number> = { full: 0, short: 0, index: 0 };
    const placed = slots.map((slot): Placed => {
      const { tier, placement } = this.place(slot, judgmentById);
      tierCounts[tier] += 1;
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
      rawChars: text.length,
      trimmedChars: trimmedText.length,
      candidateCount: candidates.length,
      keptInFullWithoutJev: slots.length - candidates.length,
      tierCounts,
      jevDurationMs: Math.round(performance.now() - startedAt),
      inputTokens: lookup.cacheHit ? 0 : judged.usage.inputTokens,
      outputTokens: lookup.cacheHit ? 0 : judged.usage.outputTokens,
      cacheHit: lookup.cacheHit,
    });
    return { ...upstream, content: [{ ...block, text: trimmedText }] };
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
