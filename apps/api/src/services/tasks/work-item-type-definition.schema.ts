import { z } from 'zod';
import { AgentEdgeType } from '@hey-hey/contracts/api/models';
import { EntityType } from '@hey-hey/contracts/api/models';
import { ReportType } from '@hey-hey/contracts/api/models';
import { WorkItemColorKey } from '@hey-hey/contracts/api/models';
import { WorkItemConfigKind } from '@hey-hey/contracts/api/models';
import { WorkItemIconKey } from '@hey-hey/contracts/api/models';
import type { WorkItemTypeDefinitionDto } from '@hey-hey/contracts/api/models';
import type { WorkItemTypeEdgeTarget } from '@hey-hey/contracts/api/models';
import { WorkItemTypeRole } from '@hey-hey/contracts/api/models';
import { WorkItemTypeScalarField } from '@hey-hey/contracts/api/models';
import { WorkItemTypeSectionDefinition } from '@hey-hey/contracts/api/models';
import { diagramElementPolicySchema } from './diagram-metadata';
import { workItemTypeSessionRoleGuidanceSchema } from './work-item-type-agent-guidance.schema';
import { workItemTypeCapabilitiesSchema } from './work-item-type-capabilities.schema';
import { workItemTypeStatusesSchema } from './work-item-type-status.schema';

/**
 * The one runtime check for a submitted work-item type definition, shared by
 * the agent type tools and proposal validation.
 *
 * A setting is never dropped silently: every object here refuses an unknown
 * key by name (Zod's default would strip it). Each shape is mapped over its
 * generated model, so a newly declared setting fails the type check until it
 * is accepted here.
 */

type ContractShape<T> = {
  [K in keyof T]-?: z.ZodType<T[K], z.ZodTypeDef, unknown>;
};

const sizeSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

const sizeProfileSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    breakpoints: z
      .array(
        z
          .object({
            minContainerWidth: z.number().int().min(0),
            inline: sizeSchema,
            page: sizeSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const sectionShape = {
  key: z
    .string()
    .min(1)
    .describe(
      'Stable identifier for the section within the type (e.g. "audience").',
    ),
  label: z
    .string()
    .min(1)
    .describe(
      'Human-readable section heading shown in the editor and review surfaces.',
    ),
  writingStandard: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Guidance describing what belongs in this section and to what quality ' +
        'bar — the per-section authoring contract surfaced to drafters.',
    ),
  kind: z
    .nativeEnum(WorkItemTypeSectionDefinition.KindEnum)
    .optional()
    .describe(
      'Storage/editor kind for the section. Markdown sections store prose; ' +
        'json sections store schema-backed JSON; html/css sections store an object with required string html and css fields; structured-mockup sections store a versioned host-rendered component document.',
    ),
  schemaRef: z
    .string()
    .nullable()
    .optional()
    .describe(
      'OpenAPI component schema reference for json sections. Omitted for markdown, html/css, and structured-mockup sections.',
    ),
  diagramElementPolicy: diagramElementPolicySchema.optional(),
  sizeProfiles: z
    .array(sizeProfileSchema)
    .min(1)
    .optional()
    .describe(
      'Named definition-owned HTML/CSS or structured-mockup presentation profiles; item content selects only a sizeKey.',
    ),
  required: z
    .boolean()
    .optional()
    .describe(
      'Whether this section must be supplied at creation; omission retains the legacy required policy.',
    ),
  defaultSizeKey: z
    .string()
    .min(1)
    .optional()
    .describe('Profile used when mockup content omits sizeKey.'),
} satisfies ContractShape<WorkItemTypeSectionDefinition>;

const workItemTypeSectionDefinitionSchema = z
  .object(sectionShape)
  .strict()
  .superRefine((section, ctx) => {
    const isSourceSection =
      section.kind === 'html/css' || section.kind === 'structured-mockup';
    if (isSourceSection && section.schemaRef != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schemaRef'],
        message:
          'schemaRef must be omitted for html/css and structured-mockup sections',
      });
    }

    const hasSizing =
      section.sizeProfiles !== undefined ||
      section.defaultSizeKey !== undefined;
    if (!isSourceSection && hasSizing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'size profiles are supported only for html/css and structured-mockup sections',
      });
    }
    if (!isSourceSection || !hasSizing) {
      return;
    }

    const keys = section.sizeProfiles?.map(({ key }) => key) ?? [];
    if (
      !section.sizeProfiles ||
      !section.defaultSizeKey ||
      !keys.includes(section.defaultSizeKey)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'sizeProfiles and a matching defaultSizeKey are required together',
      });
    }
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'size profile keys must be unique',
      });
    }
    section.sizeProfiles?.forEach((profile, profileIndex) => {
      if (
        profile.breakpoints[0]?.minContainerWidth !== 0 ||
        profile.breakpoints.some(
          (point, index, points) =>
            index > 0 &&
            point.minContainerWidth <=
              (points[index - 1]?.minContainerWidth ?? -1),
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sizeProfiles', profileIndex, 'breakpoints'],
          message: 'breakpoints must begin at 0 and be strictly ascending',
        });
      }
    });
  });

// requiredScalars/forbiddenScalars name fields from this closed set;
// membership says whether the field is mandatory or rejected on the type.
const workItemTypeScalarFieldSchema = z
  .nativeEnum(WorkItemTypeScalarField)
  .describe(
    'A scalar field an item may carry beyond its content sections (one of ' +
      'the closed WorkItemTypeScalarField set).',
  );

