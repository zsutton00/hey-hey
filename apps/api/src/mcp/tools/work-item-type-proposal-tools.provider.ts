import { workItemTypeAgentGuidanceSchema } from '../../services/tasks/work-item-type-agent-guidance.schema';
import { diagramElementPolicySchema } from '../../services/tasks/diagram-metadata';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Context, Tool } from '@rekog/mcp-nest';
import type { Request } from 'express';
import { z } from 'zod';
import { AgentEdgeCategory } from '../../generated/model/agentEdgeCategory';
import { AgentEdgeDirection } from '../../generated/model/agentEdgeDirection';
import { AgentEdgeEndpointEntityType } from '../../generated/model/agentEdgeEndpointEntityType';
import { AgentEdgeType } from '../../generated/model/agentEdgeType';
import { EntityType } from '../../generated/model/entityType';
import { ReportType } from '../../generated/model/reportType';
import { WorkItemColorKey } from '../../generated/model/workItemColorKey';
import { WorkItemIconKey } from '../../generated/model/workItemIconKey';
import type { WorkItemTypeDefinitionDto } from '../../generated/model/workItemTypeDefinitionDto';
import { WorkItemTypeRole } from '../../generated/model/workItemTypeRole';
import type { WorkItemTypeEdgeTarget } from '../../generated/model/workItemTypeEdgeTarget';
import { WorkItemTypeEffectiveSource } from '../../generated/model/workItemTypeEffectiveSource';
import { WorkItemTypeScalarField } from '../../generated/model/workItemTypeScalarField';
import { WorkItemTypeSectionDefinition } from '../../generated/model/workItemTypeSectionDefinition';
import { WorkStatus } from '../../generated/model/workStatus';
import { WorkItemConfigKind } from '../../generated/model/workItemConfigKind';
import { ProposalService } from '../../services/proposal/proposal.service';
import { AdminGuard } from '../../auth/guards/admin.guard';
import {
  buildWorkItemTypeCreateProposal,
  buildWorkItemTypeEditProposal,
  buildWorkItemTypeRestoreProposal,
} from '../../services/proposal/work-item-type-proposal.builder';
import { assertWorkItemTypeEditSupported } from '../../services/proposal/work-item-type-edit-classifier';
import { WorkItemTypeLifecycleStatus } from '../../generated/model/workItemTypeLifecycleStatus';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { IMAGE_SECTION_CONTENT_SCHEMA_REF } from '../../services/tasks/image-section-content.validator';
import type { ProjectId } from '../../types';
import { extractAuthContext, isAuthContext, mcpError } from './mcp-tool.utils';
import { PROPOSAL_TOOL_NAMES } from './proposal-tool-names';
import { buildProvenanceEnvelope } from './provenance';
import { extractRequestorContext } from './requestor-context';
import { CREATE_WORK_ITEM_TYPE_TOOL_DESCRIPTION } from './work-item-type-review-contract';
import {
  invalidProposalChangeSetFromError,
  invalidProposalChangeSetOutputSchema,
} from './proposal-group-tool.schemas';

// ---------------------------------------------------------------------------
// Work-item-type authoring surface. The tool's input schema *is* the
// WorkItemTypeDefinitionDto contract — there is no separate structured-output
// schema, so the spec shape and the server-side check at submit time are the
// only authority. Each leaf schema is pinned with `satisfies z.ZodType<...>`
// against its generated DTO so a spec/codegen drift fails to compile here
// rather than silently accepting a payload the registry will reject. The
// enum-typed fields read `z.nativeEnum` off the generated const enums, so an
// added or removed enum value shifts the inferred type automatically.
// ---------------------------------------------------------------------------

