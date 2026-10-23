import { z } from 'zod';
import type { Candidate } from '../../jev/scenarios';

/**
 * The part of a singular `get_context` result that trimming reads. Every other field passes
 * through untouched, so the platform can add to the projection without this schema knowing.
 */
const hierarchyEntrySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullish(),
    relationshipType: z.string(),
    relationship: z.enum(['ancestor', 'descendant', 'sibling']).optional(),
  })
  .passthrough();

const relatedEntitySchema = z
  .object({
    entityId: z.string(),
    entityType: z.string(),
    displayName: z.string(),
    status: z.string().optional(),
    taskType: z.string().optional(),
    relationship: z.string(),
    reasoning: z.string().optional(),
  })
  .passthrough();

const agentSessionSchema = z
  .object({
    entityId: z.string(),
    entityType: z.string(),
    displayName: z.string(),
    status: z.string().optional(),
  })
  .passthrough();

const requirementRecordSchema = z
  .object({
    id: z.string(),
    statement: z.string(),
    fulfilledBy: z.array(z.object({ entityId: z.string() }).passthrough()),
  })
  .passthrough();

const contentSchema = z
  .object({
    requirementsSection: z
      .object({ records: z.array(requirementRecordSchema) })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const contextResultSchema = z
  .object({
    entityId: z.string(),
    featureHierarchy: z.array(hierarchyEntrySchema).optional(),
    relatedEntities: z.array(relatedEntitySchema).optional(),
    agentSessions: z.array(agentSessionSchema).optional(),
    content: contentSchema.optional(),
  })
  .passthrough();

export type ContextResult = z.infer<typeof contextResultSchema>;

/** How an abbreviated entry relates to the focal work; only these two earn a short form. */
export type RelationToFocal = 'implements' | 'informs';

type Entry = object;

/** One entry of a list that trimming may abbreviate, with the forms it can take. */
export interface Slot {
  section: 'featureHierarchy' | 'relatedEntities' | 'agentSessions' | 'requirements';
  /** Position in the section's original list. */
  position: number;
  entry: Entry;
  /** Null when the graph already settles that the entry stays in full, so Jev is not asked. */
  candidate: Candidate | null;
  short(relation: RelationToFocal): Entry;
  index(): Entry;
}

export const firstSentence = (text: string): string => {
  const flat = text.trim().replace(/\s+/g, ' ');
  return /^.*?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat;
};

const withSummary = (summary: string | null | undefined): { summary?: string } => {
  const sentence = summary ? firstSentence(summary) : '';
  return sentence ? { summary: sentence } : {};
};

const hierarchySlot = (
  entry: z.infer<typeof hierarchyEntrySchema>,
  position: number,
  kind: Candidate['kind'],
): Slot => {
  const { id, name, description, relationshipType, relationship } = entry;
  const identity = { id, name, relationshipType, ...(relationship ? { relationship } : {}) };
  return {
    section: 'featureHierarchy',
    position,
    entry,
    candidate: {
      id: `hierarchy:${String(position)}`,
      kind,
      text: `${name}\n${description ?? ''}`.trim(),
    },
    short: (relationToFocal) => ({ ...identity, relationToFocal, ...withSummary(description) }),
    index: () => ({ id, name }),
  };
};

const relatedSlot = (entry: z.infer<typeof relatedEntitySchema>, position: number): Slot => {
  const { entityId, entityType, displayName, status, taskType, relationship, reasoning } = entry;
  const label = [entityType, taskType].filter(Boolean).join(' ');
  const identity = {
    entityId,
    entityType,
    displayName,
    ...(status ? { status } : {}),
    ...(taskType ? { taskType } : {}),
  };
  return {
    section: 'relatedEntities',
    position,
    entry,
    candidate: {
      id: `related:${String(position)}`,
      kind: 'linked',
      text: `${displayName} (${label}; ${relationship})${reasoning ? `: ${reasoning}` : ''}`,
    },
    short: (relationToFocal) => ({
      ...identity,
      relationship,
      relationToFocal,
      ...withSummary(reasoning),
    }),
    index: () => ({ entityId, entityType, displayName }),
  };
};

const sessionSlot = (entry: z.infer<typeof agentSessionSchema>, position: number): Slot => {
  const { entityId, entityType, displayName, status } = entry;
  return {
    section: 'agentSessions',
    position,
    entry,
    candidate: {
      id: `session:${String(position)}`,
      kind: 'linked',
      text: status ? `${displayName} (${status})` : displayName,
    },
    short: (relationToFocal) => ({
      entityId,
      entityType,
      displayName,
      ...(status ? { status } : {}),
      relationToFocal,
    }),
    index: () => ({ entityId, entityType, displayName }),
  };
};

const requirementSlot = (
  entry: z.infer<typeof requirementRecordSchema>,
  position: number,
  fulfilledByFocal: boolean,
): Slot => {
  const { id, statement } = entry;
  const title = { id, statement: firstSentence(statement) };
  return {
    section: 'requirements',
    position,
    entry,
    candidate: fulfilledByFocal
      ? null
      : { id: `requirement:${String(position)}`, kind: 'requirement', text: statement },
    short: (relationToFocal) => ({ ...title, relationToFocal }),
    index: () => title,
  };
};

const hierarchyKind = (relationship: 'descendant' | 'sibling' | undefined): Candidate['kind'] => {
  switch (relationship) {
    case 'descendant':
      return 'child';
    case 'sibling':
      return 'sibling';
    case undefined:
      return 'linked';
  }
};

/**
 * Every entry trimming may abbreviate. The seed's ancestors stay out. The seed's own
 * requirements stay out when the seed is the focal entity, since they are the focal work.
 */
export const slotsOf = (result: ContextResult, focalEntityId: string): Slot[] => {
  const slots: Slot[] = [];
  (result.featureHierarchy ?? []).forEach((entry, position) => {
    if (entry.relationship === 'ancestor') return;
    slots.push(hierarchySlot(entry, position, hierarchyKind(entry.relationship)));
  });
  (result.relatedEntities ?? []).forEach((entry, position) => {
    slots.push(relatedSlot(entry, position));
  });
  (result.agentSessions ?? []).forEach((entry, position) => {
    slots.push(sessionSlot(entry, position));
  });
  if (result.entityId !== focalEntityId) {
    (result.content?.requirementsSection?.records ?? []).forEach((entry, position) => {
      const fulfilledByFocal = entry.fulfilledBy.some(({ entityId }) => entityId === focalEntityId);
      slots.push(requirementSlot(entry, position, fulfilledByFocal));
    });
  }
  return slots;
};

/** A slot's entry as it will be returned, and where it ranks in its list. */
export interface Placed {
  slot: Slot;
  entry: Entry;
  /** 0 full, 1 short, 2 id and title. */
  tierRank: number;
  relevance: number;
}

const byRelevance = (a: Placed, b: Placed): number =>
  a.tierRank - b.tierRank || b.relevance - a.relevance;

const reordered = <T>(original: readonly T[], section: Slot['section'], placed: Placed[]): T[] => {
  const mine = placed.filter(({ slot }) => slot.section === section);
  const taken = new Set(mine.map(({ slot }) => slot.position));
  const kept = original.filter((_, position) => !taken.has(position));
  // Entries trimming does not own (the seed's ancestors) keep their place ahead of the ranked ones.
  return [...kept, ...[...mine].sort(byRelevance).map(({ entry }) => entry as T)];
};

/** The result with every placed entry replaced and each list ordered by tier, then relevance. */
export const rebuild = (result: ContextResult, placed: Placed[]): ContextResult => {
  const requirements = result.content?.requirementsSection;
  return {
    ...result,
    ...(result.featureHierarchy
      ? { featureHierarchy: reordered(result.featureHierarchy, 'featureHierarchy', placed) }
      : {}),
    ...(result.relatedEntities
      ? { relatedEntities: reordered(result.relatedEntities, 'relatedEntities', placed) }
      : {}),
    ...(result.agentSessions
      ? { agentSessions: reordered(result.agentSessions, 'agentSessions', placed) }
      : {}),
    ...(result.content && requirements
      ? {
          content: {
            ...result.content,
            requirementsSection: {
              ...requirements,
              records: reordered(requirements.records, 'requirements', placed),
            },
          },
        }
      : {}),
  };
};
