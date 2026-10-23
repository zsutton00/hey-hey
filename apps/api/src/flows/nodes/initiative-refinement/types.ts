import { z } from 'zod';
import {
  InitiativeActiveSectionEnum,
  InitiativeRefinerRequest as InitiativeRefinerRequestModel,
  InitiativeRefinerResponse as InitiativeRefinerResponseModel,
} from 'src/generated/agents/models';
import {
  InitiativeSummarySchema,
  conversationMessageSchema,
  mentionContextSchema,
  refinerInfluenceSchema,
  relatedEntitySchema,
  replaceOpSchema,
  usageSummarySchema,
} from 'src/flows/utils/shared-schemas';

export const InitiativeRefinerResponseSchema: z.ZodType<InitiativeRefinerResponseModel> =
  z.object({
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

export type InitiativeRefinerResponse = InitiativeRefinerResponseModel;

export const InitiativeRefinerRequestSchema: z.ZodType<InitiativeRefinerRequestModel> =
  z.object({
    initiative: InitiativeSummarySchema,
    lastUserMessage: z.string(),
    activeSection: z.nativeEnum(InitiativeActiveSectionEnum),
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

export type InitiativeRefinerRequest = InitiativeRefinerRequestModel;
