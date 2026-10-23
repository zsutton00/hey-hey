/**
 * Zod schemas for outbound control_request payloads issued by
 * ClaudeCodeSdkClient. These schemas validate responses at the SDK boundary
 * before they are surfaced to runner consumers.
 *
 * The ContextData schema is the runner-owned boundary for context usage
 * responses. Keeping the inferred shape here avoids coupling the SDK to a
 * browser transport package.
 */

import { z } from 'zod';

const apiUsageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_creation_input_tokens: z.number(),
  cache_read_input_tokens: z.number(),
});

const categorySchema = z.object({
  name: z.string(),
  tokens: z.number(),
  color: z.string(),
  isDeferred: z.boolean().optional(),
});

const gridSquareSchema = z.object({
  color: z.string(),
  isFilled: z.boolean(),
  categoryName: z.string(),
  tokens: z.number(),
  percentage: z.number(),
  squareFullness: z.number(),
});

const memoryFileSchema = z.object({
  path: z.string(),
  type: z.string(),
  tokens: z.number(),
});

const mcpToolSchema = z.object({
  name: z.string(),
  serverName: z.string(),
  tokens: z.number(),
  isLoaded: z.boolean().optional(),
});

const agentSchema = z.object({
  agentType: z.string(),
  source: z.string(),
  tokens: z.number(),
});

const deferredBuiltinToolSchema = z.object({
  name: z.string(),
  tokens: z.number(),
  isLoaded: z.boolean(),
});

const systemToolDetailSchema = z.object({
  name: z.string(),
  tokens: z.number(),
});

const systemPromptSectionSchema = z.object({
  name: z.string(),
  tokens: z.number(),
});

const slashCommandInfoSchema = z.object({
  totalCommands: z.number(),
  includedCommands: z.number(),
  tokens: z.number(),
});

const skillFrontmatterSchema = z.object({
  name: z.string(),
  source: z.string(),
  tokens: z.number(),
});

const skillInfoSchema = z.object({
  totalSkills: z.number(),
  includedSkills: z.number(),
  tokens: z.number(),
  skillFrontmatter: z.array(skillFrontmatterSchema),
});

const toolCallByTypeSchema = z.object({
  name: z.string(),
  callTokens: z.number(),
  resultTokens: z.number(),
});

const attachmentByTypeSchema = z.object({
  name: z.string(),
  tokens: z.number(),
});

const messageBreakdownSchema = z.object({
  toolCallTokens: z.number(),
  toolResultTokens: z.number(),
  attachmentTokens: z.number(),
  assistantMessageTokens: z.number(),
  userMessageTokens: z.number(),
  toolCallsByType: z.array(toolCallByTypeSchema),
  attachmentsByType: z.array(attachmentByTypeSchema),
});

export const contextDataSchema = z.object({
  categories: z.array(categorySchema),
  totalTokens: z.number(),
  maxTokens: z.number(),
  rawMaxTokens: z.number(),
  percentage: z.number(),
  gridRows: z.array(z.array(gridSquareSchema)),
  model: z.string(),
  memoryFiles: z.array(memoryFileSchema),
  mcpTools: z.array(mcpToolSchema),
  deferredBuiltinTools: z.array(deferredBuiltinToolSchema).optional(),
  systemTools: z.array(systemToolDetailSchema).optional(),
  systemPromptSections: z.array(systemPromptSectionSchema).optional(),
  agents: z.array(agentSchema),
  slashCommands: slashCommandInfoSchema.optional(),
  skills: skillInfoSchema.optional(),
  autoCompactThreshold: z.number().optional(),
  isAutoCompactEnabled: z.boolean(),
  messageBreakdown: messageBreakdownSchema.optional(),
  apiUsage: apiUsageSchema.nullable(),
});

export type ContextData = z.infer<typeof contextDataSchema>;

/**
 * Plan rate-limit window from the `get_usage` reply. `utilization` is a
 * percentage (0–100) and `resets_at` an ISO 8601 timestamp; either may be
 * null when the claude.ai usage endpoint omits it.
 */
const usageWindowSchema = z.object({
  utilization: z.number().nullable(),
  resets_at: z.string().datetime({ offset: true }).nullable(),
});

/**
 * The `get_usage` reply, narrowed to the plan rate limits. Claude Code labels
 * this request experimental, so the fields we rely on are required and
 * validation fails loudly when they drift. `rate_limits` is null whenever
 * `rate_limits_available` is false (API key, Bedrock, Vertex, missing scope).
 * Per-model weekly windows (`seven_day_opus`, `seven_day_sonnet`,
 * `model_scoped`, …) are intentionally not surfaced.
 */
export const usageDataSchema = z.object({
  subscription_type: z.string().nullable(),
  rate_limits_available: z.boolean(),
  rate_limits: z
    .object({
      five_hour: usageWindowSchema.nullable().optional(),
      seven_day: usageWindowSchema.nullable().optional(),
    })
    .nullable(),
});

export type UsageData = z.infer<typeof usageDataSchema>;
export type UsageWindow = z.infer<typeof usageWindowSchema>;
