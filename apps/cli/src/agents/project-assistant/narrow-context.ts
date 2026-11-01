import { DEFAULT_JEV_MODEL } from '../../jev/client';
import {
  CONTEXT_SELECTION,
  DEFAULT_WORDING,
  JEV_CUTOFFS,
  judge,
  tierOf,
  type Candidate,
  type Cutoffs,
  type Focal,
  type JevEvaluator,
  type Tier,
} from '../../jev/scenarios';
import {
  JEV_MAX_CONCURRENT_REQUESTS,
  JEV_REQUEST_MAX_CHARS,
  mapConcurrently,
  packRequests,
} from '../../jev/traversal/pack-requests';
import { withAsk } from '../../jev/traversal/walk';
import type { FullEntityContextDto } from '../../shared/api/generated';
import { firstSentence } from '../context-trimming/get-context-result';
import { contextCandidates, type ContextCandidate } from './context-candidates';

export interface NarrowContextInput {
  focal: Focal;
  context: FullEntityContextDto;
  ask: string;
  client: JevEvaluator;
  model?: string;
  cutoffs?: Cutoffs;
  maxChars?: number;
  signal?: AbortSignal;
}

export type NarrowContextResult =
  | {
      ok: true;
      context: FullEntityContextDto;
      tiers: ReadonlyMap<string, Tier>;
      usage: { requests: number; inputTokens: number; outputTokens: number };
    }
  | { ok: false; cause: unknown };

const judgeCandidate = (candidate: ContextCandidate): Candidate => ({
  id: candidate.id,
  kind: 'linked',
  // Provenance is apply-back bookkeeping, not additional evidence for the judge.
  text: JSON.stringify({
    ...candidate,
    relationships: candidate.relationships.map(({ label, source, direction }) => ({
      label,
      source,
      direction,
    })),
  }),
});

/** Narrow a local consumer copy only. No loading, fallback, or live startup wiring. */
export async function narrowContext(input: NarrowContextInput): Promise<NarrowContextResult> {
  try {
    const candidates = contextCandidates(input.context);
    const focal = withAsk(input.focal, input.ask);
    const requests = packRequests(
      CONTEXT_SELECTION,
      focal,
      candidates.map(judgeCandidate),
      DEFAULT_WORDING,
      input.maxChars ?? JEV_REQUEST_MAX_CHARS,
    );
    const results = await mapConcurrently(requests, JEV_MAX_CONCURRENT_REQUESTS, (batch) =>
      judge(
        input.client,
        input.model ?? DEFAULT_JEV_MODEL,
        CONTEXT_SELECTION,
        focal,
        batch,
        DEFAULT_WORDING,
        input.signal,
      ),
    );
    const tiers = new Map<string, Tier>();
    const usage = { requests: requests.length, inputTokens: 0, outputTokens: 0 };
    for (const result of results) {
      if (!result.ok) {
        return { ok: false, cause: result.failure };
      }
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
      for (const judgment of result.judgments) {
        tiers.set(judgment.id, tierOf(judgment, input.cutoffs ?? JEV_CUTOFFS));
      }
    }
    return { ok: true, context: applyTiers(input.context, candidates, tiers), tiers, usage };
  } catch (cause) {
    return { ok: false, cause };
  }
}

function applyTiers(
  context: FullEntityContextDto,
  candidates: ContextCandidate[],
  tiers: ReadonlyMap<string, Tier>,
): FullEntityContextDto {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const archived = new Set(
    (context.relatedEntities ?? [])
      .filter((entry) => entry.status === 'ARCHIVED')
      .map((entry) => entry.entityId),
  );
  const mergedEvidence = (id: string): { reasoning?: string; description?: string } => {
    const candidate = byId.get(id);
    if (!candidate || candidate.relationships.length < 2) {
      return {};
    }

    const relationships = candidate.relationships.map(({ label, source, direction }) =>
      [label, source, direction].filter(Boolean).join(' / '),
    );
    const reasoning = [
      ...new Set([...(candidate.context?.reasoning ?? []), ...relationships]),
    ].join('\n');
    const description = candidate.context?.truncatedDescription?.join('\n');
    return { reasoning, ...(description !== undefined ? { description } : {}) };
  };
  const seen = new Set<string>();
  const take = (id: string): boolean => {
    if (archived.has(id) || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  };
  const featureHierarchy = context.featureHierarchy
    ?.filter(({ id }) => take(id))
    .map((original) => {
      const evidence = mergedEvidence(original.id);
      const entry = Object.keys(evidence).length ? { ...original, ...evidence } : original;
      const tier = tiers.get(entry.id);
      if (!tier || tier === 'full') {
        return entry;
      }
      const { id, name, relationshipType } = entry;
      return {
        id,
        name,
        relationshipType,
        ...(tier === 'short'
          ? {
              ...(entry.description ? { description: firstSentence(entry.description) } : {}),
              ...(entry.reasoning ? { reasoning: firstSentence(entry.reasoning) } : {}),
              ...(entry.relationship ? { relationship: entry.relationship } : {}),
            }
          : {}),
      };
    });
  const relatedEntities = context.relatedEntities
    ?.filter(({ entityId }) => take(entityId))
    .map((original) => {
      const { reasoning } = mergedEvidence(original.entityId);
      const entry = reasoning ? { ...original, reasoning } : original;
      const tier = tiers.get(entry.entityId);
      if (!tier || tier === 'full') {
        return entry;
      }
      const { entityId, entityType, displayName, relationship } = entry;
      return {
        entityId,
        entityType,
        displayName,
        relationship,
        ...(tier === 'short' && entry.reasoning
          ? { reasoning: firstSentence(entry.reasoning) }
          : {}),
      };
    });
  // Proposal-only targets/influences still need an on-demand discovery entry after influences disappear.
  const extraEntries = candidates
    .filter(({ id, title }) => title !== undefined && !seen.has(id))
    .map(({ id, type, title, context: details }) => ({
      entityId: id,
      entityType: type,
      displayName: title ?? '',
      relationship: 'related-to' as const,
      ...(tiers.get(id) !== 'index' && details?.reasoning?.length
        ? {
            reasoning:
              tiers.get(id) === 'short'
                ? firstSentence(details.reasoning.join(' '))
                : details.reasoning.join('\n'),
          }
        : {}),
    }));
  return {
    ...context,
    ...(featureHierarchy ? { featureHierarchy } : {}),
    ...(relatedEntities || extraEntries.length
      ? { relatedEntities: [...(relatedEntities ?? []), ...extraEntries] }
      : {}),
    ...(context.proposals
      ? {
          proposals: context.proposals.map((proposal) => ({
            id: proposal.id,
            organizationId: proposal.organizationId,
            projectId: proposal.projectId,
            type: proposal.type,
            action: proposal.action,
            status: proposal.status,
            targetEntityId: proposal.targetEntityId,
            targetEntityType: proposal.targetEntityType,
            ...(proposal.title !== undefined ? { title: proposal.title } : {}),
            ...(proposal.eli5 !== undefined ? { eli5: proposal.eli5 } : {}),
            requestorId: proposal.requestorId,
            requiredApprovals: proposal.requiredApprovals,
            approvals: [],
            changes: [],
            createdAt: proposal.createdAt,
            updatedAt: proposal.updatedAt,
          })),
        }
      : {}),
  };
}