const workItemTypeSectionDefinitionSchema = z
  .object({
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
      .array(
        z.object({
          key: z.string().min(1),
          label: z.string().min(1),
          breakpoints: z
            .array(
              z.object({
                minContainerWidth: z.number().int().min(0),
                inline: z.object({
                  width: z.number().int().positive(),
                  height: z.number().int().positive(),
                }),
                page: z.object({
                  width: z.number().int().positive(),
                  height: z.number().int().positive(),
                }),
              }),
            )
            .min(1),
        }),
      )
      .min(1)
      .optional()
      .describe(
        'Named definition-owned HTML/CSS or structured-mockup presentation profiles; item content selects only a sizeKey.',
      ),
    defaultSizeKey: z
      .string()
      .min(1)
      .optional()
      .describe('Profile used when mockup content omits sizeKey.'),
  })
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
    if (!isSourceSection && hasSizing)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'size profiles are supported only for html/css and structured-mockup sections',
      });
    if (isSourceSection && hasSizing) {
      const keys = section.sizeProfiles?.map(({ key }) => key) ?? [];
      if (
        !section.sizeProfiles ||
        !section.defaultSizeKey ||
        !keys.includes(section.defaultSizeKey)
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'sizeProfiles and a matching defaultSizeKey are required together',
        });
      if (new Set(keys).size !== keys.length)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'size profile keys must be unique',
        });
      section.sizeProfiles?.forEach((profile, index) => {
        if (
          profile.breakpoints[0]?.minContainerWidth !== 0 ||
          profile.breakpoints.some(
            (point, breakpointIndex, points) =>
              breakpointIndex > 0 &&
              point.minContainerWidth <=
                (points[breakpointIndex - 1]?.minContainerWidth ?? -1),
          )
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['sizeProfiles', index, 'breakpoints'],
            message: 'breakpoints must begin at 0 and be strictly ascending',
          });
      });
    }
  }) satisfies z.ZodType<WorkItemTypeSectionDefinition>;

// requiredScalars/forbiddenScalars name fields from this closed set;
// membership says whether the field is mandatory or rejected on the type.
const workItemTypeScalarFieldSchema = z
  .nativeEnum(WorkItemTypeScalarField)
  .describe(
    'A scalar field an item may carry beyond its content sections (one of ' +
      'the closed WorkItemTypeScalarField set).',
  ) satisfies z.ZodType<WorkItemTypeScalarField>;

const workItemTypeEdgeTargetSchema = z.object({
  edgeType: z
    .nativeEnum(AgentEdgeType)
    .describe('The typed edge an item of this type may originate.'),
  targetTypeKeys: z
    .array(z.string())
    .describe(
      'Type keys this edge may point at. An empty array means the edge type ' +
        'is permitted against any type.',
    ),
}) satisfies z.ZodType<WorkItemTypeEdgeTarget>;

const workItemTypeGraphEndpointRoleSchema = z.enum([
  'graphRoot',
  'graphNode',
  'externalEntity',
]);

const workItemTypeGraphEndpointRuleSchema = z.object({
  role: workItemTypeGraphEndpointRoleSchema.describe(
    'Endpoint role relative to the graph surface.',
  ),
  entityTypes: z
    .array(z.nativeEnum(AgentEdgeEndpointEntityType))
    .describe('Entity types allowed for this endpoint.'),
  workItemTypeKeys: z
    .array(z.string())
    .optional()
    .describe(
      'Work-item type keys allowed when the endpoint entity type is TASK.',
    ),
});

const workItemTypeGraphDirectionRuleSchema = z.object({
  required: z.boolean().optional(),
  allowedDirections: z.array(z.nativeEnum(AgentEdgeDirection)).optional(),
  predicateRequired: z.boolean().optional(),
});

const workItemTypeGraphRelationshipDeclarationSchema = z.object({
  edgeType: z
    .nativeEnum(AgentEdgeType)
    .describe('Relationship label visible to the graph reader or editor.'),
  category: z
    .nativeEnum(AgentEdgeCategory)
    .describe('Whether this relationship is flow structure or meta topology.'),
  sourceEndpoint: workItemTypeGraphEndpointRuleSchema,
  targetEndpoint: workItemTypeGraphEndpointRuleSchema,
  direction: workItemTypeGraphDirectionRuleSchema.optional(),
  metadataSchemaRef: z.string().nullable().optional(),
});

const workItemTypeGraphSearchableMetaLinkTargetSchema = z.object({
  edgeType: z.nativeEnum(AgentEdgeType),
  targetEntityTypes: z.array(z.nativeEnum(AgentEdgeEndpointEntityType)),
  targetWorkItemTypeKeys: z.array(z.string()).optional(),
});

const workItemTypeGraphActionSchema = z.enum([
  'viewGraph',
  'createNode',
  'updateNode',
  'deleteNode',
  'createRelationship',
  'updateRelationship',
  'reconnectRelationship',
  'deleteRelationship',
  'replaceLayout',
  'clearLayout',
]);

