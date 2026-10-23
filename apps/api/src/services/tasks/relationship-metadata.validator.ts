import { z } from 'zod';

export const RELATIONSHIP_METADATA_SCHEMA_REF =
  '#/components/schemas/RelationshipMetadata';

const relationshipMetadataSchema = z
  .object({
    reasoning: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    inferredBy: z.enum(['llm', 'system']).optional(),
    createdAt: z.string().datetime().optional(),
    conversationId: z.string().uuid().optional(),
    nodeId: z.string().optional(),
    baseType: z.string().optional(),
    requestorId: z.string().uuid().optional(),
  })
  .passthrough();

export function validateRelationshipMetadataContent(
  content: unknown,
):
  | { success: true; canonicalContent: string }
  | { success: false; message: string } {
  const result = relationshipMetadataSchema.safeParse(content);
  if (!result.success) {
    return {
      success: false,
      message: result.error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
          return `${path}: ${issue.message}`;
        })
        .join('; '),
    };
  }

  return {
    success: true,
    canonicalContent: JSON.stringify(result.data),
  };
}
