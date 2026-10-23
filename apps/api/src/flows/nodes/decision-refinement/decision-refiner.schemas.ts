import { z } from 'zod';
import {
  DecisionRefinerRequest as DecisionRefinerRequestModel,
  DecisionRefinerResponse as DecisionRefinerResponseModel,
  EntityType,
} from 'src/generated/agents/models';

const conversationMessageSchema = z.object({
  id: z.string(),
  content: z.string(),
  role: z.string().optional(),
});

const mentionContextSchema = z.object({
  entityId: z.string(),
  entityType: z.string(),
  messageId: z.string(),
  summary: z.string().optional(),
});

const refinerInfluenceSchema = z.object({
  entityId: z.string(),
  entityType: z.nativeEnum(EntityType),
  reasonType: z.string(),
  reasoning: z.string().optional(),
  confidence: z.number().nullable().optional(),
});

const replaceOpSchema = z.object({
  type: z.string().optional(),
  target: z.string().optional(),
  text: z.string(),
});

const relatedEntitySchema = z.object({
  entityId: z.string(),
  entityType: z.string(),
  entityName: z.string(),
});

const usageSummarySchema = z.object({
  modelId: z.string().nullable().optional(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
  estimatedCostUsd: z.number().nullable().optional(),
});

export const DecisionRefinerResponseSchema: z.ZodType<DecisionRefinerResponseModel> =
  z.object({
    content: z.string().optional(),
    response: z.string().optional(),
    nextStep: z.string().optional(),
    influences: z.array(refinerInfluenceSchema).optional(),
    ops: z.array(replaceOpSchema).optional(),
    relatedEntities: z.array(relatedEntitySchema).optional(),
    usage: usageSummarySchema.nullable().optional(),
  });

export type DecisionRefinerResponse = DecisionRefinerResponseModel;

export const DecisionRefinerRequestSchema: z.ZodType<DecisionRefinerRequestModel> =
  z.object({
    recentConversationMessages: z.array(conversationMessageSchema).optional(),
    mentions: z.array(mentionContextSchema).optional(),
    requiredOps: z.number().optional(),
    title: z.string(),
    content: z.string(),
    lastUserMessage: z.string(),
  });

export type DecisionRefinerRequest = DecisionRefinerRequestModel;