const workItemTypeGraphCapabilitySchema = z.object({
  nodeChildType: z
    .string()
    .describe('Child work-item type key eligible to act as a graph node.'),
  layout: z
    .object({
      sectionKey: z.string(),
      schemaRef: z.string(),
    })
    .describe('Type-owned JSON section that stores authored logical layout.'),
  layoutPreference: z
    .object({
      sectionKey: z.string(),
      schemaRef: z.string(),
    })
    .describe('Type-owned JSON section that stores the preferred graph shape.'),
  groups: z
    .object({
      sectionKey: z.string(),
      schemaRef: z.string(),
    })
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
  supportedActions: z.array(workItemTypeGraphActionSchema),
});

const workItemTypeCapabilitiesSchema = z
  .object({
    requiresParent: z.boolean().optional(),
    planEligible: z.boolean().optional(),
    hasSetInitialStatus: z.boolean().optional(),
    rendersInline: z.boolean().optional(),
    showsInExplorerSidebar: z.boolean().optional(),
    graph: workItemTypeGraphCapabilitySchema.optional(),
  })
  .strict();

export const CREATE_WORK_ITEM_TYPE_CAPABILITY_AXES = Object.freeze(
  Object.keys(workItemTypeCapabilitiesSchema.shape),
);

export const WORK_ITEM_TYPE_PARENTAGE_GUIDANCE =
  'List work-item type keys such as STANDARD in allowedParentTypes. When this ' +
  'list is non-empty, TASK is added to allowedParentEntityTypes automatically; ' +
  'an empty list keeps the type top-level unless another entity parent is explicitly allowed.';

