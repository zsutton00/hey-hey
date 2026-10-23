import { z } from 'zod';
import { MessageIntent, InitiativeAction } from './classification.types';

/**
 * Zod schema for message intent enum validation
 */
export const messageIntentSchema = z.nativeEnum(MessageIntent);

/**
 * Zod schema for initiative action enum validation
 */
export const initiativeActionSchema = z.nativeEnum(InitiativeAction);

/**
 * Zod schema for initiative level validation
 */
export const initiativeLevelSchema = z.enum([
  'description',
  'details',
  'acceptanceCriteria',
]);

/**
 * Zod schema for UUID validation (used for IDs)
 */
export const uuidSchema = z.string().uuid();

/**
 * Zod schema for confidence score validation
 */
export const confidenceSchema = z.number().min(0).max(1);

/**
 * Zod schema for alternative classification results
 */
export const alternativeClassificationSchema = z.object({
  intent: messageIntentSchema,
  confidence: confidenceSchema,
});

/**
 * Main schema for message classification results from LLM
 */
export const messageClassificationSchema = z.object({
  intent: messageIntentSchema,
  confidence: confidenceSchema,
  targetInitiativeId: uuidSchema.nullable().optional(),
  targetLevel: initiativeLevelSchema.nullable().optional(),
  suggestedAction: initiativeActionSchema.nullable().optional(),
  reasoning: z.string().min(10).max(500),
});

/**
 * Extended schema with metadata for complete classification results
 */
export const messageClassificationResultSchema =
  messageClassificationSchema.extend({
    metadata: z
      .object({
        autoClassified: z.boolean().nullable().optional(),
        alternatives: z
          .array(alternativeClassificationSchema)
          .nullable()
          .optional(),
        processedAt: z.date().nullable().optional(),
        model: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
  });

/**
 * Schema for conversation context validation
 */
export const conversationContextSchema = z.object({
  conversationId: uuidSchema,
  organizationId: uuidSchema,
  projectId: uuidSchema.nullable().optional(),
  workflowId: z.string().nullable().optional(),
  userId: uuidSchema.nullable().optional(),
  availableInitiatives: z
    .array(
      z.object({
        id: uuidSchema,
        name: z.string().min(1).max(200),
        description: z.string().max(1000).nullable().optional(),
        currentLevel: initiativeLevelSchema.nullable().optional(),
        status: z.string().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
  recentMessages: z
    .array(
      z.object({
        content: z.string().max(2000),
        type: z.enum(['USER', 'SYSTEM']),
        timestamp: z.date(),
      }),
    )
    .nullable()
    .optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

/**
 * Schema for initiative context extraction results
 */
export const initiativeContextResultSchema = z.object({
  hasInitiativeContext: z.boolean(),
  mentionedInitiativeIds: z.array(uuidSchema),
  relevanceConfidence: confidenceSchema,
  extractedEntities: z
    .array(
      z.object({
        text: z.string().min(1).max(100),
        type: z.enum(['initiative_name', 'feature', 'requirement', 'status']),
        confidence: confidenceSchema,
      }),
    )
    .nullable()
    .optional(),
});

/**
 * Schema for workflow signal payload validation
 */
export const workflowSignalPayloadSchema = z.object({
  type: z.string().min(1).max(100),
  initiativeId: uuidSchema.nullable().optional(),
  content: z.string().max(2000).nullable().optional(),
  userId: uuidSchema.nullable().optional(),
  conversationId: uuidSchema.nullable().optional(),
  organizationId: uuidSchema.nullable().optional(),
  timestamp: z.date().nullable().optional(),
  metadata: z
    .object({
      confidence: confidenceSchema.nullable().optional(),
      reasoning: z.string().max(500).nullable().optional(),
      autoClassified: z.boolean().nullable().optional(),
    })
    .and(z.record(z.unknown()))
    .nullable()
    .optional(),
});

/**
 * Schema for routing results validation
 */
export const routingResultSchema = z.object({
  routed: z.boolean(),
  workflowId: z.string().nullable().optional(),
  signalName: z.string().nullable().optional(),
  signalPayload: workflowSignalPayloadSchema.nullable().optional(),
  error: z.string().nullable().optional(),
  timestamp: z.date(),
});

/**
 * Schema for classification configuration
 */
export const classificationConfigSchema = z.object({
  confidenceThreshold: confidenceSchema,
  autoRoutingEnabled: z.boolean(),
  maxMessageLength: z.number().min(100).max(10000),
  model: z.string().min(1).max(50),
  temperature: z.number().min(0).max(2),
  maxHistoryMessages: z.number().min(0).max(20),
});

/**
 * Schema for raw user messages input validation
 */
export const rawMessageInputSchema = z.object({
  content: z.string().min(1).max(2000),
  conversationId: uuidSchema,
  userId: uuidSchema,
  organizationId: uuidSchema,
  timestamp: z
    .date()
    .nullable()
    .optional()
    .default(() => new Date()),
});

/**
 * Schema for message processing request DTOs
 */
export const processRawMessageDtoSchema = z.object({
  content: z.string().min(1).max(2000),
  storeMessage: z.boolean().nullable().optional().default(true),
  context: z.record(z.unknown()).nullable().optional(),
});

/**
 * Schema for message relevance analysis request DTOs
 */
export const analyzeMessageRelevanceDtoSchema = z.object({
  content: z.string().min(1).max(2000),
  conversationId: uuidSchema,
  analysisContext: z.record(z.unknown()).nullable().optional(),
});

/**
 * Type inference helpers for TypeScript integration
 */
export type MessageClassificationSchemaType = z.infer<
  typeof messageClassificationSchema
>;
export type MessageClassificationResultSchemaType = z.infer<
  typeof messageClassificationResultSchema
>;
export type ConversationContextSchemaType = z.infer<
  typeof conversationContextSchema
>;
export type InitiativeContextResultSchemaType = z.infer<
  typeof initiativeContextResultSchema
>;
export type WorkflowSignalPayloadSchemaType = z.infer<
  typeof workflowSignalPayloadSchema
>;
export type RoutingResultSchemaType = z.infer<typeof routingResultSchema>;
export type ClassificationConfigSchemaType = z.infer<
  typeof classificationConfigSchema
>;
export type RawMessageInputSchemaType = z.infer<typeof rawMessageInputSchema>;
export type ProcessRawMessageDtoSchemaType = z.infer<
  typeof processRawMessageDtoSchema
>;
export type AnalyzeMessageRelevanceDtoSchemaType = z.infer<
  typeof analyzeMessageRelevanceDtoSchema
>;

/**
 * Validation helper functions
 */
export const validateMessageClassification = (
  data: unknown,
): MessageClassificationSchemaType => {
  return messageClassificationSchema.parse(data);
};

export const validateConversationContext = (
  data: unknown,
): ConversationContextSchemaType => {
  return conversationContextSchema.parse(data);
};

export const validateWorkflowSignalPayload = (
  data: unknown,
): WorkflowSignalPayloadSchemaType => {
  return workflowSignalPayloadSchema.parse(data);
};

export const validateRoutingResult = (
  data: unknown,
): RoutingResultSchemaType => {
  return routingResultSchema.parse(data);
};

/**
 * Safe validation helper that returns validation result with error handling
 */
export const safeValidateMessageClassification = (
  data: unknown,
): {
  success: boolean;
  data?: MessageClassificationSchemaType;
  error?: string;
} => {
  try {
    const result = messageClassificationSchema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
};
