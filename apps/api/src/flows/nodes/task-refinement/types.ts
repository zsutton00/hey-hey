import { z } from 'zod';
import {
  TaskActiveSectionEnum,
  TaskRefinerRequest as TaskRefinerRequestModel,
  TaskRefinerResponse as TaskRefinerResponseModel,
} from 'src/generated/agents/models';
import {
  InitiativeSummarySchema,
  TaskSummarySchema,
  conversationMessageSchema,
  mentionContextSchema,
  refinerInfluenceSchema,
  relatedEntitySchema,
  replaceOpSchema,
  usageSummarySchema,
} from 'src/flows/utils/shared-schemas';

const baseTaskRefinerResponseSchema = z.object({
  ops: z.array(replaceOpSchema).optional(),
  response: z.string().optional().describe('Optional note for reviewers'),
  sectionCompleteConfidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'Confidence score (0-1) for section completeness: 0 = empty/placeholder, 0.5 = partial, 1.0 = comprehensive',
    )
    .optional(),
  influences: z.array(refinerInfluenceSchema).optional(),
  relatedEntities: z.array(relatedEntitySchema).optional(),
  usage: usageSummarySchema.nullable().optional(),
});

export const TaskRefinerResponseSchema: z.ZodType<TaskRefinerResponseModel> =
  baseTaskRefinerResponseSchema;

export type TaskRefinerResponse = TaskRefinerResponseModel;

export const TaskRefinerNextLevelResponseSchema: z.ZodType<TaskRefinerResponseModel> =
  baseTaskRefinerResponseSchema.extend({
    ops: z.array(replaceOpSchema).min(1, 'At least one operation required'),
    sectionCompleteConfidence: z.number().default(1),
  });

export type TaskRefinerNextLevelResponse = TaskRefinerResponseModel;

export const TaskRefinerRequestSchema: z.ZodType<TaskRefinerRequestModel> =
  z.object({
    task: TaskSummarySchema,
    initiative: InitiativeSummarySchema,
    lastUserMessage: z.string(),
    activeSection: z.nativeEnum(TaskActiveSectionEnum),
    recentConversationMessages: z
      .array(conversationMessageSchema)
      .optional()
      .describe(
        'Last 2-3 conversation messages to filter from search results to avoid duplication',
      ),
    mentions: z.array(mentionContextSchema).optional(),
    requiredOps: z
      .number()
      .int()
      .min(0)
      .describe(
        'Minimum number of operations required in the response. Use when you need to guarantee the agent provides edits.',
      )
      .optional(),
  });

export type TaskRefinerRequest = TaskRefinerRequestModel;
