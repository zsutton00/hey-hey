import { z } from 'zod';

/**
 * Runtime shapes shared by the FEATURE authoring and proposal-validation
 * boundaries. Keep these aligned with the generated FeatureRequirement*
 * DTOs; the OpenAPI schemas define the wire contract and these schemas enforce
 * it before a proposal is persisted.
 */
export const featureRequirementGroupSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9 -]*[A-Za-z0-9])?$/,
    'must contain only letters, digits, spaces, and hyphens, and start and end with a letter or digit',
  )
  .describe(
    'Feature-local grouping label using alphanumeric characters, spaces, and hyphens',
  );

export const featureRequirementCiteSchema = z
  .object({
    entityType: z
      .string()
      .describe('Entity type of the cited entity (e.g. TASK, DESIGN_DOC)'),
    entityId: z.string().uuid().describe('UUID of the cited entity'),
  })
  .strict();

const featureRequirementDesignDocCitationSchema =
  featureRequirementCiteSchema.extend({ entityType: z.literal('DESIGN_DOC') });
const featureRequirementMockupCitationSchema =
  featureRequirementCiteSchema.extend({ entityType: z.literal('MOCKUP') });
const featureRequirementDiagramCitationSchema =
  featureRequirementCiteSchema.extend({ entityType: z.literal('DIAGRAM') });
const featureRequirementDesignCitationSchema = z.discriminatedUnion(
  'entityType',
  [
    featureRequirementDesignDocCitationSchema,
    featureRequirementMockupCitationSchema,
    featureRequirementDiagramCitationSchema,
  ],
);
const featureRequirementTaskCitationSchema =
  featureRequirementCiteSchema.extend({ entityType: z.literal('TASK') });
const featureRequirementPlanCitationSchema =
  featureRequirementCiteSchema.extend({ entityType: z.literal('PLAN') });
const featureRequirementContractCitationSchema =
  featureRequirementCiteSchema.extend({ entityType: z.literal('CONTRACT') });
const featureRequirementFulfillmentCitationSchema = z.union([
  featureRequirementTaskCitationSchema,
  featureRequirementPlanCitationSchema,
]);

export const featureRequirementCitePatchSchema = z
  .object({
    add: z.array(featureRequirementCiteSchema).optional(),
    remove: z.array(featureRequirementCiteSchema).optional(),
  })
  .strict();

const citePatchSchema = <T extends z.ZodTypeAny>(citationSchema: T) =>
  z
    .object({
      add: z.array(citationSchema).optional(),
      remove: z.array(citationSchema).optional(),
    })
    .strict();

const featureRequirementDesignCitationPatchSchema = citePatchSchema(
  featureRequirementDesignCitationSchema,
);
const featureRequirementFulfillmentCitationPatchSchema = citePatchSchema(
  featureRequirementFulfillmentCitationSchema,
);
const featureRequirementContractCitationPatchSchema = citePatchSchema(
  featureRequirementContractCitationSchema,
);

export const featureRequirementInputSchema = z
  .object({
    statement: z.string().describe('Requirement statement text'),
    group: featureRequirementGroupSchema.optional(),
    designedBy: z
      .array(featureRequirementDesignCitationSchema)
      .optional()
      .describe('DESIGN_DOC, MOCKUP, or DIAGRAM cites that designed this requirement'),
    fulfilledBy: z
      .array(featureRequirementFulfillmentCitationSchema)
      .optional()
      .describe('TASK or PLAN cites that fulfill this requirement'),
    contracts: z
      .array(featureRequirementContractCitationSchema)
      .optional()
      .describe(
        'CONTRACT cites that formalize the boundary this requirement establishes',
      ),
  })
  .strict();

export const featureRequirementAddOperationSchema = z
  .object({
    op: z.literal('add'),
    value: featureRequirementInputSchema,
    before: z
      .string()
      .optional()
      .describe(
        'Durable UUID of the requirement to insert before; appends when absent or not found',
      ),
  })
  .strict();

export const featureRequirementUpdateOperationSchema = z
  .object({
    op: z.literal('update'),
    targetId: z
      .string()
      .describe(
        'Durable UUID of the requirement to update (preserved when statement changes)',
      ),
    statement: z
      .string()
      .optional()
      .describe(
        'Replacement statement text. Changing the text preserves the durable ID',
      ),
    group: featureRequirementGroupSchema
      .nullable()
      .optional()
      .describe(
        'Optional group change: omit to preserve the current group, provide a valid label to set or rename it, or provide null to clear it',
      ),
    designedBy: featureRequirementDesignCitationPatchSchema.optional(),
    fulfilledBy: featureRequirementFulfillmentCitationPatchSchema.optional(),
    contracts: featureRequirementContractCitationPatchSchema.optional(),
  })
  .strict();

export const featureRequirementDeleteOperationSchema = z
  .object({
    op: z.literal('delete'),
    targetId: z.string().describe('Durable UUID of the requirement to remove'),
  })
  .strict();

export const featureRequirementOperationSchema = z.discriminatedUnion('op', [
  featureRequirementAddOperationSchema,
  featureRequirementUpdateOperationSchema,
  featureRequirementDeleteOperationSchema,
]);

export interface LintWarning {
  id: string;
  message: string;
}

/** Trim, collapse internal whitespace, and strip trailing punctuation. */
export function canonicalize(statement: string): string {
  return statement
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/, '');
}
