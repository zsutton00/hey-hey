import { z } from 'zod';
import type { PlanShapingVisualPreviewCompletionPayload } from '../../shared/agent-bridge-contract/generated/api';

const visualPreviewRelationshipSchema = z
  .object({
    kind: z.enum(['depends_on', 'refines']),
    proposalId: z.string().uuid(),
  })
  .strict();

const visualPreviewEntrySchema = z
  .object({
    proposalId: z.string().uuid(),
    artifactFamily: z.enum(['mockup', 'diagram']),
    presentationOrder: z.number().int().nonnegative(),
    relationship: visualPreviewRelationshipSchema.optional(),
  })
  .strict();

const visualPreviewEntriesSchema = z
  .array(visualPreviewEntrySchema)
  .superRefine((entries, refinementContext) => {
    const proposalIds = new Set<string>();
    const presentationOrders = new Set<number>();
    for (const [index, entry] of entries.entries()) {
      if (proposalIds.has(entry.proposalId)) {
        refinementContext.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'proposalId'],
          message: 'Each visual proposal may appear only once.',
        });
      }
      proposalIds.add(entry.proposalId);
      if (presentationOrders.has(entry.presentationOrder)) {
        refinementContext.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'presentationOrder'],
          message: 'Presentation order must be unique across the visual set.',
        });
      }
      presentationOrders.add(entry.presentationOrder);
    }

    for (const artifactFamily of ['mockup', 'diagram'] as const) {
      const familyEntries = entries
        .filter((entry) => entry.artifactFamily === artifactFamily)
        .sort((left, right) => left.presentationOrder - right.presentationOrder);
      for (const [familyIndex, entry] of familyEntries.entries()) {
        if (familyIndex === 0) continue;
        if (!entry.relationship) {
          refinementContext.addIssue({
            code: z.ZodIssueCode.custom,
            path: [entries.indexOf(entry), 'relationship'],
            message: `Every ordered ${artifactFamily} sequence after its first entry needs a same-family relationship.`,
          });
          continue;
        }
        const predecessor = familyEntries[familyIndex - 1];
        const target = entries.find(
          (candidate) => candidate.proposalId === entry.relationship?.proposalId,
        );
        if (
          !target ||
          target.artifactFamily !== artifactFamily ||
          target.proposalId === entry.proposalId ||
          target.proposalId !== predecessor?.proposalId
        ) {
          refinementContext.addIssue({
            code: z.ZodIssueCode.custom,
            path: [entries.indexOf(entry), 'relationship', 'proposalId'],
            message: `Relationship must target the immediately preceding ${artifactFamily} proposal in presentation order.`,
          });
        }
      }
    }
  });

export const visualPreviewCompletionPayloadSchema = z
  .object({
    refinementRound: z.number().int().nonnegative(),
    entries: visualPreviewEntriesSchema,
  })
  .strict();

export type VisualPreviewCompletionPayload = z.infer<typeof visualPreviewCompletionPayloadSchema>;

export const asVisualPreviewCompletionPayload = (
  payload: VisualPreviewCompletionPayload,
): PlanShapingVisualPreviewCompletionPayload => ({
  refinementRound: payload.refinementRound,
  entries: payload.entries.map((entry) => ({
    proposalId: entry.proposalId,
    artifactFamily: entry.artifactFamily,
    presentationOrder: entry.presentationOrder,
    ...(entry.relationship
      ? {
          relationship: {
            kind: entry.relationship.kind,
            proposalId: entry.relationship.proposalId,
          },
        }
      : {}),
  })),
});