const workItemTypeEdgeTargetSchema = z
  .object({
    edgeType: z
      .nativeEnum(AgentEdgeType)
      .describe('The typed edge an item of this type may originate.'),
    targetTypeKeys: z
      .array(z.string())
      .describe(
        'Type keys this edge may point at. An empty array means the edge type ' +
          'is permitted against any type.',
      ),
  } satisfies ContractShape<WorkItemTypeEdgeTarget>)
  .strict();

export const WORK_ITEM_TYPE_PARENTAGE_GUIDANCE =
  'List work-item type keys such as STANDARD in allowedParentTypes. When this ' +
  'list is non-empty, TASK is added to allowedParentEntityTypes automatically; ' +
  'an empty list keeps the type top-level unless another entity parent is explicitly allowed.';

const definitionShape = {
  key: z
    .string()
    .min(1)
    .describe(
      'Stable uppercase identifier for the type (e.g. "MARKETING"). This is ' +
        "the value carried on a work item's `type`, the `{typeKey}` path " +
        'segment on the /work-item-types endpoints, and the key ' +
        'get_tool_guidance is requested by. Immutable once a type is created.',
    ),
  name: z
    .string()
    .min(1)
    .describe(
      'Human-readable display name shown in create flows and review surfaces.',
    ),
  role: z
    .nativeEnum(WorkItemTypeRole)
    .describe(
      'Classification-only role for grouping definitions by purpose; it does not carry execution behavior.',
    ),
  acceptedConfigKinds: z
    .array(z.nativeEnum(WorkItemConfigKind))
    .optional()
    .describe(
      'Explicit launch-configuration kinds this type accepts. Omit or pass an empty array when the type has no typed launch defaults; do not infer acceptance from the type key, role, or capability flags.',
    ),
  colorKey: z.nativeEnum(WorkItemColorKey).optional(),
  iconKey: z
    .nativeEnum(WorkItemIconKey)
    .optional()
    .describe(
      'Icon token from the closed WorkItemIconKey palette used by shared clients.',
    ),
  description: z
    .string()
    .nullable()
    .optional()
    .describe(
      'One-paragraph purpose of the type — what work it captures and when to ' +
        'reach for it.',
    ),
  sections: z
    .array(workItemTypeSectionDefinitionSchema)
    .describe(
      'Ordered per-type content sections. Each section carries its own ' +
        'writing standard, so the authoring contract for an item of this type ' +
        'is fully described by its definition.',
    ),
  requiredScalars: z
    .array(workItemTypeScalarFieldSchema)
    .optional()
    .describe(
      'Scalar fields an item of this type must carry. Each entry names a ' +
        'field from the closed WorkItemTypeScalarField set; membership here ' +
        'means an item cannot be created without that field.',
    ),
  forbiddenScalars: z
    .array(workItemTypeScalarFieldSchema)
    .optional()
    .describe(
      'Scalar fields an item of this type may not carry. Each entry names a ' +
        'field from the closed WorkItemTypeScalarField set; membership here ' +
        'means the field is rejected on items of this type.',
    ),
  // The DTO carries no explicit initial-status field: a type's initial status
  // is derived from its statuses, so a non-empty list is required.
  statuses: workItemTypeStatusesSchema.describe(
    "Ordered ordinary statuses: each is the name the user typed plus exactly one meaning (COMPLETED, CANCELLED, IN_PROGRESS, or CUSTOM with 1-50 characters of text in the user's own words); first is initial. Call resolve_work_item_type_statuses to validate a list; a status without a meaning is rejected, so ask the user rather than guessing.",
  ),
  allowedParentTypes: z
    .array(z.string())
    .optional()
    .describe(WORK_ITEM_TYPE_PARENTAGE_GUIDANCE),
  edgeTargets: z
    .array(workItemTypeEdgeTargetSchema)
    .optional()
    .describe(
      'Which typed edges an item of this type may originate, and the type ' +
        'keys each edge may point at.',
    ),
  allowedParentEntityTypes: z
    .array(z.nativeEnum(EntityType))
    .optional()
    .describe(
      'Entity types an item may be parented under, distinct from work-item ' +
        'type-key parentage in allowedParentTypes.',
    ),
  tracking: z
    .object({
      allowedSourceEntityTypes: z.array(z.nativeEnum(EntityType)),
      allowedSourceTaskTypes: z.array(z.string()),
    })
    .strict()
    .optional()
    .describe(
      'Dedicated inbound TRACKS policy: which entity types and work-item ' +
        'type keys may track this target type.',
    ),
  agentSettableStatuses: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Ordinary status names plus ARCHIVED that agents may propose directly. ' +
        "Every entry must be one of the type's ordinary status names or ARCHIVED. " +
        'When omitted on create, defaults to all of them; when omitted on edit, the ' +
        "type's current list is kept. Pass a narrower list (or an empty one) only to " +
        'restrict agents on purpose, and update it when renaming statuses.',
    ),
  anchorableReportTypes: z
    .array(z.nativeEnum(ReportType))
    .optional()
    .describe('Report types that may be anchored to an item of this type.'),
  maintenanceGuidance: z.string().optional(),
  sessionRoleGuidance: workItemTypeSessionRoleGuidanceSchema.optional(),
  writingStandards: z
    .object({
      create: z.string(),
      edit: z.string(),
    })
    .strict()
    .nullable()
    .optional()
    .describe(
      'Type-level create and edit guidance, distinct from each section writingStandard.',
    ),
  capabilities: workItemTypeCapabilitiesSchema
    .optional()
    .describe(
      'Named capability flags consumed by product surfaces. Graph-capable ' +
        'types may also carry capabilities.graph.',
    ),
} satisfies ContractShape<WorkItemTypeDefinitionDto>;

export const workItemTypeDefinitionSchema = z.object(definitionShape).strict();
