import { z } from 'zod';
import {
  AgentEdgeCategory,
  AgentEdgeDirection,
  AgentEdgeEndpointEntityType,
  AgentMetaEdgeType,
  AgentEdgeType,
  FeatureTag,
  TaskPriority,
  WorkItemConditionalRelationshipCreateOperation,
  WorkItemCreateOperation,
  WorkItemDeleteOperation,
  WorkItemLayoutClearOperation,
  WorkItemLayoutReplaceOperation,
  WorkItemLoopRelationshipCreateOperation,
  WorkItemMetaRelationshipCreateOperation,
  WorkItemRelationshipDeleteOperation,
  WorkItemRelationshipUpdateOperation,
  WorkItemSectionClearOperation,
  WorkItemSectionReplaceOperation,
  WorkItemStandardRelationshipCreateOperation,
  WorkItemUpdateOperation,
  WorkStatus,
} from '../../generated';
import type {
  ExistingRelationshipIdentity,
  ExistingWorkItemIdentity,
  TemporaryRelationshipIdentity,
  TemporaryWorkItemIdentity,
  WorkItemChangeSetLayoutEntry,
  WorkItemChangeSetOperation,
  WorkItemChangeSetRelationshipIdentity,
  WorkItemChangeSetValidationRequest,
  WorkItemRelationshipCreateOperation,
} from '../../generated';
import { workflowEdgePredicateSchema } from './workflow-proposal-link.schema';

// Closed vocabularies come directly from generated OpenAPI runtime values.
// Never duplicate these lists in a handwritten validation schema.
const workStatusSchema = z.nativeEnum(WorkStatus);
const taskPrioritySchema = z.nativeEnum(TaskPriority);
const featureTagSchema = z.nativeEnum(FeatureTag);
const agentEdgeTypeSchema = z.nativeEnum(AgentEdgeType);
const agentMetaEdgeTypeSchema = z.nativeEnum(AgentMetaEdgeType);
const agentEdgeCategorySchema = z.nativeEnum(AgentEdgeCategory);
const agentEdgeDirectionSchema = z.nativeEnum(AgentEdgeDirection);
const agentEdgeEndpointEntityTypeSchema = z.nativeEnum(
  AgentEdgeEndpointEntityType,
);

