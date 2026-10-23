import type { WorkflowProposalLinkInput } from 'src/generated';
import { z } from 'zod';

export const WORKFLOW_EDGE_PREDICATE_MAX_LENGTH = 200;

export const WORKFLOW_EDGE_PREDICATE_PATTERN =
  /^(?=.*[A-Za-z0-9_.:/=()!<>&|+\-])[A-Za-z0-9_ .:/=()!<>&|+\-]+$/;

const sourceStepTempIdSchema = z
  .string()
  .min(1)
  .describe('tempId of the proposed workflow_step that originates the link');

const targetStepTempIdSchema = z
  .string()
  .min(1)
  .describe('tempId of the proposed workflow_step target');

const directionSchema = z
  .enum(['forward', 'backward'])
  .describe('Direction of a STANDARD or CONDITIONAL workflow flow link');

const descriptionSchema = z
  .string()
  .optional()
  .describe('Human-readable explanation of the workflow link');

export const workflowEdgePredicateSchema = z
  .string()
  .min(1)
  .max(WORKFLOW_EDGE_PREDICATE_MAX_LENGTH)
  .regex(WORKFLOW_EDGE_PREDICATE_PATTERN)
  .describe(
    'Non-blank CONDITIONAL or LOOP branch label or predicate using the portable workflow predicate character set',
  );

const standardLinkSchema = z
  .object({
    sourceStepTempId: sourceStepTempIdSchema,
    type: z.literal('STANDARD'),
    targetStepTempId: targetStepTempIdSchema,
    direction: directionSchema,
    description: descriptionSchema,
  })
  .strict();

const conditionalLinkSchema = z
  .object({
    sourceStepTempId: sourceStepTempIdSchema,
    type: z.literal('CONDITIONAL'),
    targetStepTempId: targetStepTempIdSchema,
    direction: directionSchema,
    predicate: workflowEdgePredicateSchema,
    description: descriptionSchema,
  })
  .strict();

const loopLinkSchema = z
  .object({
    sourceStepTempId: sourceStepTempIdSchema,
    type: z.literal('LOOP'),
    targetStepTempId: targetStepTempIdSchema.optional(),
    predicate: workflowEdgePredicateSchema.optional(),
    description: descriptionSchema,
  })
  .strict();

const fulfilledByLinkSchema = z
  .object({
    sourceStepTempId: sourceStepTempIdSchema,
    type: z.literal('FULFILLED_BY'),
    targetTaskId: z
      .string()
      .uuid()
      .describe('Existing work-item task that fulfills the workflow step'),
    description: descriptionSchema,
  })
  .strict();

export const workflowProposalLinkInputSchema = z.discriminatedUnion('type', [
  standardLinkSchema,
  conditionalLinkSchema,
  loopLinkSchema,
  fulfilledByLinkSchema,
]) satisfies z.ZodType<WorkflowProposalLinkInput>;

export type WorkflowProposalLinkSchemaInput = z.infer<
  typeof workflowProposalLinkInputSchema
>;
