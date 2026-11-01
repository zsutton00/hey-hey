import type { EdgeSource, FullEntityContextDto } from '../../shared/api/generated';
import { entityEntriesOf } from '../context-trimming/entity-entries';

export type CandidateProvenance =
  | { section: 'featureHierarchy' | 'relatedEntities'; position: number }
  | { section: 'proposals'; proposalId: string; role: 'target' }
  | { section: 'proposals'; proposalId: string; role: 'influence'; position: number };

export interface ContextCandidate {
  id: string;
  type: string;
  /** Absent when a proposal has no title snapshot and no other source supplies one. */
  title?: string;
  status?: string;
  relationships: {
    label: string;
    /** Missing source stays unknown rather than being guessed. */
    source?: EdgeSource;
    direction?: 'inbound' | 'outbound';
    provenance: CandidateProvenance;
  }[];
  /** Arrays preserve distinct values when an entity is reached through multiple routes. */
  context?: {
    truncatedDescription?: string[];
    reasoning?: string[];
    proposalPurpose?: string[];
  };
}

type CandidateEntry = Omit<ContextCandidate, 'relationships'> & {
  relationship: ContextCandidate['relationships'][number];
};

/** Pure projection of the prepared canonical context; never loads entities or calls Jev. */
export function contextCandidates(context: FullEntityContextDto): ContextCandidate[] {
  const candidates = new Map<string, ContextCandidate>();
  const excluded = new Set([context.entityId]);
  for (const entry of context.relatedEntities ?? []) {
    if (entry.status === 'ARCHIVED') {
      excluded.add(entry.entityId);
    }
  }

  const add = ({ relationship, ...entry }: CandidateEntry): void => {
    if (excluded.has(entry.id) || entry.type === 'AGENT_SESSION' || entry.type === 'REPORT') {
      return;
    }

    const candidate = candidates.get(entry.id);
    if (!candidate) {
      candidates.set(entry.id, { ...entry, relationships: [relationship] });
      return;
    }

    if (candidate.title === undefined && entry.title !== undefined) {
      candidate.title = entry.title;
    }
    if (candidate.status === undefined && entry.status !== undefined) {
      candidate.status = entry.status;
    }
    candidate.relationships.push(relationship);
    if (entry.context) {
      candidate.context ??= {};
      for (const key of ['truncatedDescription', 'reasoning', 'proposalPurpose'] as const) {
        const values = entry.context[key];
        if (values) {
          candidate.context[key] = [...new Set([...(candidate.context[key] ?? []), ...values])];
        }
      }
    }
  };

  for (const row of entityEntriesOf(context)) {
    const provenance = { section: row.section, position: row.position };
    if (row.section === 'relatedEntities') {
      const entry = row.entry;
      add({
        id: entry.entityId,
        type: entry.entityType,
        title: entry.displayName,
        ...(entry.status !== undefined ? { status: entry.status } : {}),
        relationship: {
          label: entry.relationship,
          ...(entry.source ? { source: entry.source } : {}),
          provenance,
        },
        ...(entry.source === 'agent' && entry.reasoning !== undefined
          ? { context: { reasoning: [entry.reasoning] } }
          : {}),
      });
      continue;
    }

    const entry = row.entry;
    const structural = entry.relationshipType === 'structural';
    const source =
      structural || entry.relationshipType === 'PROPOSED_TOGETHER'
        ? 'system'
        : (entry.source ?? 'agent');
    const details: NonNullable<ContextCandidate['context']> = {};
    if (entry.description != null) {
      details.truncatedDescription = [entry.description];
    }
    if (source === 'agent' && entry.reasoning !== undefined) {
      details.reasoning = [entry.reasoning];
    }
    add({
      id: entry.id,
      type: 'TASK',
      title: entry.name,
      relationship: {
        label: structural ? (entry.relationship ?? entry.relationshipType) : entry.relationshipType,
        source,
        ...(entry.direction ? { direction: entry.direction } : {}),
        provenance,
      },
      ...(Object.keys(details).length ? { context: details } : {}),
    });
  }

  for (const proposal of context.proposals ?? []) {
    const purpose = proposal.eli5 !== undefined ? { proposalPurpose: [proposal.eli5] } : {};
    add({
      id: proposal.targetEntityId,
      type: proposal.targetEntityType,
      ...(proposal.title != null ? { title: proposal.title } : {}),
      relationship: {
        label: 'proposal-target',
        source: 'system',
        provenance: { section: 'proposals', proposalId: proposal.id, role: 'target' },
      },
      ...(proposal.eli5 !== undefined ? { context: purpose } : {}),
    });
    for (const [position, influence] of (proposal.influences ?? []).entries()) {
      add({
        id: influence.entityId,
        type: influence.entityType,
        ...(influence.entityTitle != null ? { title: influence.entityTitle } : {}),
        relationship: {
          label: influence.reasonType,
          source: ['origin', 'user_reason'].includes(influence.reasonType) ? 'system' : 'agent',
          provenance: {
            section: 'proposals',
            proposalId: proposal.id,
            role: 'influence',
            position,
          },
        },
        context: { ...purpose, reasoning: [influence.reasoning] },
      });
    }
  }

  return [...candidates.values()];
}
