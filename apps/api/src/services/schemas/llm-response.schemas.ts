import { z } from 'zod';
import { influenceSchema } from '../../flows/utils/shared-schemas';

/**
 * Schemas for validating LLM responses
 * These enforce structured output and prevent injection attacks
 */

// Base validation function for string fields from LLM
const createSanitizedString = (maxLength: number = 2000) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine(
      (val) => {
        // Basic injection protection - no script tags, eval, etc.
        const dangerousPatterns = [
          /<script/i,
          /javascript:/i,
          /eval\(/i,
          /function\s*\(/i,
          /\bon\w+\s*=/i, // on[event]= handlers
        ];
        return !dangerousPatterns.some((pattern) => pattern.test(val));
      },
      { message: 'Content contains potentially dangerous patterns' },
    );

const initiativeTitle = createSanitizedString(100);
const initiativeDescription = createSanitizedString(1000);
const initiativeDetails = createSanitizedString(2000);

// Enums for controlled values
const effortLevelSchema = z.enum(['small', 'medium', 'large']);
const priorityLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

// Tag validation - only allow alphanumeric and common separators
const tagSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(
    /^[a-zA-Z0-9\-_\s]+$/,
    'Tags must be alphanumeric with hyphens, underscores, or spaces only',
  );

// Initiative draft schema for LLM generation
export const initiativeDraftLLMSchema = z.object({
  name: initiativeTitle,
  description: initiativeDescription,
  details: initiativeDetails,
  acceptanceCriteria: initiativeDetails,
  estimatedEffort: effortLevelSchema.default('medium'),
  priority: priorityLevelSchema.default('medium'),
  tags: z.array(tagSchema).max(10).default([]),
  reasoning: createSanitizedString(300),
  influences: z.array(influenceSchema).default([]),
});

// LLM response for initiative generation
export const initiativeGenerationResponseSchema = z.object({
  initiatives: z.array(initiativeDraftLLMSchema).min(1).max(10),
  reasoning: createSanitizedString(500),
  confidenceScore: z.number().min(0).max(1).default(0.5),
  suggestedNextSteps: z.array(createSanitizedString(200)).max(5).default([]),
});

// LLM response for initiative refinement
export const initiativeRefinementResponseSchema = z.object({
  refinedInitiative: z.object({
    name: initiativeTitle,
    description: initiativeDescription,
    details: initiativeDetails,
    acceptanceCriteria: initiativeDetails,
    tags: z.array(tagSchema).max(10).default([]),
    estimatedEffort: effortLevelSchema.default('medium'),
    priority: priorityLevelSchema.default('medium'),
    reasoning: createSanitizedString(300),
  }),
  systemResponse: createSanitizedString(500),
  suggestedChanges: z.array(createSanitizedString(200)).max(10).default([]),
  confidenceScore: z.number().min(0).max(1).default(0.5),
});

// Input sanitization schema for user feedback
export const userFeedbackSchema = z
  .string()
  .min(1)
  .max(1000)
  .refine(
    (val) => {
      // Sanitize user input before sending to LLM
      const dangerousPatterns = [
        /<script/i,
        /javascript:/i,
        /eval\(/i,
        /\bon\w+\s*=/i,
        /__proto__/i,
        /constructor/i,
        /prototype/i,
      ];
      return !dangerousPatterns.some((pattern) => pattern.test(val));
    },
    { message: 'Feedback contains potentially dangerous content' },
  )
  .transform((val) => {
    // Additional sanitization: remove potential injection attempts
    return val
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, '') // Remove event handlers
      .trim();
  });

// Types derived from schemas
export type InitiativeDraftLLM = z.infer<typeof initiativeDraftLLMSchema>;
export type InitiativeGenerationResponse = z.infer<
  typeof initiativeGenerationResponseSchema
>;
export type InitiativeRefinementResponse = z.infer<
  typeof initiativeRefinementResponseSchema
>;
export type SanitizedUserFeedback = z.infer<typeof userFeedbackSchema>;

/**
 * Utility function to safely parse and validate LLM responses
 * Handles common cases where LLM wraps JSON in markdown code blocks
 */
export function parseLLMResponse<T>(
  response: T | string,
  schema: z.ZodSchema<T>,
): { success: true; data: T } | { success: false; error: string } {
  try {
    let parsedResponse: T;

    // Handle string responses (raw JSON or JSON wrapped in markdown code blocks)
    if (typeof response === 'string') {
      // Remove markdown code block wrapper if present
      let cleanedResponse = response.trim();

      // Check for ```json\n{...}\n``` pattern
      const jsonBlockMatch = cleanedResponse.match(
        /^```json\s*\n([\s\S]*?)\n```\s*$/,
      );
      if (jsonBlockMatch) {
        const block = jsonBlockMatch[1];
        if (block === undefined) {
          return {
            success: false,
            error: 'Failed to extract JSON block from LLM response',
          };
        }
        cleanedResponse = block;
      }

      // Try to parse as JSON
      try {
        parsedResponse = JSON.parse(cleanedResponse) as T;
      } catch (jsonError) {
        return {
          success: false,
          error: `Failed to parse JSON from LLM response: ${jsonError instanceof Error ? jsonError.message : 'Unknown parsing error'}`,
        };
      }
    } else {
      // Use response as-is if it's already an object
      parsedResponse = response;
    }

    // Validate against schema
    const result = schema.safeParse(parsedResponse);

    if (result.success) {
      return { success: true, data: result.data };
    } else {
      return {
        success: false,
        error: `Validation failed: ${result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      };
    }
  } catch (parseError) {
    // Handle unexpected errors
    return {
      success: false,
      error: `Unexpected error parsing LLM response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
    };
  }
}
