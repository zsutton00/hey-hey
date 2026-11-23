import { z } from 'zod';
import type { AgentUncertaintySystemMessageData } from '@hey-hey/contracts/api/models';
import type { PassThroughSubmissionToolDeclaration } from './types';

const inputSchema = z
  .object({
    severity: z.enum(['low', 'medium', 'high']),
    category: z.enum(['lack_of_evidence', 'conflict', 'ambiguity', 'not_implemented', 'question']),
    statement: z.string().trim().min(1).regex(/\S/),
  })
  .strict() satisfies z.ZodType<
  Omit<AgentUncertaintySystemMessageData, 'type' | 'providerSessionId' | 'promptHandler'>
>;

export const RAISE_UNCERTAINTY_TOOL_NAME = 'raise_uncertainty';

/**
 * The uncertainty guidance travels with the tool, so only agents that hold it
 * receive it. It must not be added to the shared platform prompt.
 */
const RAISE_UNCERTAINTY_DESCRIPTION = `Record one uncertainty as structured conversation data, separately from your reply. Supply exactly one category — lack_of_evidence, conflict, ambiguity, not_implemented, or question — a severity (low, medium, or high), and a concise statement. Do not use partial UUIDs. Distinguish what you observed from what you infer. A question means you need the user's answer to proceed correctly; use the session's existing interaction behavior to get that answer. The tool records information only; it does not finish work or pause the session.

Use low for a peripheral qualification or an expected, design-consistent dependency; medium for a material qualification or missing delivery scope that needs the user's choice; high for a central reliability concern or conflict with authoritative intended behavior. Map review P0/P1 to high, P2 to medium, and P3/P4 to low; use equivalent high/medium/low review ratings directly. Category and severity are independent.

When a recorded source (requirement, design doc, Mockup, Contract, Decision, or task) disagrees with the code, the user's latest direction, or what you just did, raise it as a conflict unless you are correcting the source in the same turn. If you propose the edit, that proposal is the visible record; do not also raise it here. A Verify Feature suggestion (suggest_feature_verification) is a confident sync action, not a substitute: when you also raise one for the same drift, still raise this conflict, which is your flag that the user may want to look at it. A passing line in your reply, a closing offer such as "tell me if you want it", or a mention in a report is not raising it, and deciding the mismatch is not worth acting on is the user's call, not yours. The severity is usually low or medium, because the question is whether to update the record, not whether the work is broken. Name the source with an entity mention, what it says now, and what it should say, so the user can act on it or discuss it. Example: the title color changed in code while the Card requirement still says "Hey Hey theme color".

Do not raise routine design-consistent implementation, regeneration, or migration work.`;

export const raiseUncertaintyTool = {
  kind: 'pass_through',
  name: RAISE_UNCERTAINTY_TOOL_NAME,
  description: RAISE_UNCERTAINTY_DESCRIPTION,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['severity', 'category', 'statement'],
    properties: {
      severity: { type: 'string', enum: ['low', 'medium', 'high'] },
      category: {
        type: 'string',
        enum: ['lack_of_evidence', 'conflict', 'ambiguity', 'not_implemented', 'question'],
      },
      statement: { type: 'string', minLength: 1, pattern: '\\S' },
    },
  },
  execute() {
    return { content: [{ type: 'text', text: 'Uncertainty recorded.' }] };
  },
  outOfBandSystemMessage(ctx) {
    const input = inputSchema.parse(ctx.args);
    return {
      type: 'AGENT_UNCERTAINTY',
      ...input,
    } satisfies AgentUncertaintySystemMessageData;
  },
} satisfies PassThroughSubmissionToolDeclaration;
