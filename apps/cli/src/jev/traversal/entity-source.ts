import { z } from 'zod';
import type { Candidate } from '../scenarios';
import type { FoundCandidate, TitledRef } from './types';

const refSchema = z.object({ id: z.string().min(1), kind: z.string().min(1) });

const citationsSchema = z.array(refSchema.extend({ title: z.string() }));

/**
 * Everything the walk needs to know about one entity, in the one shape both readers produce:
 * the live reader builds it from platform reads, the snapshot stores it. Candidates are
 * derived from it by `candidatesOf` and nowhere else.
 */
export const entitySourceSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  title: z.string(),
  /** The entity in full: what a read returns. */
  text: z.string(),
  edges: z.array(
    refSchema.extend({
      title: z.string(),
      relationship: z.string().min(1),
      reasoning: z.string().optional(),
    }),
  ),
  requirements: z.array(
    z.object({
      statement: z.string(),
      fulfilledBy: citationsSchema,
      designedBy: citationsSchema,
      contracts: citationsSchema,
    }),
  ),
});

export type EntitySource = z.infer<typeof entitySourceSchema>;

const MENTION = /@\[([a-z_]+):([0-9a-f-]{36})\|([^\]]*)\]/g;

const firstSentence = (text: string): string => {
  const flat = text.trim().replace(/\s+/g, ' ');
  return /^.*?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat;
};

const REQUIREMENT_ROLES = {
  fulfilledBy: 'fulfills requirement',
  designedBy: 'designs requirement',
  contracts: 'contract for requirement',
} as const;

/**
 * The entities a walk may read next from `source`: its edges, the entities its requirements
 * cite as `fulfilledBy`, `designedBy` or Contract, and the entities its content mentions.
 * The entity itself is never a candidate, and an entity reached several ways appears once,
 * under the first way in that order.
 */
export const candidatesOf = (source: EntitySource): FoundCandidate[] => {
  const found = new Map<string, FoundCandidate>();
  const add = (kind: Candidate['kind'], ref: TitledRef, text: string): void => {
    if (ref.id === source.id || found.has(ref.id)) return;
    found.set(ref.id, { candidate: { id: ref.id, kind, text }, ref });
  };

  for (const edge of source.edges) {
    const reasoning = edge.reasoning ? ` · ${edge.reasoning}` : '';
    add(
      'linked',
      { id: edge.id, kind: edge.kind, title: edge.title },
      `${edge.relationship} · ${edge.title} (${edge.kind})${reasoning}`,
    );
  }
  for (const requirement of source.requirements) {
    const statement = firstSentence(requirement.statement);
    for (const field of Object.keys(REQUIREMENT_ROLES) as (keyof typeof REQUIREMENT_ROLES)[]) {
      for (const cited of requirement[field]) {
        add(
          'mentioned',
          { id: cited.id, kind: cited.kind, title: cited.title },
          `${REQUIREMENT_ROLES[field]} · ${cited.title} (${cited.kind}) · "${statement}" of ${source.title}`,
        );
      }
    }
  }
  for (const [, kind, id, title] of source.text.matchAll(MENTION)) {
    if (kind === undefined || id === undefined || title === undefined) continue;
    add('mentioned', { id, kind, title }, `mentioned in ${source.title} · ${title} (${kind})`);
  }
  return [...found.values()];
};
