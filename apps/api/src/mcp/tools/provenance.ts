import { z } from 'zod';
import { EntityType } from 'src/generated/agents/models';
import type { RequestorContext } from './requestor-context';

/**
 * Standardized reason types for influence relationships.
 * - explicit_mention: entity was directly referenced in the proposal
 * - implied: entity was contextually relevant without direct mention
 * - derived: influence was inferred from entity content or relationships
 * - origin: system-injected; marks the host conversation's workflow-about
 *   entity as the originating context. Not declarable by the agent — any
 *   agent-supplied `origin` is stripped server-side and replaced.
 */
export const INFLUENCE_REASON_TYPES = [
  'explicit_mention',
  'implied',
  'derived',
  'origin',
] as const;

export type InfluenceReasonType = (typeof INFLUENCE_REASON_TYPES)[number];

export const influenceSchema = z
  .object({
    entityId: z.string().uuid(),
    entityType: z.nativeEnum(EntityType),
    entityTitle: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Optional snapshot of the influencing entity title. The server fills ' +
          'this in from the EntityRegistry when omitted, so callers only need ' +
          'to pass it when they already have the title in hand.',
      ),
    taskType: z
      .string()
      .optional()
      .describe(
        'Optional snapshot of the authoritative TASK work-item subtype. Values ' +
          'are opaque registry keys and may be built-in or project-defined.',
      ),
    reasoning: z.string().min(1).max(2000),
    reasonType: z.enum(INFLUENCE_REASON_TYPES),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export const influencesArraySchema = z
  .array(influenceSchema)
  .max(100)
  .default([]);

export type ValidatedInfluence = z.infer<typeof influenceSchema>;

export interface ProvenanceEnvelope {
  influences: ValidatedInfluence[];
  generatedWithVersion?: string;
  requestorContext: RequestorContext;
}

/**
 * Build a provenance envelope from raw MCP tool inputs.
 * Validates and sanitizes influences, combines with generation context.
 */
export function buildProvenanceEnvelope(
  requestorContext: RequestorContext,
  rawInfluences: unknown[] | undefined,
  generatedWithVersion?: string,
): ProvenanceEnvelope {
  const influences = rawInfluences
    ? influencesArraySchema.parse(rawInfluences)
    : [];

  return {
    influences,
    ...(generatedWithVersion ? { generatedWithVersion } : {}),
    requestorContext,
  };
}
