import { z } from 'zod';
import {
  AdrActiveSectionEnum,
  AdrRefinerRequest as AdrRefinerRequestModel,
  AdrRefinerResponse as AdrRefinerResponseModel,
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
} from '../../utils/shared-schemas';

export const AdrAgentResponseSchema: z.ZodType<AdrRefinerResponseModel> =
  z.object({
    ops: z.array(replaceOpSchema).optional(),
    response: z.string().optional().describe('Optional note for reviewers'),
    influences: z.array(refinerInfluenceSchema).optional(),
    relatedEntities: z.array(relatedEntitySchema).optional(),
    nextStep: z.string().optional(),
    usage: usageSummarySchema.nullable().optional(),
  });

export type AdrAgentResponse = AdrRefinerResponseModel;

export const AdrRefinerAgentInputSchema: z.ZodType<AdrRefinerRequestModel> =
  z.object({
    adr: z.object({
      title: z.string(),
      context: z.string(),
      decision: z.string(),
      consequences: z.string(),
    }),
    lastUserMessage: z.string(),
    activeSection: z.nativeEnum(AdrActiveSectionEnum),
    initiative: InitiativeSummarySchema.optional(),
    task: TaskSummarySchema.optional(),
    recentConversationMessages: z.array(conversationMessageSchema).optional(),
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

export type AdrRefinerAgentInput = AdrRefinerRequestModel &
  Record<string, unknown>;
