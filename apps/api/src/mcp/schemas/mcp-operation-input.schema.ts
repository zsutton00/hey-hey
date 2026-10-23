import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const MCP_OPERATION_INPUT_SCHEMA_ID =
  '/schemas/mcp-operation-input/v1.0.0' as const;

export type McpScopeRequirement =
  | 'organizationId'
  | 'projectId'
  | 'initiativeId';

const scopeFieldNames = [
  'organizationId',
  'projectId',
  'initiativeId',
] as const;
type ScopeFieldName = (typeof scopeFieldNames)[number];

const changeTargetPattern =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|(?:\$?\.)?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\[[0-9]+\])*)$/i;

const jsonValueSchema = z.any();

const scopeSchema = z
  .object({
    organizationId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    initiativeId: z.string().min(1).optional(),
  })
  .strict();

const refSchema = z
  .object({
    entityType: z.enum(['initiative', 'task']),
    ref: z.string().min(1),
  })
  .strict();

const changeSchema = z
  .object({
    changeType: z.enum(['replace', 'update', 'add', 'remove']),
    target: z
      .string()
      .min(1)
      .regex(
        changeTargetPattern,
        'target must be a UUID or JSONPath-like field path',
      ),
    value: jsonValueSchema,
    reason: z.string().min(1).optional(),
    intent: z.string().min(1).optional(),
  })
  .strict();

const metadataSchema = z
  .object({
    requestorId: z.string().min(1),
    correlationId: z.string().min(1),
    intent: z.string().min(1),
    timestamp: z.string().datetime({ offset: true }),
  })
  .strict();

export const mcpOperationInputBaseSchema = z
  .object({
    scope: scopeSchema,
    refs: z.array(refSchema).optional(),
    changes: z.array(changeSchema).min(1),
    metadata: metadataSchema,
  })
  .strict();

export type McpOperationInputPayload = z.infer<
  typeof mcpOperationInputBaseSchema
>;

const schemaCache = new Map<string, z.ZodType<McpOperationInputPayload>>();

function isScopeFieldName(value: McpScopeRequirement): value is ScopeFieldName {
  return scopeFieldNames.includes(value as ScopeFieldName);
}

function uniqueRequiredScopeFields(
  requiredScope: readonly McpScopeRequirement[],
): ScopeFieldName[] {
  return [...new Set(requiredScope)].filter(isScopeFieldName).sort();
}

export function getMcpOperationInputSchema(
  requiredScope: readonly McpScopeRequirement[] = [],
): z.ZodType<McpOperationInputPayload> {
  const requiredScopeFields = uniqueRequiredScopeFields(requiredScope);
  if (requiredScopeFields.length === 0) {
    return mcpOperationInputBaseSchema;
  }

  const cacheKey = requiredScopeFields.join('|');
  const cachedSchema = schemaCache.get(cacheKey);
  if (cachedSchema) {
    return cachedSchema;
  }

  const overlaySchema = mcpOperationInputBaseSchema.superRefine(
    (payload, context) => {
      for (const scopeField of requiredScopeFields) {
        if (payload.scope[scopeField] === undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['scope', scopeField],
            message: `scope.${scopeField} is required by operation.requiredScope`,
            params: { errorCode: 'required' },
          });
        }
      }
    },
  );

  schemaCache.set(cacheKey, overlaySchema);
  return overlaySchema;
}

export const mcpOperationInputSchemaDocument = {
  $id: MCP_OPERATION_INPUT_SCHEMA_ID,
  ...zodToJsonSchema(mcpOperationInputBaseSchema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }),
} as Record<string, unknown>;

export function getMcpOperationInputOverlaySchemaDocument(
  requiredScope: readonly McpScopeRequirement[] = [],
): Record<string, unknown> {
  const requiredScopeFields = uniqueRequiredScopeFields(requiredScope);

  if (requiredScopeFields.length === 0) {
    return mcpOperationInputSchemaDocument;
  }

  return {
    allOf: [
      { $ref: MCP_OPERATION_INPUT_SCHEMA_ID },
      {
        type: 'object',
        required: ['scope'],
        properties: {
          scope: {
            type: 'object',
            required: requiredScopeFields,
          },
        },
      },
    ],
  };
}