export const createWorkItemTypeParameters = z
  .object({
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
    allowedStatuses: z
      .array(z.nativeEnum(WorkStatus))
      .describe(
        'The work statuses an item of this type may occupy. Reuses the shared ' +
          'WorkStatus enum rather than declaring a type-local status set.',
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
      .optional()
      .describe(
        'Dedicated inbound TRACKS policy: which entity types and work-item ' +
          'type keys may track this target type.',
      ),
    agentSettableStatuses: z
      .array(z.nativeEnum(WorkStatus))
      .optional()
      .describe(
        'Subset of allowedStatuses that agents may set directly; other statuses ' +
          'remain reserved for system transitions.',
      ),
    anchorableReportTypes: z
      .array(z.nativeEnum(ReportType))
      .optional()
      .describe('Report types that may be anchored to an item of this type.'),
    agentGuidance: workItemTypeAgentGuidanceSchema.optional(),
    maintenanceGuidance: z.string().optional(),
    writingStandards: z
      .object({
        create: z.string(),
        edit: z.string(),
      })
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
  })
  .strict() satisfies z.ZodType<WorkItemTypeDefinitionDto>;

export const CREATE_WORK_ITEM_TYPE_AUTHORING_AXES = Object.freeze(
  Object.keys(createWorkItemTypeParameters.shape),
);

export const editWorkItemTypeParameters = z
  .object({
    typeKey: z
      .string()
      .min(1)
      .describe(
        'Stable key of the active project-owned type to edit. This may be a ' +
          'canonical-seeded project override or a project-defined custom type.',
      ),
    definition: createWorkItemTypeParameters.describe(
      'Complete replacement definition submitted for bounded-edit classification.',
    ),
    acknowledgeCanonicalCustomization: z
      .boolean()
      .optional()
      .describe(
        'Must be true when editing a CANONICAL definition creates a project override.',
      ),
  })
  .strict();

export const createWorkItemTypeOutput = z.object({
  proposalId: z.string().describe('Persisted proposal ID'),
  action: z
    .string()
    .describe(
      'Proposal action (CREATE for both new definitions and retained-row ' +
        'restoration; targetEntityId distinguishes the two).',
    ),
  targetEntityType: z.string().describe('Target entity type (WORK_ITEM_TYPE)'),
  targetEntityId: z
    .string()
    .describe(
      'Nil UUID placeholder for a new CREATE proposal, or the retained ' +
        'work-item type key for a restoration CREATE proposal.',
    ),
  createdAt: z.string().describe('When the proposal was created'),
});

const createWorkItemTypeResultOutput = z.union([
  invalidProposalChangeSetOutputSchema,
  createWorkItemTypeOutput,
]);

type CreateWorkItemTypeOutput = z.infer<typeof createWorkItemTypeResultOutput>;

export const editWorkItemTypeOutput = z.object({
  proposalId: z.string().describe('Persisted proposal ID'),
  action: z.string().describe('Proposal action (UPDATE)'),
  targetEntityType: z.string().describe('Target entity type (WORK_ITEM_TYPE)'),
  targetEntityId: z
    .string()
    .describe('Stable work-item type key targeted by the UPDATE proposal.'),
  createdAt: z.string().describe('When the proposal was created'),
});

const editWorkItemTypeResultOutput = z.union([
  invalidProposalChangeSetOutputSchema,
  editWorkItemTypeOutput,
]);

type EditWorkItemTypeOutput = z.infer<typeof editWorkItemTypeResultOutput>;

export const EDIT_WORK_ITEM_TYPE_TOOL_DESCRIPTION =
  'After calling get_work_item_type, propose a bounded edit to an active ' +
  'project-owned work-item type (CANONICAL, CANONICAL_OVERRIDE, or PROJECT_CUSTOM). Submit ' +
  'the complete definition and preserve every unchanged definition axis for ' +
  'user review. For a canonical-seeded type, approval creates or updates a ' +
  'complete project override over the immutable global canonical definition; ' +
  'it does not mutate the global seed. ' +
  WORK_ITEM_TYPE_PARENTAGE_GUIDANCE;

@Injectable()
export class WorkItemTypeProposalToolsProvider {
  private readonly logger = new Logger(WorkItemTypeProposalToolsProvider.name);

  constructor(
    private readonly proposalService: ProposalService,
    private readonly adminGuard: AdminGuard,
    @Optional()
    private readonly workItemTypeRegistry?: WorkItemTypeRegistryService,
  ) {}

  @Tool({
    name: PROPOSAL_TOOL_NAMES.CREATE_WORK_ITEM_TYPE,
    description: CREATE_WORK_ITEM_TYPE_TOOL_DESCRIPTION,
    parameters: createWorkItemTypeParameters,
    outputSchema: createWorkItemTypeResultOutput,
  })
  async createWorkItemType(
    params: z.infer<typeof createWorkItemTypeParameters>,
    _context: Context,
    request: Request,
  ): Promise<CreateWorkItemTypeOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const conversationId = request.headers['x-conversation-id'] as
      | string
      | undefined;
    const projectId = request.headers['x-project-id'] as string | undefined;

    if (!projectId) {
      return mcpError(
        'Missing project context. Ensure X-Project-ID header is set.',
      );
    }

    // The validated params object IS the WorkItemTypeDefinitionDto — the
    // submit tool's input schema is the contract — so it serializes directly
    // into the proposal's `updates`.
    const definition: WorkItemTypeDefinitionDto = params;

    if (
      !this.adminGuard.isPlatformAdmin({
        user: auth.user,
        socket: request.socket,
        headers: request.headers,
      }) &&
      definition.sections.some(
        (section) => section.schemaRef === IMAGE_SECTION_CONTENT_SCHEMA_REF,
      )
    ) {
      return mcpError('Image sections are restricted to platform admins.');
    }

    const requestorContext = extractRequestorContext(
      auth,
      request,
      PROPOSAL_TOOL_NAMES.CREATE_WORK_ITEM_TYPE,
      conversationId,
    );

    const provenance = buildProvenanceEnvelope(requestorContext, undefined);

    const retained = this.workItemTypeRegistry?.getDefinition(
      projectId,
      definition.key,
    );
    const dto =
      retained?.status === WorkItemTypeLifecycleStatus.Archived
        ? buildWorkItemTypeRestoreProposal({
            typeKey: definition.key,
            definition,
            requestorContext,
            influences: provenance.influences,
            conversationId,
          })
        : buildWorkItemTypeCreateProposal({
            definition,
            requestorContext,
            influences: provenance.influences,
            conversationId,
          });

    try {
      const proposal = await this.proposalService.create(
        auth.organizationId,
        projectId as ProjectId,
        auth.user.userId,
        dto,
      );

      this.logger.log(
        `create_work_item_type proposal created: ${proposal.id} ` +
          `(type key ${definition.key}) for project ${projectId}`,
      );

      return {
        proposalId: proposal.id,
        action: proposal.action,
        targetEntityType: proposal.targetEntityType,
        targetEntityId: proposal.targetEntityId,
        createdAt: proposal.createdAt,
      };
    } catch (error: unknown) {
      const invalidChangeSet = invalidProposalChangeSetFromError(error);
      if (invalidChangeSet) return invalidChangeSet;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`create_work_item_type failed: ${message}`);
      return mcpError(message);
    }
  }

  @Tool({
    name: PROPOSAL_TOOL_NAMES.EDIT_WORK_ITEM_TYPE,
    description: EDIT_WORK_ITEM_TYPE_TOOL_DESCRIPTION,
    parameters: editWorkItemTypeParameters,
    outputSchema: editWorkItemTypeResultOutput,
  })
  async editWorkItemType(
    params: z.infer<typeof editWorkItemTypeParameters>,
    _context: Context,
    request: Request,
  ): Promise<EditWorkItemTypeOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    if (
      !this.adminGuard.isPlatformAdmin({
        user: auth.user,
        socket: request.socket,
        headers: request.headers,
      }) &&
      params.definition.sections.some(
        (section) => section.schemaRef === IMAGE_SECTION_CONTENT_SCHEMA_REF,
      )
    ) {
      return mcpError('Image sections are restricted to platform admins.');
    }

    const conversationId = request.headers['x-conversation-id'] as
      | string
      | undefined;
    const projectId = request.headers['x-project-id'] as string | undefined;

    if (!projectId) {
      return mcpError(
        'Missing project context. Ensure X-Project-ID header is set.',
      );
    }

    try {
      const existing = this.workItemTypeRegistry?.getDefinition(
        projectId,
        params.typeKey,
      );
      if (!existing) {
        throw new NotFoundException(
          `Work-item type '${params.typeKey}' is not available in this project.`,
        );
      }
      if (existing.projectId !== projectId) {
        throw new NotFoundException(
          `Work-item type '${params.typeKey}' is not available in this project.`,
        );
      }
      if (
        existing.effectiveSource === WorkItemTypeEffectiveSource.Canonical &&
        params.acknowledgeCanonicalCustomization !== true
      ) {
        throw new ForbiddenException(
          `Canonical customization acknowledgement is required for work-item type '${params.typeKey}'.`,
        );
      }
      if (
        existing.effectiveSource !== WorkItemTypeEffectiveSource.Canonical &&
        existing.effectiveSource !==
          WorkItemTypeEffectiveSource.ProjectCustom &&
        existing.effectiveSource !==
          WorkItemTypeEffectiveSource.CanonicalOverride
      ) {
        throw new ForbiddenException(
          `Work-item type '${params.typeKey}' cannot be edited by this tool.`,
        );
      }
      if (existing.status !== WorkItemTypeLifecycleStatus.Active) {
        throw new ForbiddenException(
          `Work-item type '${params.typeKey}' is not active in this project.`,
        );
      }

      assertWorkItemTypeEditSupported(existing, params.definition);

      const requestorContext = extractRequestorContext(
        auth,
        request,
        PROPOSAL_TOOL_NAMES.EDIT_WORK_ITEM_TYPE,
        conversationId,
      );
      const provenance = buildProvenanceEnvelope(requestorContext, undefined);
      const dto = buildWorkItemTypeEditProposal({
        typeKey: params.typeKey,
        definition: params.definition,
        requestorContext,
        influences: provenance.influences,
        conversationId,
        acknowledgeCanonicalCustomization:
          params.acknowledgeCanonicalCustomization,
      });
      const proposal = await this.proposalService.create(
        auth.organizationId,
        projectId as ProjectId,
        auth.user.userId,
        dto,
      );

      this.logger.log(
        `edit_work_item_type proposal created: ${proposal.id} ` +
          `(type key ${params.typeKey}) for project ${projectId}`,
      );

      return {
        proposalId: proposal.id,
        action: proposal.action,
        targetEntityType: proposal.targetEntityType,
        targetEntityId: proposal.targetEntityId,
        createdAt: proposal.createdAt,
      };
    } catch (error: unknown) {
      const invalidChangeSet = invalidProposalChangeSetFromError(error);
      if (invalidChangeSet) return invalidChangeSet;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`edit_work_item_type failed: ${message}`);
      return mcpError(message);
    }
  }
}