type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.string(),
    z.number(),
    z.boolean(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const existingWorkItemIdentitySchema = z
  .object({
    refType: z.literal('existing'),
    id: z.string().uuid(),
  })
  .strict();

export const temporaryWorkItemIdentitySchema = z
  .object({
    refType: z.literal('temporary'),
    tempId: z.string().min(1),
  })
  .strict();

export const workItemChangeSetIdentitySchema = z.discriminatedUnion('refType', [
  existingWorkItemIdentitySchema,
  temporaryWorkItemIdentitySchema,
]);

export const existingRelationshipIdentitySchema = z
  .object({
    refType: z.literal('existing'),
    id: z.string().uuid(),
  })
  .strict();

export const temporaryRelationshipIdentitySchema = z
  .object({
    refType: z.literal('temporary'),
    tempId: z.string().min(1),
  })
  .strict();

export const workItemChangeSetRelationshipIdentitySchema = z.discriminatedUnion(
  'refType',
  [existingRelationshipIdentitySchema, temporaryRelationshipIdentitySchema],
);

// Validation preserves the JSON representation; assignment owns deduplication.
const serviceIdsSchema = z.array(z.string().uuid());

const workItemCreateOperationSchema = z
  .object({
    op: z.literal('workItem.create'),
    ref: temporaryWorkItemIdentitySchema,
    name: z.string().min(1),
    type: z.string().optional(),
    parent: workItemChangeSetIdentitySchema.optional(),
    status: workStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    dueDate: z.string().datetime({ offset: true }).nullable().optional(),
    assigneeId: z.string().uuid().nullable().optional(),
    tag: featureTagSchema.optional(),
    serviceIds: serviceIdsSchema.optional(),
  })
  .strict();

const workItemUpdateOperationSchema = z
  .object({
    op: z.literal('workItem.update'),
    ref: workItemChangeSetIdentitySchema,
    name: z.string().min(1).optional(),
    parent: workItemChangeSetIdentitySchema.nullable().optional(),
    status: workStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    dueDate: z.string().datetime({ offset: true }).nullable().optional(),
    assigneeId: z.string().uuid().nullable().optional(),
    tag: featureTagSchema.optional(),
    serviceIds: serviceIdsSchema.optional(),
  })
  .strict();

const workItemDeleteOperationSchema = z
  .object({
    op: z.literal('workItem.delete'),
    ref: workItemChangeSetIdentitySchema,
  })
  .strict();

const workItemSectionReplaceOperationSchema = z
  .object({
    op: z.literal('section.replace'),
    ref: workItemChangeSetIdentitySchema,
    key: z.string().min(1),
    content: jsonValueSchema,
  })
  .strict();

const workItemSectionClearOperationSchema = z
  .object({
    op: z.literal('section.clear'),
    ref: workItemChangeSetIdentitySchema,
    key: z.string().min(1),
  })
  .strict();

const workItemMetaRelationshipCreateOperationSchema = z
  .object({
    op: z.literal('relationship.create'),
    ref: temporaryRelationshipIdentitySchema,
    source: workItemChangeSetIdentitySchema,
    target: workItemChangeSetIdentitySchema,
    edgeType: agentMetaEdgeTypeSchema,
    category: z.literal('meta').optional(),
    direction: agentEdgeDirectionSchema.nullable().optional(),
    predicate: z.string().nullable().optional(),
    reasoning: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

const workItemStandardRelationshipCreateOperationSchema = z
  .object({
    op: z.literal('relationship.create'),
    ref: temporaryRelationshipIdentitySchema,
    source: workItemChangeSetIdentitySchema,
    target: workItemChangeSetIdentitySchema,
    edgeType: z.literal('STANDARD'),
    category: z.literal('flow'),
    direction: agentEdgeDirectionSchema,
    reasoning: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

const workItemConditionalRelationshipCreateOperationSchema = z
  .object({
    op: z.literal('relationship.create'),
    ref: temporaryRelationshipIdentitySchema,
    source: workItemChangeSetIdentitySchema,
    target: workItemChangeSetIdentitySchema,
    edgeType: z.literal('CONDITIONAL'),
    category: z.literal('flow'),
    direction: agentEdgeDirectionSchema,
    predicate: workflowEdgePredicateSchema,
    reasoning: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

const workItemLoopRelationshipCreateOperationSchema = z
  .object({
    op: z.literal('relationship.create'),
    ref: temporaryRelationshipIdentitySchema,
    source: workItemChangeSetIdentitySchema,
    target: workItemChangeSetIdentitySchema,
    edgeType: z.literal('LOOP'),
    category: z.literal('flow'),
    predicate: workflowEdgePredicateSchema.optional(),
    reasoning: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

const workItemRelationshipCreateOperationSchema = z.discriminatedUnion(
  'edgeType',
  [
    workItemMetaRelationshipCreateOperationSchema,
    workItemStandardRelationshipCreateOperationSchema,
    workItemConditionalRelationshipCreateOperationSchema,
    workItemLoopRelationshipCreateOperationSchema,
  ],
);

const workItemRelationshipUpdateOperationSchema = z
  .object({
    op: z.literal('relationship.update'),
    ref: workItemChangeSetRelationshipIdentitySchema,
    source: workItemChangeSetIdentitySchema.optional(),
    sourceEntityType: agentEdgeEndpointEntityTypeSchema.optional(),
    target: workItemChangeSetIdentitySchema.optional(),
    targetEntityType: agentEdgeEndpointEntityTypeSchema.optional(),
    edgeType: agentEdgeTypeSchema.optional(),
    category: agentEdgeCategorySchema.optional(),
    direction: agentEdgeDirectionSchema.optional(),
    predicate: z.string().nullable().optional(),
    reasoning: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

const workItemRelationshipDeleteOperationSchema = z
  .object({
    op: z.literal('relationship.delete'),
    ref: workItemChangeSetRelationshipIdentitySchema,
  })
  .strict();

const finiteCoordinateSchema = z.number().refine(Number.isFinite, {
  message: 'Layout coordinates must be finite numbers.',
});

const workItemChangeSetLayoutEntrySchema = z
  .object({
    node: workItemChangeSetIdentitySchema,
    position: z
      .object({ x: finiteCoordinateSchema, y: finiteCoordinateSchema })
      .strict(),
  })
  .strict();

const workItemLayoutReplaceOperationSchema = z
  .object({
    op: z.literal('layout.replace'),
    root: workItemChangeSetIdentitySchema,
    sectionKey: z.string().min(1),
    entries: z.array(workItemChangeSetLayoutEntrySchema),
  })
  .strict();

const workItemLayoutClearOperationSchema = z
  .object({
    op: z.literal('layout.clear'),
    root: workItemChangeSetIdentitySchema,
    sectionKey: z.string().min(1),
  })
  .strict();

const operationSchemasByOp = {
  [WorkItemCreateOperation.OpEnum.WorkItemCreate]:
    workItemCreateOperationSchema,
  [WorkItemUpdateOperation.OpEnum.WorkItemUpdate]:
    workItemUpdateOperationSchema,
  [WorkItemDeleteOperation.OpEnum.WorkItemDelete]:
    workItemDeleteOperationSchema,
  [WorkItemSectionReplaceOperation.OpEnum.SectionReplace]:
    workItemSectionReplaceOperationSchema,
  [WorkItemSectionClearOperation.OpEnum.SectionClear]:
    workItemSectionClearOperationSchema,
  [WorkItemMetaRelationshipCreateOperation.OpEnum.RelationshipCreate]:
    workItemRelationshipCreateOperationSchema,
  [WorkItemRelationshipUpdateOperation.OpEnum.RelationshipUpdate]:
    workItemRelationshipUpdateOperationSchema,
  [WorkItemRelationshipDeleteOperation.OpEnum.RelationshipDelete]:
    workItemRelationshipDeleteOperationSchema,
  [WorkItemLayoutReplaceOperation.OpEnum.LayoutReplace]:
    workItemLayoutReplaceOperationSchema,
  [WorkItemLayoutClearOperation.OpEnum.LayoutClear]:
    workItemLayoutClearOperationSchema,
} satisfies Record<
  WorkItemChangeSetOperation['op'],
  z.ZodType<WorkItemChangeSetOperation, z.ZodTypeDef, unknown>
>;

function schemaForOperation(
  operation: unknown,
): z.ZodType<WorkItemChangeSetOperation, z.ZodTypeDef, unknown> | null {
  if (operation === null || typeof operation !== 'object') return null;
  const op = (operation as { op?: unknown }).op;
  if (
    typeof op !== 'string' ||
    !Object.prototype.hasOwnProperty.call(operationSchemasByOp, op)
  ) {
    return null;
  }
  return operationSchemasByOp[op as keyof typeof operationSchemasByOp];
}

export const workItemChangeSetOperationSchema = z
  .unknown()
  .transform((operation, ctx): WorkItemChangeSetOperation => {
    const schema = schemaForOperation(operation);
    if (!schema) {
      ctx.addIssue({
        code: z.ZodIssueCode.invalid_union_discriminator,
        path: ['op'],
        options: Object.keys(operationSchemasByOp),
      });
      return z.NEVER;
    }

    const result = schema.safeParse(operation);
    if (!result.success) {
      result.error.issues.forEach((issue) => ctx.addIssue(issue));
      return z.NEVER;
    }
    return result.data;
  });

export const workItemChangeSetValidationRequestSchema = z
  .object({
    root: workItemChangeSetIdentitySchema,
    operations: z.array(workItemChangeSetOperationSchema),
    layoutBoundary: z.array(workItemChangeSetIdentitySchema).optional(),
  })
  .strict();

// Compile-time contract: each strict runtime schema must remain assignable to
// its generated OpenAPI model when either side changes.
export const workItemChangeSetSchemasAlignWithGeneratedTypes = {
  existingWorkItemIdentitySchema,
  temporaryWorkItemIdentitySchema,
  existingRelationshipIdentitySchema,
  temporaryRelationshipIdentitySchema,
  workItemChangeSetRelationshipIdentitySchema,
  workItemCreateOperationSchema,
  workItemUpdateOperationSchema,
  workItemDeleteOperationSchema,
  workItemSectionReplaceOperationSchema,
  workItemSectionClearOperationSchema,
  workItemRelationshipCreateOperationSchema,
  workItemMetaRelationshipCreateOperationSchema,
  workItemStandardRelationshipCreateOperationSchema,
  workItemConditionalRelationshipCreateOperationSchema,
  workItemLoopRelationshipCreateOperationSchema,
  workItemRelationshipUpdateOperationSchema,
  workItemRelationshipDeleteOperationSchema,
  workItemChangeSetLayoutEntrySchema,
  workItemLayoutReplaceOperationSchema,
  workItemLayoutClearOperationSchema,
  workItemChangeSetOperationSchema,
  workItemChangeSetValidationRequestSchema,
} satisfies {
  existingWorkItemIdentitySchema: z.ZodType<ExistingWorkItemIdentity>;
  temporaryWorkItemIdentitySchema: z.ZodType<TemporaryWorkItemIdentity>;
  existingRelationshipIdentitySchema: z.ZodType<ExistingRelationshipIdentity>;
  temporaryRelationshipIdentitySchema: z.ZodType<TemporaryRelationshipIdentity>;
  workItemChangeSetRelationshipIdentitySchema: z.ZodType<WorkItemChangeSetRelationshipIdentity>;
  workItemCreateOperationSchema: z.ZodType<
    WorkItemCreateOperation,
    z.ZodTypeDef,
    unknown
  >;
  workItemUpdateOperationSchema: z.ZodType<
    WorkItemUpdateOperation,
    z.ZodTypeDef,
    unknown
  >;
  workItemDeleteOperationSchema: z.ZodType<WorkItemDeleteOperation>;
  workItemSectionReplaceOperationSchema: z.ZodType<WorkItemSectionReplaceOperation>;
  workItemSectionClearOperationSchema: z.ZodType<WorkItemSectionClearOperation>;
  workItemRelationshipCreateOperationSchema: z.ZodType<WorkItemRelationshipCreateOperation>;
  workItemMetaRelationshipCreateOperationSchema: z.ZodType<WorkItemMetaRelationshipCreateOperation>;
  workItemStandardRelationshipCreateOperationSchema: z.ZodType<WorkItemStandardRelationshipCreateOperation>;
  workItemConditionalRelationshipCreateOperationSchema: z.ZodType<WorkItemConditionalRelationshipCreateOperation>;
  workItemLoopRelationshipCreateOperationSchema: z.ZodType<WorkItemLoopRelationshipCreateOperation>;
  workItemRelationshipUpdateOperationSchema: z.ZodType<WorkItemRelationshipUpdateOperation>;
  workItemRelationshipDeleteOperationSchema: z.ZodType<WorkItemRelationshipDeleteOperation>;
  workItemChangeSetLayoutEntrySchema: z.ZodType<WorkItemChangeSetLayoutEntry>;
  workItemLayoutReplaceOperationSchema: z.ZodType<WorkItemLayoutReplaceOperation>;
  workItemLayoutClearOperationSchema: z.ZodType<WorkItemLayoutClearOperation>;
  workItemChangeSetOperationSchema: z.ZodType<
    WorkItemChangeSetOperation,
    z.ZodTypeDef,
    unknown
  >;
  workItemChangeSetValidationRequestSchema: z.ZodType<
    WorkItemChangeSetValidationRequest,
    z.ZodTypeDef,
    unknown
  >;
};
