import { z } from 'zod';
import {
  EntityType,
  type LocalOpenItemsTriageResponse,
} from '../../shared/agent-bridge-contract/generated';
import { extractStructuredJsonPayload } from '../response-parser';

const text = z.string().trim().min(1);
const triageItemSchema = z
  .object({ entityType: z.nativeEnum(EntityType), entityId: z.string().uuid(), title: text })
  .strict();
const items = z.array(triageItemSchema).min(1).max(100);
const dateTime = z.string().datetime({ offset: true });
const draft = z
  .object({ name: text, targetDate: dateTime.optional() })
  .strict()
  .transform(({ targetDate, ...rest }) => ({
    ...rest,
    ...(targetDate !== undefined ? { targetDate } : {}),
  }));
const base = {
  suggestionId: text,
  rationale: text,
  evidence: z
    .array(
      z
        .object({
          kind: z.enum(['attention', 'edge', 'sourceConversation', 'coAttention', 'title']),
          summary: text,
        })
        .strict(),
    )
    .min(1)
    .max(8),
};
const triageResponseSchema = z
  .object({
    responseType: z.literal('open_items_triage_v1'),
    summary: text,
    suggestions: z
      .array(
        z.discriminatedUnion('kind', [
          z.object({ ...base, kind: z.literal('removeOpenItems'), items }).strict(),
          z.object({ ...base, kind: z.literal('reopenItems'), items }).strict(),
          z
            .object({
              ...base,
              kind: z.literal('groupOpenItems'),
              items,
              group: z.discriminatedUnion('kind', [
                z
                  .object({
                    kind: z.literal('existingGroup'),
                    groupId: z.string().uuid(),
                    name: text,
                  })
                  .strict(),
                z.object({ kind: z.literal('newGroup'), newGroupName: text.max(80) }).strict(),
              ]),
            })
            .strict(),
          z
            .object({
              ...base,
              kind: z.literal('trackOnGoal'),
              items,
              goal: z.discriminatedUnion('kind', [
                z
                  .object({
                    kind: z.literal('existingGoal'),
                    goalId: z.string().uuid(),
                    title: text,
                  })
                  .strict(),
                z.object({ kind: z.literal('newGoal'), newGoal: draft }).strict(),
              ]),
            })
            .strict(),
          z
            .object({
              ...base,
              kind: z.literal('promoteGroupToGoal'),
              groupId: z.string().uuid(),
              groupName: text,
              goalName: text,
              targetDate: dateTime.optional(),
              affectedMembers: items,
            })
            .strict(),
        ]),
      )
      .max(20),
  })
  .strict()
  .superRefine((response, ctx) => {
    if (
      new Set(response.suggestions.map((s) => s.suggestionId)).size !== response.suggestions.length
    )
      ctx.addIssue({ code: 'custom', message: 'suggestionId must be unique' });
  });

export function parseTriageResponse(
  text: string,
): { ok: true; value: LocalOpenItemsTriageResponse } | { ok: false; error: string } {
  try {
    const parsed = triageResponseSchema.safeParse(
      JSON.parse(extractStructuredJsonPayload(text) ?? text),
    );
    if (!parsed.success) return { ok: false, error: 'Invalid Open Items triage reply.' };
    const suggestions = parsed.data.suggestions.map((s) => {
      if (s.kind !== 'promoteGroupToGoal') return s;
      const { targetDate, ...rest } = s;
      return { ...rest, ...(targetDate !== undefined ? { targetDate } : {}) };
    });
    return {
      ok: true,
      value: { ...parsed.data, suggestions } satisfies LocalOpenItemsTriageResponse,
    };
  } catch {
    return { ok: false, error: 'Open Items triage reply requires valid JSON.' };
  }
}
