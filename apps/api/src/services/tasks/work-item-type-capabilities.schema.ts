import { monitorOperationPolicyIssues } from '@hey-hey/contracts/monitor-kind-policy';
import { z } from 'zod';
import { AgentEdgeCategory } from '@hey-hey/contracts/api/models';
import { AgentEdgeDirection } from '@hey-hey/contracts/api/models';
import { AgentEdgeEndpointEntityType } from '@hey-hey/contracts/api/models';
import { AgentEdgeType } from '@hey-hey/contracts/api/models';
import type { WorkItemTypeCapabilities } from '@hey-hey/contracts/api/models';
import type {
  WorkItemTypeMonitorKind,
  WorkItemTypeMonitorKindDonePolicy,
  WorkItemTypeMonitorKindStartPolicy,
  WorkItemTypeMonitorKindSupervisionPolicy,
} from '@hey-hey/contracts/api/models';
import { WorkStatus } from '@hey-hey/contracts/api/models';
import { TaskMonitorLaunchMethod } from '@hey-hey/contracts/api/models';
import { TaskMonitorLaunchProvider } from '@hey-hey/contracts/api/models';
import { TaskMonitorReasoningEffort } from '@hey-hey/contracts/api/models';
import { WorkItemTypeGraphAction } from '@hey-hey/contracts/api/models';
import type { WorkItemTypeGraphCapability } from '@hey-hey/contracts/api/models';
import { WorkItemTypeGraphEndpointRole } from '@hey-hey/contracts/api/models';
import type { WorkItemTypeGraphReadExpansion } from '@hey-hey/contracts/api/models';
import { WorkItemTypeGraphReadExpansionHop } from '@hey-hey/contracts/api/models';

const workItemTypeGraphEndpointRuleSchema = z
  .object({
    role: z
      .nativeEnum(WorkItemTypeGraphEndpointRole)
      .describe('Endpoint role relative to the graph surface.'),
    entityTypes: z
      .array(z.nativeEnum(AgentEdgeEndpointEntityType))
      .describe('Entity types allowed for this endpoint.'),
    workItemTypeKeys: z
      .array(z.string())
      .optional()
      .describe(
        'Work-item type keys allowed when the endpoint entity type is TASK.',
      ),
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
    edgeType: z
      .nativeEnum(AgentEdgeType)
      .describe('Relationship label visible to the graph reader or editor.'),
    category: z
      .nativeEnum(AgentEdgeCategory)
      .describe(
        'Whether this relationship is flow structure or meta topology.',
      ),
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

const workItemTypeGraphCapabilityShape = {
  nodeChildType: z
    .string()
    .describe('Child work-item type key eligible to act as a graph node.'),
  layout: z
    .object({
      sectionKey: z.string(),
      schemaRef: z.string(),
    })
    .passthrough()
    .describe('Type-owned JSON section that stores authored logical layout.'),
  layoutPreference: z
    .object({
      sectionKey: z.string(),
      schemaRef: z.string(),
    })
    .strict()
    .optional()
    .describe('Type-owned JSON section that stores the preferred graph shape.'),
  groups: z
    .object({
      sectionKey: z.string(),
      schemaRef: z.string(),
    })
    .strict()
    .optional()
    .describe(
      'Optional type-owned JSON section that stores named groups and nested boundaries.',
    ),
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
  readExpansions: z
    .array(workItemTypeGraphReadExpansionSchema)
    .optional()
    .describe(
      'Bounded relationship lookups that add derived references to graph reads.',
    ),
} satisfies {
  [K in keyof WorkItemTypeGraphCapability]-?: z.ZodType<
    WorkItemTypeGraphCapability[K]
  >;
};

export const workItemTypeGraphCapabilitySchema: z.ZodType<WorkItemTypeGraphCapability> =
  z.object(workItemTypeGraphCapabilityShape).passthrough();

type BooleanCapabilityKey = Exclude<
  keyof WorkItemTypeCapabilities,
  'graph' | 'monitorKinds'
>;
type BooleanCapabilityShape = {
  [K in BooleanCapabilityKey]-?: z.ZodOptional<z.ZodBoolean>;
};

const booleanCapabilityShape = {
  requiresParent: z.boolean().optional(),
  planEligible: z.boolean().optional(),
  supportsSupersession: z.boolean().optional(),
  rendersInline: z.boolean().optional(),
  showsInExplorerSidebar: z.boolean().optional(),
} satisfies BooleanCapabilityShape;

type PersistedWorkItemTypeCapabilities = Omit<
  WorkItemTypeCapabilities,
  'graph'
>;

const monitorKindStartPolicySchema: z.ZodType<WorkItemTypeMonitorKindStartPolicy> =
  z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('STATUS_TRANSITION'),
        status: z.nativeEnum(WorkStatus),
      })
      .strict(),
    z.object({ type: z.literal('NO_STATUS_CHANGE') }).strict(),
  ]);

