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
const RAISE_UNCERTAINTY_DESCRIPTION = `Record one uncertainty as structured conversation data, separately from your reply. Supply exactly one category — lack_of_evidence, conflict, ambiguity, not_implemented, or question — a severity (low, medium, or high), and a concise statement. Distinguish what you observed from what you infer. A question means you need the user's answer to proceed correctly; use the session's existing interaction behavior to get that answer. The tool records information only; it does not finish work or pause the session.

Use low for a peripheral qualification or an expected, design-consistent dependency; medium for a material qualification or missing delivery scope that needs the user's choice; high for a central reliability concern or conflict with authoritative intended behavior. Map review P0/P1 to high, P2 to medium, and P3/P4 to low; use equivalent high/medium/low review ratings directly. Category and severity are independent.

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
