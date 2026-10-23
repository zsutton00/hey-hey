import { z } from 'zod';
import { AgentEdgeCategory } from '../../generated/model/agentEdgeCategory';
import { AgentEdgeDirection } from '../../generated/model/agentEdgeDirection';
import { AgentEdgeEndpointEntityType } from '../../generated/model/agentEdgeEndpointEntityType';
import { AgentEdgeType } from '../../generated/model/agentEdgeType';
import type { WorkItemTypeCapabilities } from '../../generated/model/workItemTypeCapabilities';
import { WorkItemTypeGraphAction } from '../../generated/model/workItemTypeGraphAction';
import type { WorkItemTypeGraphCapability } from '../../generated/model/workItemTypeGraphCapability';
import { WorkItemTypeGraphEndpointRole } from '../../generated/model/workItemTypeGraphEndpointRole';
import type { WorkItemTypeGraphReadExpansion } from '../../generated/model/workItemTypeGraphReadExpansion';
import { WorkItemTypeGraphReadExpansionHop } from '../../generated/model/workItemTypeGraphReadExpansionHop';

const workItemTypeGraphEndpointRuleSchema = z
  .object({
    role: z.nativeEnum(WorkItemTypeGraphEndpointRole),
    entityTypes: z.array(z.nativeEnum(AgentEdgeEndpointEntityType)),
    workItemTypeKeys: z.array(z.string()).optional(),
  })
  .passthrough();

const workItemTypeGraphDirectionRuleSchema = z
  .object({
    required: z.boolean().optional(),
    allowedDirections: z.array(z.nativeEnum(AgentEdgeDirection)).optional(),
    predicateRequired: z.boolean().optional(),
  })
  .passthrough();

const workItemTypeGraphRelationshipDeclarationSchema = z
  .object({
    edgeType: z.nativeEnum(AgentEdgeType),
    category: z.nativeEnum(AgentEdgeCategory),
    sourceEndpoint: workItemTypeGraphEndpointRuleSchema,
    targetEndpoint: workItemTypeGraphEndpointRuleSchema,
    direction: workItemTypeGraphDirectionRuleSchema.optional(),
    metadataSchemaRef: z.string().nullable().optional(),
  })
  .passthrough();

const workItemTypeGraphSearchableMetaLinkTargetSchema = z
  .object({
    edgeType: z.nativeEnum(AgentEdgeType),
    targetEntityTypes: z.array(z.nativeEnum(AgentEdgeEndpointEntityType)),
    targetWorkItemTypeKeys: z.array(z.string()).optional(),
  })
  .passthrough();

const workItemTypeGraphReadExpansionSchema: z.ZodType<WorkItemTypeGraphReadExpansion> =
  z
    .object({
      key: z.string().min(1),
      seed: z.enum(['graphRoot', 'graphNodes']),
      path: z
        .array(
          z
            .object({
              relationshipType: z.nativeEnum(
                WorkItemTypeGraphReadExpansionHop.RelationshipTypeEnum,
              ),
              direction: z.enum(['OUTGOING', 'INCOMING']),
              target: z
                .object({
                  entityTypes: z
                    .array(z.nativeEnum(AgentEdgeEndpointEntityType))
                    .min(1),
                  workItemTypeKeys: z.array(z.string()).optional(),
                })
                .strict(),
            })
            .strict(),
        )
        .min(1)
        .max(5),
      projectionKind: z.literal('workItemReference'),
      deduplicateBy: z.literal('entityId'),
      excludeRoot: z.boolean().optional(),
      limit: z.number().int().min(1).max(500),
    })
    .strict();

export const workItemTypeGraphCapabilitySchema: z.ZodType<WorkItemTypeGraphCapability> =
  z
    .object({
      nodeChildType: z.string(),
      layout: z
        .object({
          sectionKey: z.string(),
          schemaRef: z.string(),
        })
        .passthrough(),
      layoutPreference: z
        .object({
          sectionKey: z.string(),
          schemaRef: z.string(),
        })
        .strict()
        .optional(),
      groups: z
        .object({
          sectionKey: z.string(),
          schemaRef: z.string(),
        })
        .strict()
        .optional(),
      readableRelationships: z.array(
        workItemTypeGraphRelationshipDeclarationSchema,
      ),
      editableRelationships: z.array(
        workItemTypeGraphRelationshipDeclarationSchema,
      ),
      searchableMetaLinkTargets: z
        .array(workItemTypeGraphSearchableMetaLinkTargetSchema)
        .optional(),
      rendererKey: z.string(),
      editorKey: z.string(),
      supportedActions: z.array(z.nativeEnum(WorkItemTypeGraphAction)),
      readExpansions: z.array(workItemTypeGraphReadExpansionSchema).optional(),
    })
    .passthrough();

type BooleanCapabilityKey = Exclude<keyof WorkItemTypeCapabilities, 'graph'>;
type BooleanCapabilityShape = {
  [K in BooleanCapabilityKey]-?: z.ZodOptional<z.ZodBoolean>;
};

const booleanCapabilityShape = {
  requiresParent: z.boolean().optional(),
  planEligible: z.boolean().optional(),
  hasSetInitialStatus: z.boolean().optional(),
  rendersInline: z.boolean().optional(),
  showsInExplorerSidebar: z.boolean().optional(),
} satisfies BooleanCapabilityShape;

type PersistedWorkItemTypeCapabilities = Omit<
  WorkItemTypeCapabilities,
  'graph'
>;

const persistedWorkItemTypeCapabilitiesSchema: z.ZodType<PersistedWorkItemTypeCapabilities> =
  z.object(booleanCapabilityShape).strict();

const workItemTypeCapabilityShape = {
  ...booleanCapabilityShape,
  graph: workItemTypeGraphCapabilitySchema.optional(),
} satisfies {
  [K in keyof WorkItemTypeCapabilities]-?: z.ZodType<
    WorkItemTypeCapabilities[K]
  >;
};

/**
 * Strict runtime representation of the generated capability contract. The
 * mapped shape makes a generated key addition/removal a compile-time change,
 * while `.strict()` rejects persisted or proposed aliases at runtime.
 */
export const workItemTypeCapabilitiesSchema: z.ZodType<WorkItemTypeCapabilities> =
  z.object(workItemTypeCapabilityShape).strict();

export function splitWorkItemTypeCapabilities(value: unknown): {
  capabilities: PersistedWorkItemTypeCapabilities;
  graphConfiguration: WorkItemTypeGraphCapability | null;
} {
  const { graph, ...capabilities } = workItemTypeCapabilitiesSchema.parse(
    value ?? {},
  );
  return { capabilities, graphConfiguration: graph ?? null };
}

export function materializeWorkItemTypeCapabilities(
  capabilitiesValue: unknown,
  graphConfigurationValue: unknown,
): WorkItemTypeCapabilities {
  const capabilities = persistedWorkItemTypeCapabilitiesSchema.parse(
    capabilitiesValue ?? {},
  );
  if (
    graphConfigurationValue === null ||
    graphConfigurationValue === undefined
  ) {
    return capabilities;
  }
  return {
    ...capabilities,
    graph: workItemTypeGraphCapabilitySchema.parse(graphConfigurationValue),
  };
}