const monitorKindDonePolicySchema: z.ZodType<WorkItemTypeMonitorKindDonePolicy> =
  z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('ITEM_STATUS'),
        status: z.nativeEnum(WorkStatus),
      })
      .strict(),
    z.object({ type: z.literal('NORMALIZED_RESULT') }).strict(),
  ]);

const monitorKindSupervisionPolicySchema: z.ZodType<WorkItemTypeMonitorKindSupervisionPolicy> =
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('COORDINATOR_REVIEW') }).strict(),
    z.object({ type: z.literal('DIRECT_ACCEPTANCE') }).strict(),
  ]);

/**
 * A declared policy is optional: the registry resolves an omitted one from the
 * canonical TASK_MONITOR definition. Explicit null, unknown policy types and
 * unknown fields are rejected, and a kind that declares both done and
 * supervision must declare a supported pairing.
 */
const workItemTypeMonitorKindSchema: z.ZodType<WorkItemTypeMonitorKind> = z
  .object({
    key: z.string().min(1),
    allowedNodeTypes: z.array(z.string()).min(1),
    allowedLaunchMethods: z.array(z.nativeEnum(TaskMonitorLaunchMethod)).min(1),
    allowedRuntimeProviders: z
      .array(z.nativeEnum(TaskMonitorLaunchProvider))
      .min(1),
    allowedReasoningEfforts: z
      .array(z.nativeEnum(TaskMonitorReasoningEffort))
      .min(1),
    start: monitorKindStartPolicySchema.optional(),
    done: monitorKindDonePolicySchema.optional(),
    supervision: monitorKindSupervisionPolicySchema.optional(),
    acceptance: z
      .object({ type: z.enum(['COMPLETE_ITEM', 'NO_STATUS_CHANGE']) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((kind, context) => {
    for (const message of monitorOperationPolicyIssues(kind)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['done', 'type'],
        message,
      });
    }
  });

/**
 * The kinds a monitor type declares. Each monitor selects one by key, so a key
 * may be declared only once.
 */
const workItemTypeMonitorKindsSchema: z.ZodType<WorkItemTypeMonitorKind[]> = z
  .array(workItemTypeMonitorKindSchema)
  .min(1)
  .superRefine((kinds, context) => {
    const seen = new Set<string>();
    kinds.forEach((kind, index) => {
      if (seen.has(kind.key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'key'],
          message: `monitor kind key "${kind.key}" is declared more than once`,
        });
      }
      seen.add(kind.key);
    });
  });

const workItemTypeCapabilityShape = {
  ...booleanCapabilityShape,
  graph: workItemTypeGraphCapabilitySchema.optional(),
  monitorKinds: workItemTypeMonitorKindsSchema.optional(),
} satisfies {
  [K in keyof WorkItemTypeCapabilities]-?: z.ZodType<
    WorkItemTypeCapabilities[K]
  >;
};

const persistedWorkItemTypeCapabilitiesSchema: z.ZodType<PersistedWorkItemTypeCapabilities> =
  z
    .object({
      ...booleanCapabilityShape,
      monitorKinds: workItemTypeMonitorKindsSchema.optional(),
    })
    .strict();

export const WORK_ITEM_TYPE_CAPABILITY_AXES = Object.freeze(
  Object.keys(workItemTypeCapabilityShape),
);

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
