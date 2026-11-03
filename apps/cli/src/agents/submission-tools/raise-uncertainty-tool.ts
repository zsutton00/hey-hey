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

export const raiseUncertaintyTool = {
  kind: 'pass_through',
  name: RAISE_UNCERTAINTY_TOOL_NAME,
  description:
    'Record one uncertainty as structured conversation data. Use when evidence, a conflict, ambiguity, missing implementation, or a user answer materially affects correct progress. Routine design-consistent work is not an uncertainty.',
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
