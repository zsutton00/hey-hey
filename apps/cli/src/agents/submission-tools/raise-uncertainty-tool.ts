import { z } from 'zod';
import {
  AgentUncertaintySystemMessageDataCategoryEnum,
  type AgentUncertaintySystemMessageData,
} from '@hey-hey/contracts/api/models';
import type { PassThroughSubmissionToolDeclaration } from './types';

const inputSchema = z
  .object({
    severity: z.enum(['low', 'medium', 'high']),
    category: z.nativeEnum(AgentUncertaintySystemMessageDataCategoryEnum),
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
const RAISE_UNCERTAINTY_DESCRIPTION = `Record one uncertainty as structured conversation data, separately from your reply. Supply exactly one category — lack_of_evidence, conflict, ambiguity, not_implemented, question, or feature_sync — a severity (low, medium, or high), and a concise statement. Do not use partial UUIDs. Distinguish what you observed from what you infer. A question means you need the user's answer to proceed correctly; use the session's existing interaction behavior to get that answer. The tool records information only; it does not finish work or pause the session.

Use low for a peripheral qualification or an expected, design-consistent dependency; medium for a material qualification or missing delivery scope that needs the user's choice; high for a central reliability concern or conflict with authoritative intended behavior. Map review P0/P1 to high, P2 to medium, and P3/P4 to low; use equivalent high/medium/low review ratings directly. Category and severity are independent.

Raise each distinct qualifying discrepancy as soon as you notice it, during the turn. Use feature_sync only when all three hold: (1) a recorded requirement, Mockup, Diagram, or task says something specific that the code or latest user direction contradicts, (2) the difference changes what a user gets, and (3) updating one feature or its linked Mockups, Diagrams, or tasks would resolve it. Name the owning feature and the source with entity mentions, what the source says, and what should change. Example: the Mockup shows a control in one place, but the delivered UI puts it somewhere else and the feature's Mockup can be updated to match.

Use conflict for disagreements with a Contract or Decision and for recorded drift that no single feature owns. Name the conflicting source with an entity mention, what it says, and what should change. Raise a Contract breach at high severity. An unrecorded detail alone, such as a font size that no source specifies, raises no uncertainty.

If you are proposing a fix in this turn, use that proposal as the sole visible record and skip the uncertainty. Skip concerns already raised or suggested in this session and anything Feature Sync already updated. A report line, reply, or closing offer is not raising it. Never use a Verify Feature suggestion for a concern already raised as an uncertainty.

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
        enum: Object.values(AgentUncertaintySystemMessageDataCategoryEnum),
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
