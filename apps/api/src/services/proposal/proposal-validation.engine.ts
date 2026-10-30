import { ProposalReconciliationService } from './proposal-reconciliation.service';
import { Inject } from '@nestjs/common';
import { sectionContent } from './future-application';
import { rootChildrenView } from './work-item-change-set-projector.service';
import { isEqual } from 'lodash';
import {
  assertFutureGraphBoundary,
  futureGraph,
  graphChangeSet,
} from './future-graph';
import type { ProjectModeSettings } from '../../generated';
import {
  findIneligibleProjectModeTypeKeys,
  PROJECT_MODE_SETTINGS_SCHEMA_REF,
} from '../tasks/project-mode-settings.validator';
import { workItemTypeSessionRoleGuidanceSchema } from '../tasks/work-item-type-agent-guidance.schema';
import {
  parseFutureRevisionMutation,
  lockFutureForMutation,
  validateFutureRevision,
} from './future-revision';
import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { PrismaService, AnyTransactionClient } from 'src/prisma/prisma.service';
import type {
  CreateProposalDto,
  CreateProposalRequestDto,
  CreateTaskDto,
  UpdateTaskDto,
  CreateDesignDocDto,
  UpdateDesignDocDto,
  TaskSectionInput,
  WorkflowProposalLinkInput,
  WorkflowProposalStepInput,
  EntityPromptTemplateProposalUpdatesPayload,
  EntityPromptTemplateRetireUpdatesPayload,
  EntityPromptTemplateUpsertUpdatesPayload,
  CreatePlanFromDesignDocConversationContext,
  Influence,
  ProposalEdgeDeclaration,
  ProjectedWorkItem,
  WorkItemChangeSetIdentity,
} from 'src/generated';
import type { OrganizationId, ProjectId, TaskId } from 'src/types';
import { featureTagSchema } from 'src/types/feature-tag.types';
import type {
  ProposalValidationIssue,
  ProposalValidationResult,
  ProposalValidationContext,
  SingleProposalValidationResult,
  ValidateProposalsInput,
  ValidateProposalAuthoringCandidatesInput,
} from './proposal-validation.types';
import { evaluateSupersedeInvariant } from './supersede-invariant';

import { WorkStatus } from '../../generated/model/workStatus';
import { AgentEdgeType } from '../../generated/model/agentEdgeType';
import { WorkItemTypeScalarField } from '../../generated/model/workItemTypeScalarField';
import { WorkItemTypeLifecycleStatus } from '../../generated/model/workItemTypeLifecycleStatus';
import { WorkItemColorKey } from '../../generated/model/workItemColorKey';
import { WorkItemIconKey } from '../../generated/model/workItemIconKey';
import { WorkItemConfigKind } from '../../generated/model/workItemConfigKind';
import type { WorkItemTypeDefinitionDto } from '../../generated/model/workItemTypeDefinitionDto';
import { WorkItemTypeRole } from '../../generated/model/workItemTypeRole';
import { WorkItemTypeCascadeDeleteUpdatesPayload } from '../../generated/model/workItemTypeCascadeDeleteUpdatesPayload';
import { WorkItemTypeSectionDefinition } from '../../generated/model/workItemTypeSectionDefinition';
import type { WorkItemTypeEdgeTarget } from '../../generated/model/workItemTypeEdgeTarget';
import { EntityType } from '../../generated/model/entityType';
import { ReportType } from '../../generated/model/reportType';
import { ProposalEdgeTargetType } from '../../generated/model/proposalEdgeTargetType';
import { ProposalEdgeEndpointMode } from '../../generated/model/proposalEdgeEndpointMode';
import { ProposalEdgeType } from '../../generated/model/proposalEdgeType';
import { WorkflowName } from '../../generated/model/workflowName';
import { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';
import {
  isWorkItemServiceScopeEligible,
  WORK_ITEM_SERVICE_SCOPE_INVALID_REASON,
  WORK_ITEM_SERVICE_SCOPE_INVALID_SUGGESTION,
} from '../tasks/work-item-service-scope-policy';
import { formatWorkItemStatusNotAllowedMessage } from '../tasks/work-item-status-policy';
import { WorkItemParentageValidator } from '../tasks/work-item-parentage-validator.service';
import {
  validateWorkItemConfigForType,
  workItemConfigSchema,
} from '../tasks/work-item-config';
import {
  resolveWorkItemSectionContentKind,
  TaskSectionSchemaValidatorRegistry,
} from '../tasks/task-section-schema-validator.registry';
import { workItemTypeCapabilitiesSchema } from '../tasks/work-item-type-capabilities.schema';
import { classifyWorkItemTypeEdit } from './work-item-type-edit-classifier';
import { extractMentions } from '../../utils/mentionFormatting';
import {
  storeTracksAttachmentAsProposalEdge,
  assertCreateWorkItemTracksAttachmentValid,
} from './proposal-tracking-attachment';
import { workflowProposalLinkInputSchema } from './workflow-proposal-link.schema';
import {
  workItemChangeSetIdentitySchema,
  workItemChangeSetValidationRequestSchema,
} from './work-item-change-set.schema';
import {
  sourceRefView,
  WorkItemChangeSetProjectorService,
  type PlanStageProposalCandidate,
} from './work-item-change-set-projector.service';
import { NIL_UUID } from './work-item-type-proposal.builder';
import { FeatureRequirementAuthoringService } from '../tasks/feature-requirement-authoring.service';
import {
  loadProposalReferenceMetadata,
  collectProposalReferences,
  type ProposalReferenceMetadata,
  proposalReferenceKey,
  validateProposalEdgeTargetsResolvable,
} from './proposal-title-snapshot';
import {
  featureRequirementInputSchema,
  featureRequirementOperationSchema,
} from '../tasks/feature-requirement-authoring.schemas';
import {
  entityPromptTemplateProposalUpdatesSchema,
  entityPromptTemplateRetireUpdatesSchema,
  entityPromptTemplateUpsertUpdatesSchema,
} from '../entity-prompt-template.contract';

// Evidence owns an isolated candidate consumed by subsequent validation.
// The public candidate is a detached copy: editing it produces ordinary input
// requiring admission again, never a mutated candidate with stale evidence.
const admittedCandidate = Symbol('admitted proposal candidate');
export type AdmittedProposalCandidate<
  TProposal extends CreateProposalRequestDto = CreateProposalRequestDto,
> = {
  readonly [admittedCandidate]: TProposal;
  readonly candidate: TProposal;
};
export type ProposalAuthoringAdmission<
  TProposal extends CreateProposalRequestDto = CreateProposalRequestDto,
> = {
  candidates: AdmittedProposalCandidate<TProposal>[];
  metadata: ProposalReferenceMetadata;
};

// ─── Structural schemas ────────────────────────────────────────────

const proposalTypeSchema = z.enum(['SINGLE', 'BATCH']);
const proposalActionSchema = z.enum([
  'CREATE',
  'UPDATE',
  'DELETE',
  'VERSIONED_UPDATE',
]);
const targetEntityTypeSchema = z.enum([
  'TASK',
  'DESIGN_DOC',
  'CONVERSATION',
  'WORK_ITEM_TYPE',
  'ENTITY_PROMPT_TEMPLATE',
]);

const proposalEdgeDeclarationSchema: z.ZodType<ProposalEdgeDeclaration> = z
  .object({
    endpointMode: z.nativeEnum(ProposalEdgeEndpointMode).optional(),
    sourceRef: workItemChangeSetIdentitySchema.optional(),
    targetEntityId: z.string().uuid(),
    targetEntityType: z.nativeEnum(ProposalEdgeTargetType),
    targetEntityTitle: z.string().nullable().optional(),
    edgeType: z.nativeEnum(ProposalEdgeType),
    description: z.string().optional(),
  })
  .strict()
  .superRefine((edge, ctx) => {
    if (
      edge.sourceRef !== undefined &&
      edge.targetEntityType !== ProposalEdgeTargetType.Proposal
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceRef'],
        message: 'sourceRef is valid only when targetEntityType is PROPOSAL',
      });
    }
    if (
      edge.sourceRef !== undefined &&
      edge.endpointMode === ProposalEdgeEndpointMode.Proposal
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceRef'],
        message: 'sourceRef is only valid for deferred ENTITY-mode links',
      });
    }
    if (
      edge.endpointMode === ProposalEdgeEndpointMode.Proposal &&
      edge.targetEntityType !== ProposalEdgeTargetType.Proposal
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetEntityType'],
        message: 'endpointMode PROPOSAL requires targetEntityType PROPOSAL',
      });
    }
  });

type TaskParentageCheckIssue = {
  code: 'entity_not_found' | 'invalid_placement' | 'unrecognized_type';
  reason: string;
  suggestion?: string;
};

type TaskParentageCheckResult = {
  issue: TaskParentageCheckIssue | null;
  childType?: string;
  currentParentTaskId?: string | null;
};

type ReferentialValidationContext = Pick<
  ProposalValidationContext,
  'organizationId' | 'projectId' | 'group'
>;

type JsonSectionContent =
  | string
  | number
  | boolean
  | null
  | JsonSectionContent[]
  | { [key: string]: JsonSectionContent };

const jsonSectionContentSchema: z.ZodType<JsonSectionContent> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSectionContentSchema),
    z.record(jsonSectionContentSchema),
  ]),
);

const taskSectionSchema: z.ZodType<TaskSectionInput> = z.object({
  key: z.string().min(1),
  content: jsonSectionContentSchema,
  order: z.number().int().optional(),
});

// Work-item `type` recognition is enforced at the referential layer against
// the live registry (see validateWorkItemType), not pinned to a literal set
// here: GOAL and project-custom types are valid strings the registry knows
// about but a hardcoded enum — or the generated WorkItemTypeKey union — would reject.
// Structurally we only require a non-empty string; the cast keeps the inferred
// type aligned with the DTO's WorkItemTypeKey field for the compile-time drift checks.
const workItemTypeFieldSchema = z
  .string()
  .min(1) as unknown as z.ZodType<WorkItemTypeKey>;

const workflowProposalStepInputSchema = z
  .object({
    tempId: z.string().min(1),
    name: z.string().min(1),
    sections: z.array(taskSectionSchema).optional(),
    status: z.nativeEnum(WorkStatus).optional(),
    source: z.enum(['system', 'user', 'agent']).optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    dueDate: z.string().datetime().optional(),
    assigneeId: z.string().uuid().optional(),
    serviceId: z.string().uuid().optional(),
  })
  .strict();

const createTaskUpdatesSchema = z
  .object({
    name: z.string().min(1),
    initiativeId: z.string().uuid().optional(),
    sections: z.array(taskSectionSchema).optional(),
    status: z.nativeEnum(WorkStatus).optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    dueDate: z.string().datetime().optional(),
    assigneeId: z.string().uuid().optional(),
    parentTaskId: z.string().uuid().optional(),
    serviceIds: z.array(z.string().uuid()).optional(),
    type: workItemTypeFieldSchema,
    tag: featureTagSchema.optional(),
    config: workItemConfigSchema.nullable().optional(),
    initialRequirements: z.array(featureRequirementInputSchema).optional(),
    workflowSteps: z.array(workflowProposalStepInputSchema).optional(),
    workflowLinks: z.array(workflowProposalLinkInputSchema).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.type === 'FEATURE' && data.tag === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tag'],
        message: 'tag is required when creating a FEATURE task',
      });
    }
    if (data.type !== 'FEATURE' && data.tag !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tag'],
        message: 'tag is only valid on FEATURE tasks',
      });
    }
    if (data.type !== 'FEATURE' && data.initialRequirements !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['initialRequirements'],
        message: 'initialRequirements is only valid on FEATURE tasks',
      });
    }
    validateWorkflowProposalPayload(data, ctx);
  });

const updateTaskUpdatesSchema = z
  .object({
    name: z.string().min(1).optional(),
    sections: z.array(taskSectionSchema).optional(),
    initiativeId: z.string().uuid().optional(),
    // SUPERSEDED is accepted by the schema but gated by the supersede
    // invariant in validateStructure: a direct status edit without the legacy
    // transition pairing is rejected before this enum parse runs.
    status: z.nativeEnum(WorkStatus).optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    dueDate: z.string().datetime().optional(),
    assigneeId: z.string().uuid().optional(),
    parentTaskId: z.string().uuid().nullable().optional(),
    type: workItemTypeFieldSchema.optional(),
    tag: featureTagSchema.optional(),
    requirementOps: z.array(featureRequirementOperationSchema).optional(),
    sectionUpdateSource: z.enum(['USER', 'AGENT_SUGGESTED']).optional(),
    serviceIds: z.array(z.string().uuid()).optional(),
  })
  .strict();

const designDocTemplateSchema = z.enum([
  'CLASSIC',
  'ADR',
  'RFC',
  'BRAINSTORM',
  'DECISION',
  'PLAN_DOCUMENT',
]);

const designDocSectionSchema = z.object({
  id: z.string().optional(),
  key: z.string(),
  order: z.number().int().nullable(),
  content: z.string().optional(),
});

const createDesignDocUpdatesSchema = z
  .object({
    name: z.string().min(1),
    template: designDocTemplateSchema.optional(),
    status: z.string().optional(),
    sections: z.array(designDocSectionSchema).optional(),
    projectId: z.string().uuid().optional(),
    tags: z.array(z.string()).optional(),
    summary: z.string().nullable().optional(),
    parentEntityId: z.string().uuid().nullable().optional(),
    parentEntityType: z.enum(['TASK', 'DESIGN_DOC']).nullable().optional(),
  })
  .passthrough();

const updateDesignDocUpdatesSchema = z
  .object({
    name: z.string().min(1).optional(),
    template: designDocTemplateSchema.optional(),
    status: z.string().optional(),
    sections: z.array(designDocSectionSchema).optional(),
    projectId: z.string().uuid().optional(),
    tags: z.array(z.string()).optional(),
    summary: z.string().nullable().optional(),
    parentEntityId: z.string().uuid().nullable().optional(),
    parentEntityType: z.enum(['TASK', 'DESIGN_DOC']).nullable().optional(),
    sectionUpdateSource: z.enum(['USER', 'AGENT_SUGGESTED']).optional(),
  })
  .passthrough()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one update field is required',
  });

const deleteUpdatesSchema = z.object({}).strict();

function validateWorkflowProposalPayload(
  data: {
    type?: WorkItemTypeKey;
    workflowSteps?: WorkflowProposalStepInput[];
    workflowLinks?: WorkflowProposalLinkInput[];
  },
  ctx: z.RefinementCtx,
): void {
  if (
    data.type !== 'workflow' &&
    (data.workflowSteps !== undefined || data.workflowLinks !== undefined)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workflowSteps'],
      message:
        'workflowSteps and workflowLinks are only valid when creating a workflow work item',
    });
    return;
  }

  const stepIds = new Set<string>();
  for (const [index, step] of (data.workflowSteps ?? []).entries()) {
    if (stepIds.has(step.tempId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workflowSteps', index, 'tempId'],
        message: `Duplicate workflow step tempId '${step.tempId}'`,
      });
    }
    stepIds.add(step.tempId);
  }

  for (const [index, link] of (data.workflowLinks ?? []).entries()) {
    if (!stepIds.has(link.sourceStepTempId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workflowLinks', index, 'sourceStepTempId'],
        message: `Unknown workflow step tempId '${link.sourceStepTempId}'`,
      });
    }

    if (link.type === 'STANDARD' || link.type === 'CONDITIONAL') {
      if (!stepIds.has(link.targetStepTempId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['workflowLinks', index, 'targetStepTempId'],
          message: `Unknown workflow step tempId '${link.targetStepTempId}'`,
        });
      }
    }

    if (link.type === 'LOOP') {
      if (link.targetStepTempId && !stepIds.has(link.targetStepTempId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['workflowLinks', index, 'targetStepTempId'],
          message: `Unknown workflow step tempId '${link.targetStepTempId}'`,
        });
      }
    }

    if (link.type === 'FULFILLED_BY') {
      continue;
    }
  }
}

// ─── Work-item-type schemas ────────────────────────────────────────
// A WORK_ITEM_TYPE proposal is always a CREATE whose `updates` is the
// serialized WorkItemTypeDefinitionDto authored by the create_work_item_type
// submit tool. These schemas mirror that DTO so an ill-formed or
// self-contradictory definition is rejected structurally at submit time,
// before it can reach review or apply. The enum-typed axes read off the
// generated const enums (z.nativeEnum), so an added or removed enum member
// shifts the inferred type automatically; the _Extends drift checks below
// keep the inferred shape pinned to the DTO.

const workItemTypeSectionSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    required: z.boolean().optional(),
    writingStandard: z.string().nullable().optional(),
    kind: z.nativeEnum(WorkItemTypeSectionDefinition.KindEnum).optional(),
    schemaRef: z.string().nullable().optional(),
    sizeProfiles: z
      .array(
        z
          .object({
            key: z.string().min(1),
            label: z.string().min(1),
            breakpoints: z
              .array(
                z
                  .object({
                    minContainerWidth: z.number().int().min(0),
                    inline: z
                      .object({
                        width: z.number().int().positive(),
                        height: z.number().int().positive(),
                      })
                      .strict(),
                    page: z
                      .object({
                        width: z.number().int().positive(),
                        height: z.number().int().positive(),
                      })
                      .strict(),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1)
      .optional(),
    defaultSizeKey: z.string().min(1).optional(),
  })
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
    if (isSourceSection && hasSizing) {
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
      if (new Set(keys).size !== keys.length)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'size profile keys must be unique',
        });
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
    }
  });

// requiredScalars/forbiddenScalars are arrays over this closed field set —
// membership names whether the field is mandatory or rejected on the type,
// not a freeform per-scalar builder.
const workItemTypeScalarFieldSchema = z.nativeEnum(WorkItemTypeScalarField);

const workItemTypeEdgeTargetSchema = z
  .object({
    edgeType: z.nativeEnum(AgentEdgeType),
    targetTypeKeys: z.array(z.string()),
  })
  .strict();

const workItemTypeTrackingSchema = z
  .object({
    allowedSourceEntityTypes: z.array(z.nativeEnum(EntityType)),
    allowedSourceTaskTypes: z.array(z.string()),
  })
  .strict();

const workItemTypeWritingStandardsSchema = z
  .object({
    create: z.string(),
    edit: z.string(),
  })
  .strict();

const createWorkItemTypeUpdatesSchema = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1),
    role: z.nativeEnum(WorkItemTypeRole),
    acceptedConfigKinds: z.array(z.nativeEnum(WorkItemConfigKind)).optional(),
    colorKey: z.nativeEnum(WorkItemColorKey).optional(),
    iconKey: z.nativeEnum(WorkItemIconKey).optional(),
    description: z.string().nullable().optional(),
    sections: z.array(workItemTypeSectionSchema),
    requiredScalars: z.array(workItemTypeScalarFieldSchema).optional(),
    forbiddenScalars: z.array(workItemTypeScalarFieldSchema).optional(),
    // The DTO carries no explicit initial-status field: a type's initial
    // status is later derived from the statuses it may occupy. A definition
    // with zero allowed statuses therefore has no coherent initial-status
    // policy — there is nothing an item of the type could ever start in — so
    // a non-empty allowedStatuses is the structural coherence check here.
    allowedStatuses: z.array(z.nativeEnum(WorkStatus)).min(1, {
      message:
        'allowedStatuses must list at least one status the type can occupy',
    }),
    allowedParentTypes: z.array(z.string()).optional(),
    edgeTargets: z.array(workItemTypeEdgeTargetSchema).optional(),
    allowedParentEntityTypes: z.array(z.nativeEnum(EntityType)).optional(),
    tracking: workItemTypeTrackingSchema.optional(),
    agentSettableStatuses: z.array(z.nativeEnum(WorkStatus)).optional(),
    anchorableReportTypes: z.array(z.nativeEnum(ReportType)).optional(),
    maintenanceGuidance: z.string().optional(),
    sessionRoleGuidance: workItemTypeSessionRoleGuidanceSchema.optional(),
    writingStandards: workItemTypeWritingStandardsSchema.nullable().optional(),
    capabilities: workItemTypeCapabilitiesSchema.optional(),
  })
  .strict();

const editWorkItemTypeUpdatesSchema = z
  .object({
    definition: createWorkItemTypeUpdatesSchema,
    acknowledgeCanonicalCustomization: z.boolean().optional(),
  })
  .strict();
const resetWorkItemTypeUpdatesSchema = z
  .object({ resetToCanonical: z.literal('RESET_TO_CANONICAL') })
  .strict();

const archiveWorkItemTypeUpdatesSchema = z
  .object({
    reason: z.string().nullable().optional(),
    acknowledgeCanonicalCustomization: z.boolean().optional(),
  })
  .strict();

const cascadeDeleteWorkItemTypeUpdatesSchema = z
  .object({
    operation: z.literal(
      WorkItemTypeCascadeDeleteUpdatesPayload.OperationEnum.CascadeDelete,
    ),
    cascade: z.literal(true),
    typeKey: z.string(),
    itemCount: z.number().int().min(0),
    edgeCount: z.number().int().min(0),
  })
  .strict();

const workItemTypeDeleteUpdatesSchema = z
  .unknown()
  .superRefine((updates, ctx) => {
    const schema = isCascadeWorkItemTypeDeletePayload(updates)
      ? cascadeDeleteWorkItemTypeUpdatesSchema
      : archiveWorkItemTypeUpdatesSchema;
    const result = schema.safeParse(updates);
    if (!result.success) {
      result.error.issues.forEach((issue) => ctx.addIssue(issue));
    }
  });

// create_plan persists the OpenAPI plan-from-design-doc conversation context
// directly in proposal updates, with the workflow discriminator alongside it.
// The provider requires parentFeatureId because the proposal enactor cannot
// materialize a new plan without its owning feature.
const planFromDesignDocConversationUpdatesSchema = z
  .object({
    designDocMarkdown: z.string().min(1),
    planTitle: z.string().min(1),
    parentFeatureId: z.string().uuid(),
    workflowName: z.literal(WorkflowName.PlanFromDesignDoc),
  })
  .strict();

export function isCascadeWorkItemTypeDeletePayload(
  updates: unknown,
): updates is WorkItemTypeCascadeDeleteUpdatesPayload {
  return (
    updates !== null &&
    typeof updates === 'object' &&
    ['cascade', 'typeKey', 'itemCount', 'edgeCount'].some((key) =>
      Object.prototype.hasOwnProperty.call(updates, key),
    )
  );
}

// ─── Compile-time drift detection ──────────────────────────────────
// These assertions verify that Zod schema outputs remain assignable
// to the generated OpenAPI DTOs. A TypeScript error here means the
// Zod schema has drifted from the spec and needs updating.
type _Extends<_A extends _B, _B> = true;
type _StripIndex<T> = {
  [K in keyof T as string extends K ? never : K]: T[K];
};

// Task schemas: full structural match (strict, no extra keys)
type _CheckCreateTask = _Extends<
  z.infer<typeof createTaskUpdatesSchema>,
  CreateTaskDto
>;
type _CheckWorkflowProposalStep = _Extends<
  z.infer<typeof workflowProposalStepInputSchema>,
  WorkflowProposalStepInput
>;
type _CheckWorkflowProposalLink = _Extends<
  z.infer<typeof workflowProposalLinkInputSchema>,
  WorkflowProposalLinkInput
>;
type _CheckUpdateTask = _Extends<
  z.output<typeof updateTaskUpdatesSchema>,
  UpdateTaskDto
>;

// Design doc schemas: validated fields must be DTO-compatible
// (passthrough allows additional fields, so we strip the index sig)
type _CreateDocFields = _StripIndex<
  z.infer<typeof createDesignDocUpdatesSchema>
>;
type _CheckCreateDoc = _Extends<
  _CreateDocFields,
  Pick<CreateDesignDocDto, keyof _CreateDocFields & keyof CreateDesignDocDto>
>;
type _UpdateDocFields = _StripIndex<
  z.output<typeof updateDesignDocUpdatesSchema>
>;
type _CheckUpdateDoc = _Extends<
  _UpdateDocFields,
  Pick<UpdateDesignDocDto, keyof _UpdateDocFields & keyof UpdateDesignDocDto>
>;
// Work-item-type schemas: full structural match against the generated DTO
// and its leaf shapes. A spec/codegen change that drifts any axis fails here.
type _CheckWorkItemTypeSection = _Extends<
  z.infer<typeof workItemTypeSectionSchema>,
  WorkItemTypeSectionDefinition
>;
type _CheckWorkItemTypeScalar = _Extends<
  z.infer<typeof workItemTypeScalarFieldSchema>,
  WorkItemTypeScalarField
>;
type _CheckWorkItemTypeEdgeTarget = _Extends<
  z.infer<typeof workItemTypeEdgeTargetSchema>,
  WorkItemTypeEdgeTarget
>;
type _CheckCreateWorkItemType = _Extends<
  z.infer<typeof createWorkItemTypeUpdatesSchema>,
  WorkItemTypeDefinitionDto
>;
type _CheckCascadeDeleteWorkItemType = _Extends<
  z.infer<typeof cascadeDeleteWorkItemTypeUpdatesSchema>,
  WorkItemTypeCascadeDeleteUpdatesPayload
>;
type _CheckEntityPromptTemplateUpsert = _Extends<
  z.infer<typeof entityPromptTemplateUpsertUpdatesSchema>,
  EntityPromptTemplateUpsertUpdatesPayload
>;
type _CheckEntityPromptTemplateRetire = _Extends<
  z.infer<typeof entityPromptTemplateRetireUpdatesSchema>,
  EntityPromptTemplateRetireUpdatesPayload
>;
type _CheckEntityPromptTemplateProposal = _Extends<
  z.infer<typeof entityPromptTemplateProposalUpdatesSchema>,
  EntityPromptTemplateProposalUpdatesPayload
>;
type _CheckPlanFromDesignDocConversationContext = _Extends<
  Omit<
    z.infer<typeof planFromDesignDocConversationUpdatesSchema>,
    'workflowName'
  >,
  CreatePlanFromDesignDocConversationContext
>;

const proposalEli5Schema = z.string().min(1).max(150);

const baseProposalSchema = z.object({
  type: proposalTypeSchema,
  action: proposalActionSchema,
  eli5: proposalEli5Schema.optional(),
  targetEntityId: z.string(),
  targetEntityType: targetEntityTypeSchema,
  updates: z.record(z.any()),
  requestorContext: z.record(z.any()).optional(),
  validationSessionId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
  tracks: z.object({ sourceEntityId: z.string().uuid() }).strict().optional(),
  edges: z.array(proposalEdgeDeclarationSchema).optional(),
});

const authoringProposalSchema = baseProposalSchema.extend({
  eli5: proposalEli5Schema,
});

type Action = z.infer<typeof proposalActionSchema>;
type ProposalEntityType = z.infer<typeof targetEntityTypeSchema>;

function getUpdatesSchema(
  action: Action,
  targetEntityType: ProposalEntityType,
  updates?: unknown,
): z.ZodTypeAny | null {
  if (
    action === 'VERSIONED_UPDATE' &&
    (targetEntityType === 'TASK' || targetEntityType === 'DESIGN_DOC')
  ) {
    return z.unknown().superRefine((value, context) => {
      try {
        parseFutureRevisionMutation(value);
      } catch (error) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }
  if (action === 'DELETE' && targetEntityType === 'WORK_ITEM_TYPE') {
    return workItemTypeDeleteUpdatesSchema;
  }
  if (action === 'DELETE' && targetEntityType === 'ENTITY_PROMPT_TEMPLATE') {
    return entityPromptTemplateRetireUpdatesSchema;
  }
  if (action === 'DELETE') return deleteUpdatesSchema;
  if (
    (action === 'CREATE' || action === 'UPDATE') &&
    targetEntityType === 'TASK' &&
    isWorkItemChangeSetPayload(updates)
  ) {
    return workItemChangeSetValidationRequestSchema;
  }
  if (action === 'CREATE' && targetEntityType === 'TASK')
    return createTaskUpdatesSchema;
  if (action === 'UPDATE' && targetEntityType === 'TASK')
    return updateTaskUpdatesSchema;
  if (action === 'CREATE' && targetEntityType === 'DESIGN_DOC')
    return createDesignDocUpdatesSchema;
  if (action === 'UPDATE' && targetEntityType === 'DESIGN_DOC')
    return updateDesignDocUpdatesSchema;
  if (action === 'CREATE' && targetEntityType === 'CONVERSATION')
    return planFromDesignDocConversationUpdatesSchema;
  if (action === 'CREATE' && targetEntityType === 'WORK_ITEM_TYPE')
    return createWorkItemTypeUpdatesSchema;
  if (action === 'UPDATE' && targetEntityType === 'WORK_ITEM_TYPE') {
    if (
      updates !== null &&
      typeof updates === 'object' &&
      'resetToCanonical' in updates
    )
      return resetWorkItemTypeUpdatesSchema;
    return editWorkItemTypeUpdatesSchema;
  }
  if (action === 'UPDATE' && targetEntityType === 'ENTITY_PROMPT_TEMPLATE') {
    return entityPromptTemplateUpsertUpdatesSchema;
  }
  return null;
}

function isWorkItemChangeSetPayload(updates: unknown): boolean {
  return (
    updates !== null &&
    typeof updates === 'object' &&
    ('root' in updates ||
      'operations' in updates ||
      'layoutBoundary' in updates)
  );
}

function changeSetIdentityKey(identity: WorkItemChangeSetIdentity): string {
  return identity.refType === 'existing'
    ? `existing:${identity.id}`
    : `temporary:${identity.tempId}`;
}

function sameChangeSetIdentity(
  left: WorkItemChangeSetIdentity,
  right: WorkItemChangeSetIdentity,
): boolean {
  return changeSetIdentityKey(left) === changeSetIdentityKey(right);
}

function createdRootType(updates: unknown): string | undefined {
  const changeSet = workItemChangeSetValidationRequestSchema.safeParse(updates);
  if (changeSet.success) {
    const rootKey = changeSetIdentityKey(changeSet.data.root);
    const rootCreate = changeSet.data.operations.find(
      (operation) =>
        operation.op === 'workItem.create' &&
        changeSetIdentityKey(operation.ref) === rootKey,
    );
    return rootCreate?.op === 'workItem.create' ? rootCreate.type : undefined;
  }

  if (
    updates === null ||
    typeof updates !== 'object' ||
    Array.isArray(updates)
  ) {
    return undefined;
  }
  const type = (updates as Record<string, unknown>)['type'];
  return typeof type === 'string' ? type : undefined;
}

export function createdProposalTargetType(proposal: {
  targetEntityType: string;
  updates: unknown;
}): string | undefined {
  if (proposal.targetEntityType === 'TASK') {
    return createdRootType(proposal.updates);
  }
  return proposal.targetEntityType === 'DESIGN_DOC'
    ? proposal.targetEntityType
    : undefined;
}

export function assertWorkItemChangeSetStructurallyValid(
  dto: CreateProposalDto,
): void {
  if (
    (dto.action !== 'CREATE' && dto.action !== 'UPDATE') ||
    dto.targetEntityType !== 'TASK' ||
    !isWorkItemChangeSetPayload(dto.updates)
  ) {
    return;
  }

  const result = workItemChangeSetValidationRequestSchema.safeParse(
    dto.updates,
  );
  if (result.success) {
    return;
  }

  throw new BadRequestException({
    message: 'Proposal graph operations violate the OpenAPI contract',
    errors: result.error.issues.map((issue) => ({
      field: fieldPath('updates', issue.path),
      code: issueCode(issue),
      reason: issue.message,
      layer: 'structural' as const,
      suggestion: suggestForStructuralIssue(issue),
    })),
  });
}

// ─── Helpers ───────────────────────────────────────────────────────

function fieldPath(prefix: string, path: (string | number)[]): string {
  const suffix = path.reduce<string>((acc, seg) => {
    if (typeof seg === 'number') return `${acc}[${seg}]`;
    return acc.length === 0 ? seg : `${acc}.${seg}`;
  }, '');
  return suffix ? `${prefix}.${suffix}` : prefix;
}

const STRUCTURED_MOCKUP_VALIDATION_SUGGESTION =
  'Send a work-item-structured-mockup.v3, v4, or v5 document using the declared component vocabulary; containers use independent justify (start, center, end, spread) and align (start, center, end, stretch) values.';

function issueCode(issue: z.ZodIssue): string {
  if (
    issue.code === z.ZodIssueCode.invalid_type &&
    issue.received === 'undefined'
  ) {
    return 'required';
  }
  if (issue.code === z.ZodIssueCode.invalid_enum_value) {
    return 'invalid_enum';
  }
  return issue.code;
}

const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'MEMBER']);

function suggestForStructuralIssue(issue: z.ZodIssue): string | undefined {
  if (
    issue.code === z.ZodIssueCode.invalid_type &&
    issue.received === 'undefined'
  ) {
    return `Provide a value for '${issue.path[issue.path.length - 1]}'.`;
  }
  if (issue.code === z.ZodIssueCode.invalid_enum_value) {
    const enumIssue = issue as z.ZodIssue & { options?: unknown[] };
    if (enumIssue.options) {
      return `Valid values: ${(enumIssue.options as string[]).join(', ')}.`;
    }
  }
  return undefined;
}

export function validateProposalStructure(
  dto: CreateProposalDto,
  index = 0,
  options: { enforceAuthoringEnvelope?: boolean } = {},
): ProposalValidationIssue[] {
  const prefix = `proposals[${index}]`;
  const issues: ProposalValidationIssue[] = [];

  const envelopeResult = (
    options.enforceAuthoringEnvelope
      ? authoringProposalSchema
      : baseProposalSchema
  ).safeParse(dto);
  if (!envelopeResult.success) {
    for (const zodIssue of envelopeResult.error.issues) {
      issues.push({
        field: fieldPath(prefix, zodIssue.path),
        code: issueCode(zodIssue),
        reason: zodIssue.message,
        layer: 'structural',
        suggestion: suggestForStructuralIssue(zodIssue),
      });
    }
    return issues;
  }

  const isWorkItemTypeLifecycleProposal =
    dto.targetEntityType === 'WORK_ITEM_TYPE' && dto.action !== 'CREATE';
  const isEntityPromptTemplateProposal =
    dto.targetEntityType === 'ENTITY_PROMPT_TEMPLATE';

  const source = (dto.requestorContext as { source?: unknown } | undefined)
    ?.source;
  if (
    options.enforceAuthoringEnvelope &&
    source !== 'user' &&
    source !== 'agent'
  ) {
    issues.push({
      field: `${prefix}.requestorContext.source`,
      code: 'invalid_value',
      reason:
        "Proposal must carry a server-stamped requestorContext.source ('user' or 'agent').",
      layer: 'structural',
      suggestion:
        'Author the proposal through a supported user or MCP boundary.',
    });
  }

  if (
    options.enforceAuthoringEnvelope &&
    dto.action === 'CREATE' &&
    (typeof dto.title !== 'string' || dto.title.length === 0)
  ) {
    issues.push({
      field: `${prefix}.title`,
      code: 'required',
      reason: 'CREATE proposals must include a non-empty title.',
      layer: 'structural',
      suggestion: 'Provide the title snapshot for the entity being created.',
    });
  }

  for (const [edgeIndex, edge] of (options.enforceAuthoringEnvelope
    ? (dto.edges ?? [])
    : []
  ).entries()) {
    if (edge.edgeType === ProposalEdgeType.Tracks) {
      issues.push({
        field: `${prefix}.edges[${edgeIndex}].edgeType`,
        code: 'invalid_value',
        reason:
          'TRACKS cannot be authored through edges; use the structured tracks attachment.',
        layer: 'structural',
        suggestion: 'Move the source identity to tracks.sourceEntityId.',
      });
    }
  }

  const influenceReasonTypes = new Set([
    'explicit_mention',
    'implied',
    'derived',
    'origin',
    'user_reason',
  ]);
  const influenceKeys = new Set<string>([
    'entityId',
    'entityType',
    'entityTitle',
    'taskType',
    'reasoning',
    'reasonType',
    'confidence',
  ] satisfies Array<keyof Influence>);
  for (const [influenceIndex, influence] of (options.enforceAuthoringEnvelope
    ? (dto.influences ?? [])
    : []
  ).entries()) {
    const influencePrefix = `${prefix}.influences[${influenceIndex}]`;
    if (!influence || typeof influence !== 'object') {
      issues.push({
        field: influencePrefix,
        code: 'invalid_type',
        reason: 'Influence entries must be objects.',
        layer: 'structural',
      });
      continue;
    }
    const unsupportedKey = Object.keys(influence).find(
      (key) => !influenceKeys.has(key),
    );
    if (unsupportedKey) {
      issues.push({
        field: `${influencePrefix}.${unsupportedKey}`,
        code: 'unrecognized_key',
        reason: `Unsupported influence field '${unsupportedKey}'.`,
        layer: 'structural',
        suggestion: 'Declare typed relationships through proposal edges.',
      });
    }
    if (!z.string().uuid().safeParse(influence.entityId).success) {
      issues.push({
        field: `${influencePrefix}.entityId`,
        code: 'invalid_format',
        reason: 'entityId is required and must be a UUID.',
        layer: 'structural',
      });
    }
    if (!Object.values(EntityType).includes(influence.entityType)) {
      issues.push({
        field: `${influencePrefix}.entityType`,
        code: 'invalid_enum',
        reason: 'entityType must be a recognized entity type.',
        layer: 'structural',
      });
    }
    if (!influenceReasonTypes.has(influence.reasonType)) {
      issues.push({
        field: `${influencePrefix}.reasonType`,
        code: 'invalid_enum',
        reason: 'reasonType must be a recognized influence reason type.',
        layer: 'structural',
      });
    }
    if (typeof influence.reasoning !== 'string') {
      issues.push({
        field: `${influencePrefix}.reasoning`,
        code: 'invalid_type',
        reason: 'reasoning is required and must be a string.',
        layer: 'structural',
      });
    }
    if (
      influence.taskType !== undefined &&
      typeof influence.taskType !== 'string'
    ) {
      issues.push({
        field: `${influencePrefix}.taskType`,
        code: 'invalid_type',
        reason: 'taskType must be an opaque string when provided.',
        layer: 'structural',
      });
    }
  }

  if (
    dto.action !== 'CREATE' &&
    !isWorkItemTypeLifecycleProposal &&
    !isEntityPromptTemplateProposal
  ) {
    const uuidResult = z.string().uuid().safeParse(dto.targetEntityId);
    if (!uuidResult.success) {
      issues.push({
        field: `${prefix}.targetEntityId`,
        code: 'invalid_format',
        reason: 'targetEntityId must be a valid UUID for UPDATE/DELETE actions',
        layer: 'structural',
        suggestion: 'Provide the UUID of the existing entity to modify.',
      });
    }
  }

  if (
    options.enforceAuthoringEnvelope &&
    dto.action === 'UPDATE' &&
    dto.targetEntityType === 'TASK' &&
    dto.updates !== null &&
    typeof dto.updates === 'object' &&
    Object.prototype.hasOwnProperty.call(dto.updates, 'type')
  ) {
    issues.push({
      field: `${prefix}.updates.type`,
      code: 'invalid_field',
      reason: 'Task type cannot be changed after creation.',
      layer: 'structural',
      suggestion: 'Remove type from the update payload.',
    });
  }

  const updatesSchema = getUpdatesSchema(
    dto.action as Action,
    dto.targetEntityType as ProposalEntityType,
    dto.updates,
  );

  if (!updatesSchema) {
    issues.push({
      field: `${prefix}.updates`,
      code: 'unsupported_combination',
      reason:
        `No schema for action=${dto.action} ` +
        `targetEntityType=${dto.targetEntityType}`,
      layer: 'structural',
    });
    return issues;
  }

  const supersedeViolation = evaluateSupersedeInvariant(dto);
  if (isWorkItemChangeSetPayload(dto.updates)) {
    for (const [index, edge] of (dto.edges ?? []).entries()) {
      if (
        edge.endpointMode !== ProposalEdgeEndpointMode.Proposal &&
        edge.targetEntityType !== ProposalEdgeTargetType.Proposal
      ) {
        issues.push({
          field: `${prefix}.edges[${index}].targetEntityType`,
          code: 'invalid_value',
          layer: 'structural',
          reason:
            'Graph change-set outer edges may defer only to PROPOSAL targets; use operations for relationships to existing entities.',
        });
      }
    }
  }
  if (supersedeViolation) {
    issues.push({
      field: `${prefix}.${supersedeViolation.field}`,
      code: supersedeViolation.code,
      reason: supersedeViolation.reason,
      layer: 'structural',
      suggestion: supersedeViolation.suggestion,
    });
  }

  if (
    dto.action === 'UPDATE' &&
    dto.targetEntityType === 'TASK' &&
    dto.updates !== null &&
    typeof dto.updates === 'object' &&
    Object.keys(dto.updates as Record<string, unknown>).length === 0 &&
    (dto.edges?.length ?? 0) === 0
  ) {
    issues.push({
      field: `${prefix}.updates`,
      code: 'invalid_type',
      reason: 'At least one update field or edge declaration is required',
      layer: 'structural',
    });
  }

  const updatesResult = updatesSchema.safeParse(dto.updates);
  if (!updatesResult.success) {
    for (const zodIssue of updatesResult.error.issues) {
      issues.push({
        field: fieldPath(`${prefix}.updates`, zodIssue.path),
        code: issueCode(zodIssue),
        reason: zodIssue.message,
        layer: 'structural',
        suggestion: suggestForStructuralIssue(zodIssue),
      });
    }
  } else if (
    dto.action === 'UPDATE' &&
    dto.targetEntityType === 'WORK_ITEM_TYPE' &&
    'definition' in updatesResult.data &&
    updatesResult.data.definition.key !== dto.targetEntityId
  ) {
    issues.push({
      field: `${prefix}.updates.definition.key`,
      code: 'invalid_value',
      reason:
        'The edited definition key must match the lifecycle route type key.',
      layer: 'structural',
      suggestion: 'Keep definition.key equal to targetEntityId.',
    });
  }
  if (updatesResult.success) {
    if (
      dto.action === 'CREATE' &&
      dto.targetEntityType === 'WORK_ITEM_TYPE' &&
      dto.targetEntityId !== NIL_UUID &&
      updatesResult.data.key !== dto.targetEntityId
    ) {
      issues.push({
        field: `${prefix}.targetEntityId`,
        code: 'invalid_value',
        reason:
          'A work-item type CREATE target must be the nil UUID for a new definition or the submitted definition key for restoration.',
        layer: 'structural',
        suggestion:
          'Use the nil UUID for ordinary creation, or the exact retained key for restoration.',
      });
    }
    if (
      dto.action === 'DELETE' &&
      dto.targetEntityType === 'WORK_ITEM_TYPE' &&
      isCascadeWorkItemTypeDeletePayload(updatesResult.data) &&
      updatesResult.data.typeKey !== dto.targetEntityId
    ) {
      issues.push({
        field: `${prefix}.updates.typeKey`,
        code: 'invalid_value',
        reason: 'The cascade payload type key must match targetEntityId.',
        layer: 'structural',
        suggestion: 'Keep updates.typeKey equal to targetEntityId.',
      });
    }
  }

  return issues;
}

export function assertProposalStructurallyValid(dto: CreateProposalDto): void {
  const errors = validateProposalStructure(dto);
  if (errors.length === 0) {
    return;
  }

  throw new BadRequestException({
    message: 'Proposal violates the OpenAPI structural contract',
    errors,
  });
}

export function assertWorkflowProposalLinksStructurallyValid(
  dto: CreateProposalDto,
): void {
  if (dto.action !== 'CREATE' || dto.targetEntityType !== 'TASK') {
    return;
  }

  const updates = dto.updates as Record<string, unknown>;
  if (updates.type !== 'workflow') {
    return;
  }

  const result = z
    .array(workflowProposalLinkInputSchema)
    .safeParse(updates.workflowLinks ?? []);
  if (result.success) {
    return;
  }

  const errors: ProposalValidationIssue[] = result.error.issues.map(
    (issue) => ({
      field: fieldPath('updates.workflowLinks', issue.path),
      code: issueCode(issue),
      reason: issue.message,
      layer: 'structural',
      suggestion: suggestForStructuralIssue(issue),
    }),
  );

  throw new BadRequestException({
    message: 'Workflow proposal links violate the OpenAPI contract',
    errors,
  });
}

// ─── Engine ────────────────────────────────────────────────────────

@Injectable()
export class ProposalValidationEngine {
  @Inject(ProposalReconciliationService)
  private readonly reconciliation!: ProposalReconciliationService;
  private readonly logger = new Logger(ProposalValidationEngine.name);
  private readonly taskSectionSchemaValidators: TaskSectionSchemaValidatorRegistry;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
    private readonly workItemParentageValidator: WorkItemParentageValidator,
    @Optional()
    private readonly workItemChangeSetProjector?: WorkItemChangeSetProjectorService,
    @Optional()
    private readonly featureRequirementAuthoringService?: FeatureRequirementAuthoringService,
  ) {
    this.taskSectionSchemaValidators = new TaskSectionSchemaValidatorRegistry();
  }

  private featureRequirementAuthoring(): FeatureRequirementAuthoringService {
    return (
      this.featureRequirementAuthoringService ??
      new FeatureRequirementAuthoringService(this.workItemTypeRegistry)
    );
  }

  /**
   * Validate one or more proposal DTOs. Each proposal is validated
   * independently — one invalid proposal does not block others.
   *
   * Layers run in order: structural → referential → permission.
   * Referential and permission checks are skipped for a proposal
   * whose structural validation failed (fields may be unparseable).
   */
  async validate(
    input: ValidateProposalsInput,
  ): Promise<ProposalValidationResult> {
    const results: SingleProposalValidationResult[] = [];

    for (let i = 0; i < input.proposals.length; i++) {
      const dto = input.proposals[i]!;
      const errors: ProposalValidationIssue[] = [];
      const warnings: ProposalValidationIssue[] = [];

      // Layer 1: structural
      const structuralIssues = validateProposalStructure(dto, i);
      errors.push(...structuralIssues);

      // Only run deeper checks when the envelope is structurally valid
      if (structuralIssues.length === 0) {
        // Layer 2: referential integrity
        const refIssues = await this.validateReferences(
          dto,
          input.context,
          i,
          input.context.db,
        );
        errors.push(...refIssues);

        // Layer 3: permission
        const permIssues = this.validatePermissions(dto, input.context, i);
        warnings.push(...permIssues);
      }

      results.push({
        index: i,
        valid: errors.length === 0,
        errors,
        warnings,
      });
    }

    const allValid = results.every((r) => r.valid);

    return { valid: allValid, proposals: results };
  }

  async assertAuthoringCandidatesValid<
    TProposal extends CreateProposalRequestDto,
  >(
    input: ValidateProposalAuthoringCandidatesInput<TProposal>,
  ): Promise<ProposalAuthoringAdmission<TProposal>> {
    const db = input.context.db ?? this.prisma.db;
    // Normalize tracking before gathering references. Validate the submitted
    // envelope below so raw TRACKS declarations still receive diagnostics.
    const submitted = structuredClone(input.proposals);
    const results: SingleProposalValidationResult[] = submitted.map(
      (dto, index) => {
        const errors = validateProposalStructure(dto, index, {
          enforceAuthoringEnvelope: true,
        });
        return { index, valid: errors.length === 0, errors, warnings: [] };
      },
    );
    const candidates = submitted.map((dto, index) =>
      results[index]!.valid ? storeTracksAttachmentAsProposalEdge(dto) : dto,
    );
    const metadata = await loadProposalReferenceMetadata(
      db,
      input.context.organizationId,
      collectProposalReferences(
        candidates.filter((_, index) => results[index]!.valid),
      ),
      input.context.projectId,
    );
    const allowedUnmaterializedTargetKeys = new Set(
      (input.context.group?.reservedEntities ?? []).map((entity) =>
        proposalReferenceKey(entity),
      ),
    );

    for (const [index, dto] of submitted.entries()) {
      const { errors } = results[index]!;
      if (errors.length === 0) {
        errors.push(
          ...(await this.validateReferences(
            dto,
            input.context,
            index,
            db,
            metadata,
          )),
          ...validateProposalEdgeTargetsResolvable(
            candidates[index]!.edges,
            metadata,
            input.context.projectId,
            allowedUnmaterializedTargetKeys,
            `proposals[${index}].`,
          ),
          ...(await this.validateDeferredDiagramProposalEdges({
            dto,
            metadata,
            organizationId: input.context.organizationId,
            projectId: input.context.projectId,
            proposalIndex: index,
          })),
        );
      }
      results[index]!.valid = errors.length === 0;
    }

    const errors = results.flatMap((result) => result.errors);
    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Proposal authoring validation failed',
        errors,
      });
    }
    return {
      candidates: candidates.map((candidate) => ({
        [admittedCandidate]: candidate,
        get candidate() {
          return structuredClone(candidate);
        },
      })),
      metadata,
    };
  }

  private async validateDeferredDiagramProposalEdges(args: {
    dto: CreateProposalRequestDto;
    metadata: ProposalReferenceMetadata;
    organizationId: OrganizationId;
    projectId: ProjectId;
    proposalIndex: number;
  }): Promise<ProposalValidationIssue[]> {
    const { dto, metadata, organizationId, projectId, proposalIndex } = args;
    const edges = dto.edges ?? [];
    if (edges.length === 0) return [];

    const changeSetResult =
      dto.targetEntityType === 'TASK' &&
      (dto.action === 'CREATE' || dto.action === 'UPDATE') &&
      isWorkItemChangeSetPayload(dto.updates)
        ? workItemChangeSetValidationRequestSchema.safeParse(dto.updates)
        : undefined;
    const changeSet =
      changeSetResult?.success === true ? changeSetResult.data : undefined;
    const proposalRootType =
      dto.targetEntityType !== 'TASK'
        ? undefined
        : dto.action === 'CREATE'
          ? createdRootType(dto.updates)
          : metadata.taskRows.get(dto.targetEntityId)?.type;

    let projectedSourceNodes: ProjectedWorkItem[] | undefined;
    let projectedSourceNodesValid = false;
    const issues: ProposalValidationIssue[] = [];

    for (const [edgeIndex, edge] of edges.entries()) {
      if (
        edge.targetEntityType !== ProposalEdgeTargetType.Proposal ||
        edge.endpointMode === ProposalEdgeEndpointMode.Proposal
      ) {
        continue;
      }

      // Existing task-proposal deferred links retain their historical root
      // behavior. The extra source and lifecycle contract applies to Diagram
      // graph proposals and declarations that explicitly name a source.
      const needsDiagramAdmission =
        edge.sourceRef !== undefined ||
        changeSet !== undefined ||
        proposalRootType === WORK_ITEM_TYPE_KEYS.Diagram;
      if (!needsDiagramAdmission) continue;

      const fieldPrefix = `proposals[${proposalIndex}].edges[${edgeIndex}]`;
      const target = metadata.proposalRows.get(edge.targetEntityId);
      // The shared edge-reference validator reports missing or out-of-scope
      // proposal targets at targetEntityId.
      if (!target) continue;

      if (target.status === 'REJECTED') {
        issues.push({
          field: `${fieldPrefix}.targetEntityId`,
          code: 'invalid_value',
          reason: 'Deferred Diagram links cannot target a rejected proposal.',
          layer: 'referential',
        });
        continue;
      }
      if (target.action !== 'CREATE') {
        issues.push({
          field: `${fieldPrefix}.targetEntityId`,
          code: 'invalid_value',
          reason: 'Deferred Diagram links require a CREATE proposal target.',
          layer: 'referential',
        });
        continue;
      }

      const targetType = createdProposalTargetType(target);
      if (
        targetType === undefined ||
        (target.targetEntityType === 'TASK' &&
          !this.workItemTypeRegistry.isTypeActiveForProject(
            targetType,
            projectId,
          ))
      ) {
        issues.push({
          field: `${fieldPrefix}.targetEntityId`,
          code: 'unresolved_reference',
          reason:
            'The CREATE proposal target does not have a currently registered work-item type.',
          layer: 'referential',
        });
        continue;
      }

      let sourceType = proposalRootType;
      if (edge.sourceRef !== undefined) {
        if (changeSet !== undefined) {
          if (!projectedSourceNodes) {
            if (!this.workItemChangeSetProjector) {
              throw new Error(
                'Work-item change-set projection is not configured.',
              );
            }
            const projection = await this.workItemChangeSetProjector.project({
              organizationId,
              projectId,
              request: changeSet,
              view: sourceRefView(
                edges.flatMap((candidate) =>
                  candidate.sourceRef ? [candidate.sourceRef] : [],
                ),
              ),
            });
            projectedSourceNodesValid = projection.valid;
            projectedSourceNodes = [
              projection.projectedRoot,
              ...projection.children,
            ];
          }
          if (!projectedSourceNodesValid) {
            sourceType = undefined;
          } else {
            sourceType = projectedSourceNodes.find(
              (node) =>
                !node.deleted &&
                sameChangeSetIdentity(node.identity, edge.sourceRef!),
            )?.type;
          }
        } else if (
          dto.action === 'UPDATE' &&
          edge.sourceRef.refType === 'existing' &&
          edge.sourceRef.id === dto.targetEntityId
        ) {
          sourceType = proposalRootType;
        } else {
          sourceType = undefined;
        }

        if (sourceType === undefined) {
          issues.push({
            field: `${fieldPrefix}.sourceRef`,
            code: 'unresolved_reference',
            reason:
              'sourceRef must identify the Diagram root or a non-deleted work item in a valid projected change set.',
            layer: 'referential',
          });
          continue;
        }
      }

      if (
        sourceType !== WORK_ITEM_TYPE_KEYS.Diagram &&
        sourceType !== WORK_ITEM_TYPE_KEYS.DiagramElement
      ) {
        issues.push({
          field: `${fieldPrefix}.sourceRef`,
          code: 'invalid_value',
          reason:
            'Deferred graph proposal links may originate only from a Diagram or one of its Diagram Elements.',
          layer: 'referential',
        });
        continue;
      }

      const sourceDefinition = this.workItemTypeRegistry.getDefinition(
        projectId,
        sourceType,
      )?.definition;
      const edgeAllowed = sourceDefinition?.edgeTargets?.some(
        (targetRule) =>
          targetRule.edgeType === edge.edgeType &&
          // The registry contract defines an empty target list as unrestricted.
          (targetRule.targetTypeKeys.length === 0 ||
            targetRule.targetTypeKeys.includes(targetType)),
      );
      if (!edgeAllowed) {
        issues.push({
          field: `${fieldPrefix}.edgeType`,
          code: 'invalid_value',
          reason: `The project registry does not allow ${edge.edgeType} from ${sourceType} to ${targetType}.`,
          layer: 'referential',
        });
      }
    }

    return issues;
  }

  async assertTrackingAttachmentValid(
    dto: CreateProposalDto,
    organizationId: OrganizationId,
    projectId: ProjectId,
    db: AnyTransactionClient = this.prisma.db,
  ): Promise<void> {
    await assertCreateWorkItemTracksAttachmentValid({
      db,
      registry: this.workItemTypeRegistry,
      organizationId,
      projectId,
      dto,
    });
  }

  /**
   * Freeze FEATURE requirement authoring into the proposal payload before it
   * is reviewed. This is deliberately separate from semantic validation: the
   * preparation result is the durable reviewed collection, while validation
   * may be repeated against the current transaction at approval time.
   */
  async prepareTaskMutationRequirements(
    dto: CreateProposalDto,
    organizationId: OrganizationId,
    projectId: ProjectId,
    db: AnyTransactionClient = this.prisma.db,
    mintUuid?: () => string,
  ): Promise<CreateProposalDto> {
    if (
      dto.targetEntityType !== 'TASK' ||
      dto.updates === null ||
      typeof dto.updates !== 'object' ||
      Array.isArray(dto.updates)
    ) {
      return dto;
    }

    const updates = dto.updates as Record<string, unknown>;
    const replaceRequirements = (
      sections: unknown,
      content: unknown,
    ): unknown[] => {
      const existing = (sections ?? []) as Array<{ key?: unknown }>;
      return [
        ...existing.filter((section) => section.key !== 'requirements'),
        { key: 'requirements', content },
      ];
    };
    const canReplaceSections = (sections: unknown): boolean =>
      sections === undefined ||
      (Array.isArray(sections) &&
        sections.every(
          (section) =>
            section !== null &&
            typeof section === 'object' &&
            !Array.isArray(section),
        ));
    const failure = (
      field: string,
      diagnostics: readonly {
        field: string;
        code?: string;
        message: string;
      }[],
    ): never => {
      throw new BadRequestException({
        message: `${field} cannot be prepared`,
        errors: diagnostics.map((diagnostic) => ({
          field: `${field}.${diagnostic.field}`,
          code: `feature_requirement_${diagnostic.code ?? 'invalid'}`,
          reason: diagnostic.message,
          layer: 'referential' as const,
        })),
      });
    };

    if (
      dto.action === 'CREATE' &&
      Object.prototype.hasOwnProperty.call(updates, 'initialRequirements')
    ) {
      if (updates.type !== WORK_ITEM_TYPE_KEYS.Feature) return dto;
      if (
        Array.isArray(updates.sections) &&
        updates.sections.some(
          (section) =>
            section !== null &&
            typeof section === 'object' &&
            (section as { key?: unknown }).key === 'requirements',
        )
      ) {
        throw new BadRequestException(
          'Provide FEATURE requirements through initialRequirements or sections[requirements], not both.',
        );
      }
      if (!canReplaceSections(updates.sections)) return dto;
      const prepared =
        await this.featureRequirementAuthoring().prepareInitialRequirements(
          updates.initialRequirements as NonNullable<
            CreateTaskDto['initialRequirements']
          >,
          { organizationId, db },
          mintUuid,
        );
      if (!prepared.success) {
        failure('initialRequirements', prepared.diagnostics);
      }
      if (!prepared.success) return dto;
      const { initialRequirements: _initialRequirements, ...withoutInitial } =
        updates;
      void _initialRequirements;
      return {
        ...dto,
        updates: {
          ...withoutInitial,
          sections: replaceRequirements(
            withoutInitial.sections,
            prepared.section,
          ),
        },
      };
    }

    if (
      dto.action === 'UPDATE' &&
      Object.prototype.hasOwnProperty.call(updates, 'requirementOps')
    ) {
      const target = await db.task.findFirst({
        where: {
          id: dto.targetEntityId,
          organizationId,
          projectId,
          archivedAt: null,
        },
        select: { type: true },
      });
      if (!target) return dto;
      if (target.type !== WORK_ITEM_TYPE_KEYS.Feature) {
        throw new BadRequestException(
          'requirementOps is only accepted for FEATURE tasks.',
        );
      }
      if (
        Array.isArray(updates.sections) &&
        updates.sections.some(
          (section) =>
            section !== null &&
            typeof section === 'object' &&
            (section as { key?: unknown }).key === 'requirements',
        )
      ) {
        throw new BadRequestException(
          'Provide FEATURE requirements through requirementOps or sections[requirements], not both.',
        );
      }
      if (!canReplaceSections(updates.sections)) return dto;

      // Preserve malformed values so the structural validator can reject them.
      // In particular, removing a non-array value here would let the proposal
      // update path silently discard an invalid requirementOps payload before
      // assertTaskMutationAuthoringValid sees it.
      if (
        updates.requirementOps !== undefined &&
        !Array.isArray(updates.requirementOps)
      ) {
        return dto;
      }

      const { requirementOps, ...withoutOps } = updates;
      if (!Array.isArray(requirementOps) || requirementOps.length === 0) {
        return { ...dto, updates: withoutOps };
      }
      const current = await db.taskSection.findFirst({
        where: { taskId: dto.targetEntityId, key: 'requirements' },
        select: { materializedMarkdown: true },
      });
      const prepared =
        await this.featureRequirementAuthoring().prepareRequirementOperations(
          current?.materializedMarkdown,
          requirementOps as NonNullable<UpdateTaskDto['requirementOps']>,
          { organizationId, db },
          mintUuid,
        );
      if (!prepared.success) {
        failure('requirementOps', prepared.diagnostics);
      }
      if (!prepared.success) return dto;
      return {
        ...dto,
        updates: {
          ...withoutOps,
          sections: replaceRequirements(withoutOps.sections, prepared.section),
        },
      };
    }

    return dto;
  }

  async assertTaskMutationAuthoringValid(
    input: CreateProposalDto | AdmittedProposalCandidate,
    organizationId: OrganizationId,
    projectId: ProjectId,
    db: AnyTransactionClient = this.prisma.db,
    options: { validatePlanStageTopology?: boolean } = {},
  ): Promise<void> {
    const admitted = admittedCandidate in input;
    const dto = admitted ? input[admittedCandidate] : input;
    if (dto.action === 'VERSIONED_UPDATE') {
      if (admitted) {
        await lockFutureForMutation(
          db,
          dto.updates as import('src/generated').FutureRevisionMutation,
          organizationId,
          projectId,
        );
      } else {
        await validateFutureRevision(
          db,
          this.workItemTypeRegistry,
          dto,
          organizationId,
          projectId,
        );
      }
      await this.validateFutureGraph(dto, organizationId, projectId);
      return;
    }
    if (
      dto.targetEntityType === 'TASK' &&
      (dto.action === 'CREATE' || dto.action === 'UPDATE') &&
      isWorkItemChangeSetPayload(dto.updates)
    ) {
      if (!this.workItemChangeSetProjector) {
        throw new Error('Work-item change-set projection is not configured.');
      }
      const parsed = workItemChangeSetValidationRequestSchema.safeParse(
        dto.updates,
      );
      if (!parsed.success) {
        throw new BadRequestException({
          message: 'Proposal graph operations violate the OpenAPI contract',
          errors: parsed.error.issues.map((issue) => ({
            field: fieldPath('updates', issue.path),
            code: issueCode(issue),
            reason: issue.message,
            layer: 'structural' as const,
            suggestion: suggestForStructuralIssue(issue),
          })),
        });
      }
      const projection = await this.workItemChangeSetProjector.project({
        organizationId,
        projectId,
        request: parsed.data,
      });
      if (!projection.valid) {
        throw new BadRequestException({
          message: 'Proposal contains an invalid projected change set',
          projection,
        });
      }
      return;
    }
    if (
      dto.action === 'UPDATE' &&
      dto.targetEntityType === 'TASK' &&
      dto.updates !== null &&
      typeof dto.updates === 'object' &&
      Object.prototype.hasOwnProperty.call(dto.updates, 'type')
    ) {
      throw new BadRequestException(
        'Task type cannot be changed after creation.',
      );
    }
    const structuralIssues = admitted ? [] : validateProposalStructure(dto);
    const referentialIssues =
      !admitted && structuralIssues.length === 0
        ? await this.validateReferences(
            dto,
            { organizationId, projectId },
            0,
            db,
          )
        : [];
    const errors = [...structuralIssues, ...referentialIssues];
    if (errors.length > 0) {
      throw new BadRequestException({
        message:
          dto.targetEntityType === 'WORK_ITEM_TYPE'
            ? 'Proposal contains invalid work-item type updates'
            : dto.targetEntityType === 'TASK'
              ? 'Proposal contains invalid work-item updates'
              : 'Proposal contains invalid authoring updates',
        errors,
      });
    }

    if (dto.targetEntityType === 'ENTITY_PROMPT_TEMPLATE') {
      return;
    }

    if (dto.targetEntityType === 'WORK_ITEM_TYPE') {
      return;
    }

    if (
      dto.targetEntityType !== 'TASK' ||
      (dto.action !== 'CREATE' && dto.action !== 'UPDATE')
    ) {
      return;
    }

    if (options.validatePlanStageTopology !== false) {
      await this.assertPlanStageProposalTopologyValid(
        [{ proposal: dto }],
        organizationId,
        projectId,
      );
    }
  }

  async assertPlanStageProposalTopologyValid(
    candidates: readonly PlanStageProposalCandidate[],
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<void> {
    if (!this.workItemChangeSetProjector) {
      throw new Error('Work-item change-set projection is not configured.');
    }
    const errors =
      await this.workItemChangeSetProjector.projectPlanStageProposalCandidates({
        organizationId,
        projectId,
        candidates,
      });
    if (errors.length === 0) return;
    throw new BadRequestException({
      message: 'Plan Stage proposals contain an invalid projected change set',
      errors,
    });
  }

  private async checkTaskParentage(
    dto: CreateProposalDto,
    organizationId: OrganizationId,
    projectId: ProjectId,
    db: AnyTransactionClient,
    ctx?: ReferentialValidationContext,
  ): Promise<TaskParentageCheckResult> {
    if (
      dto.targetEntityType !== 'TASK' ||
      (dto.action !== 'CREATE' && dto.action !== 'UPDATE')
    ) {
      return { issue: null };
    }

    const updates = dto.updates as Record<string, unknown>;

    if (
      dto.action === 'UPDATE' &&
      !Object.prototype.hasOwnProperty.call(updates, 'parentTaskId')
    ) {
      return { issue: null };
    }

    const parentTaskId = updates.parentTaskId;
    let parentType: string | null = null;
    if (typeof parentTaskId === 'string') {
      const parent = await db.task.findFirst({
        where: {
          id: parentTaskId,
          organizationId,
          projectId,
          archivedAt: null,
        },
        select: { id: true, type: true },
      });
      const reservedParent = ctx?.group?.reservedEntities.find(
        (entity) =>
          entity.entityId === parentTaskId && entity.entityType === 'TASK',
      );
      if (!parent && !reservedParent) {
        return {
          issue: {
            code: 'entity_not_found',
            reason:
              `Parent work item ${parentTaskId} was not found as an existing, ` +
              'non-archived materialized work item.',
            suggestion:
              'Use an already-created parent work-item ID; draft proposal IDs are only valid in structured edge declarations, not parentTaskId.',
          },
        };
      }
      parentType = parent?.type ?? reservedParent?.workItemType ?? null;
    }

    let childType: string;
    let currentTask: { type: string; parentTaskId: string | null } | undefined;
    if (dto.action === 'CREATE') {
      if (typeof updates.type !== 'string') {
        throw new Error(
          'Structurally validated TASK CREATE proposal is missing its work-item type.',
        );
      }
      childType = updates.type;
    } else {
      currentTask = await db.task.findFirst({
        where: {
          id: dto.targetEntityId,
          organizationId,
          projectId,
          archivedAt: null,
        },
        select: { type: true, parentTaskId: true },
      });
      if (!currentTask) {
        return { issue: null };
      }
      childType = currentTask.type;
    }

    try {
      const violation = this.workItemParentageValidator.evaluate({
        childType,
        parentEntityType:
          typeof parentTaskId === 'string' ? EntityType.Task : null,
        parentType,
        projectId,
      });
      return {
        issue: violation
          ? {
              code: 'invalid_placement',
              reason: violation.reason,
              suggestion:
                violation.code === 'parent_required'
                  ? `Provide a structural parent permitted for ${childType} by the configured work-item type definitions.`
                  : 'Choose a structural placement permitted by the configured work-item type definitions.',
            }
          : null,
        childType,
        currentParentTaskId: currentTask?.parentTaskId ?? null,
      };
    } catch (error) {
      return {
        issue: {
          code: 'unrecognized_type',
          reason: error instanceof Error ? error.message : String(error),
          suggestion:
            'Use active work-item types from this project for both the child and structural parent.',
        },
        childType,
        currentParentTaskId: currentTask?.parentTaskId ?? null,
      };
    }
  }

  // ── Layer 2: Referential Integrity ─────────────────────────────

  private async validateReferences(
    dto: CreateProposalDto,
    ctx: ReferentialValidationContext,
    index: number,
    db: AnyTransactionClient = this.prisma.db,
    metadata?: ProposalReferenceMetadata,
  ): Promise<ProposalValidationIssue[]> {
    const prefix = `proposals[${index}]`;
    const issues: ProposalValidationIssue[] = [];
    const updates = dto.updates as Record<string, unknown>;
    let taskTargetWasPrechecked = false;
    let taskParentageWasPrechecked = false;
    let taskParentageResult: TaskParentageCheckResult | undefined;

    if (dto.action === 'VERSIONED_UPDATE') {
      try {
        await validateFutureRevision(
          db,
          this.workItemTypeRegistry,
          dto,
          ctx.organizationId,
          ctx.projectId,
          ctx.group?.reservedEntities,
        );
        await this.validateFutureGraph(dto, ctx.organizationId, ctx.projectId);
      } catch (error) {
        issues.push({
          field: `${prefix}.updates`,
          code: 'invalid_future_revision',
          layer: 'referential',
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      return issues;
    }

    // Verify project exists in the org
    const project = await db.project.findFirst({
      where: { id: ctx.projectId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!project) {
      issues.push({
        field: `${prefix}`,
        code: 'project_not_found',
        reason: `Project ${ctx.projectId} not found in organization ${ctx.organizationId}`,
        layer: 'referential',
        suggestion: 'Verify the projectId and organizationId are correct.',
      });
      return issues;
    }

    if (dto.tracks) {
      try {
        await this.assertTrackingAttachmentValid(
          dto,
          ctx.organizationId,
          ctx.projectId,
          db,
        );
      } catch (error) {
        issues.push({
          field: `${prefix}.tracks`,
          code: 'invalid_tracking_attachment',
          reason: error instanceof Error ? error.message : String(error),
          layer: 'referential',
          suggestion:
            'Use a non-archived source work item whose registry tracking rules allow the new work-item type.',
        });
      }
    }

    // Type-recognition gate, mirroring the service layer's assertTypeActive on
    // the create and re-parent paths. TASK CREATE structurally requires `type`;
    // when present, it must name an active type in this project's scope.
    if (
      dto.targetEntityType === 'TASK' &&
      !isWorkItemChangeSetPayload(dto.updates)
    ) {
      const proposedType = (dto.updates as Record<string, unknown>).type;
      if (typeof proposedType === 'string' && proposedType.length > 0) {
        if (
          !this.workItemTypeRegistry.isTypeActiveForProject(
            proposedType,
            ctx.projectId,
          )
        ) {
          const validTypes = this.workItemTypeRegistry.getActiveTypeKeys(
            ctx.projectId,
          );
          issues.push({
            field: `${prefix}.updates.type`,
            code: 'unrecognized_type',
            reason:
              `'${proposedType}' is not a usable type for this project. ` +
              `Valid types: ${validTypes.join(', ')}`,
            layer: 'referential',
            suggestion: `Use one of the project's active work-item types: ${validTypes.join(
              ', ',
            )}.`,
          });
        } else if (
          dto.action === 'CREATE' &&
          dto.updates !== null &&
          typeof dto.updates === 'object'
        ) {
          try {
            validateWorkItemConfigForType(
              (dto.updates as CreateTaskDto).config,
              this.workItemTypeRegistry.getAcceptedConfigKinds(
                proposedType,
                ctx.projectId,
              ),
              proposedType,
            );
          } catch (error) {
            issues.push({
              field: `${prefix}.updates.config`,
              code: 'invalid_config',
              reason: error instanceof Error ? error.message : String(error),
              layer: 'referential',
              suggestion:
                'Omit config or use a config kind explicitly accepted by the project-effective work-item type definition.',
            });
          }
        }
      }

      if (
        dto.action === 'CREATE' &&
        proposedType === 'workflow' &&
        dto.updates !== null &&
        typeof dto.updates === 'object'
      ) {
        const fulfilledByIssues = await this.validateWorkflowFulfillmentTargets(
          dto.updates as CreateTaskDto,
          ctx,
          prefix,
          db,
        );
        issues.push(...fulfilledByIssues);
      }

      const statusIssue = await this.validateTaskStatusUpdate(
        dto,
        updates,
        ctx,
        prefix,
        db,
      );
      if (statusIssue) issues.push(statusIssue);
      // Parent-only updates need the existing task type and parent in the
      // same read that powers parentage validation. Do this before section
      // validation so the later requirements check can reuse the result and
      // avoid changing the established target/parent/current-task query
      // ordering for ordinary proposal validation.
      if (
        dto.action === 'UPDATE' &&
        dto.updates !== null &&
        typeof dto.updates === 'object' &&
        Object.prototype.hasOwnProperty.call(dto.updates, 'parentTaskId')
      ) {
        taskTargetWasPrechecked = true;
        const entityExists = await this.checkEntityExists(
          dto.targetEntityId,
          dto.targetEntityType,
          ctx.organizationId,
          ctx.projectId,
          db,
          ctx,
        );
        if (!entityExists) {
          issues.push({
            field: `${prefix}.targetEntityId`,
            code: 'entity_not_found',
            reason:
              `${dto.targetEntityType} ${dto.targetEntityId} ` +
              `not found in project ${ctx.projectId}`,
            layer: 'referential',
            suggestion:
              `Verify the ${dto.targetEntityType.toLowerCase()} exists ` +
              'and belongs to the specified project.',
          });
        }
        taskParentageWasPrechecked = true;
        taskParentageResult = await this.checkTaskParentage(
          dto,
          ctx.organizationId,
          ctx.projectId,
          db,
          ctx,
        );
        if (taskParentageResult.issue) {
          issues.push({
            field: `${prefix}.updates.parentTaskId`,
            code: taskParentageResult.issue.code,
            reason: taskParentageResult.issue.reason,
            layer: 'referential',
            suggestion: taskParentageResult.issue.suggestion,
          });
        }
      }

      const sectionIssues = await this.validateTaskSectionInputs(
        dto,
        ctx,
        prefix,
        db,
        taskParentageResult,
      );
      issues.push(...sectionIssues);
      issues.push(...(await this.validateTaskServiceIds(dto, ctx, prefix, db)));
    }

    // Work-item-type definitions carry the same reference constraints whether
    // they create a new type or request restoration of a retained row. A
    // placeholder CREATE must reject a key collision; a stable-key CREATE is
    // restoration only when it names an archived project-owned row and carries
    // that row's exact retained definition.
    if (dto.targetEntityType === 'WORK_ITEM_TYPE') {
      const reservedWorkItemTypeKeys = new Set(
        (ctx.group?.reservedEntities ?? [])
          .filter((entity) => entity.entityType === 'WORK_ITEM_TYPE')
          .map((entity) => entity.workItemType)
          .filter((key): key is string => typeof key === 'string'),
      );
      const def =
        dto.action === 'CREATE'
          ? (dto.updates as Partial<WorkItemTypeDefinitionDto>)
          : dto.action === 'UPDATE'
            ? ((
                dto.updates as {
                  definition?: Partial<WorkItemTypeDefinitionDto>;
                }
              ).definition ?? {})
            : {};
      const proposedKey = typeof def.key === 'string' ? def.key : undefined;
      const retained = proposedKey
        ? this.workItemTypeRegistry.getDefinition(ctx.projectId, proposedKey)
        : undefined;
      if (
        def.colorKey !== undefined &&
        retained &&
        retained.effectiveSource !== 'PROJECT_CUSTOM'
      ) {
        issues.push({
          field:
            dto.action === 'UPDATE'
              ? `${prefix}.updates.definition.colorKey`
              : `${prefix}.updates.colorKey`,
          code: 'canonical_color_read_only',
          reason: 'Only project-custom work-item types may author colorKey.',
          layer: 'referential',
          suggestion: 'Omit colorKey to preserve the platform-defined color.',
        });
      }
      const isStableKeyTarget =
        dto.action === 'CREATE' &&
        proposedKey !== undefined &&
        dto.targetEntityId === proposedKey &&
        dto.targetEntityId !== NIL_UUID;
      const isGroupReservedCreateTarget =
        dto.action === 'CREATE' &&
        proposedKey !== undefined &&
        (ctx.group?.reservedEntities ?? []).some(
          (entity) =>
            entity.entityType === 'WORK_ITEM_TYPE' &&
            entity.entityId === dto.targetEntityId &&
            entity.workItemType === proposedKey,
        );

      if (
        dto.action === 'CREATE' &&
        proposedKey &&
        this.workItemTypeRegistry.isTypeActiveForProject(
          proposedKey,
          ctx.projectId,
        )
      ) {
        issues.push({
          field: `${prefix}.updates.key`,
          code: 'type_key_collision',
          reason: `A work-item type '${proposedKey}' already exists and is active in this project.`,
          layer: 'referential',
          suggestion:
            'Choose a distinct type key, or edit the existing type instead of creating a new one.',
        });
      } else if (
        dto.action === 'CREATE' &&
        retained?.status === WorkItemTypeLifecycleStatus.Archived
      ) {
        if (isStableKeyTarget && isDeepStrictEqual(retained.definition, def)) {
          // This is the one non-placeholder CREATE shape: approval restores
          // the retained project row in place.
        } else {
          issues.push({
            field: `${prefix}.updates.key`,
            code: isStableKeyTarget
              ? 'stale_work_item_type_definition'
              : 'archived_type',
            reason: isStableKeyTarget
              ? `The submitted definition for '${proposedKey}' does not exactly match the retained archived definition.`
              : `A retained archived work-item type '${proposedKey}' already occupies this project key.`,
            layer: 'referential',
            suggestion:
              'Read the archived project-owned definition again and submit it without changes, targeting the retained key.',
          });
        }
      } else if (
        dto.action === 'CREATE' &&
        dto.targetEntityId !== NIL_UUID &&
        !isGroupReservedCreateTarget
      ) {
        issues.push({
          field: `${prefix}.targetEntityId`,
          code: 'invalid_work_item_type_create_target',
          reason:
            'A non-placeholder work-item type CREATE target must name an archived project-owned definition.',
          layer: 'referential',
          suggestion:
            'Use the nil UUID for a new definition or the exact archived key for restoration.',
        });
      }

      const referencedKeys = [
        ...(def.allowedParentTypes ?? []),
        ...(def.edgeTargets ?? []).flatMap((t) => t.targetTypeKeys ?? []),
      ];
      const effectiveTypeKeys = this.workItemTypeRegistry.getActiveTypeKeys(
        ctx.projectId,
      );
      const validTypes = [...effectiveTypeKeys];
      for (const reservedKey of reservedWorkItemTypeKeys) {
        if (!validTypes.includes(reservedKey)) validTypes.push(reservedKey);
      }
      const flagged = new Set<string>();
      for (const refKey of referencedKeys) {
        if (refKey === proposedKey || flagged.has(refKey)) continue;
        if (reservedWorkItemTypeKeys.has(refKey)) continue;
        if (
          !this.workItemTypeRegistry.isTypeActiveForProject(
            refKey,
            ctx.projectId,
          )
        ) {
          flagged.add(refKey);
          issues.push({
            field: `${prefix}.updates`,
            code: 'unrecognized_type',
            reason:
              `'${refKey}' is not a usable type for this project. ` +
              `Valid types: ${validTypes.join(', ')}`,
            layer: 'referential',
            suggestion: `Reference only the project's active work-item types: ${validTypes.join(
              ', ',
            )}.`,
          });
        }
      }

      this.logger.debug(
        `WORK_ITEM_TYPE referential check for key '${proposedKey ?? '(missing)'}': ` +
          `${issues.length} issue(s) across ${referencedKeys.length} referenced key(s)`,
      );
    }

    // Non-CREATE lifecycle proposals use the registry key as their public
    // identity. Keep this server-side gate as well as the controller guard so
    // a proposal submitted through another boundary cannot target a missing,
    // foreign, or invalid lifecycle state. Stable-key CREATE restoration is
    // validated in the work-item-type branch above.
    if (dto.targetEntityType === 'WORK_ITEM_TYPE' && dto.action !== 'CREATE') {
      const isCanonicalReset =
        dto.updates !== null &&
        typeof dto.updates === 'object' &&
        (dto.updates as { resetToCanonical?: unknown }).resetToCanonical ===
          'RESET_TO_CANONICAL';
      const isCascadeDelete =
        dto.action === 'DELETE' &&
        isCascadeWorkItemTypeDeletePayload(dto.updates);
      const row = this.workItemTypeRegistry.getDefinition(
        ctx.projectId,
        dto.targetEntityId,
      );
      this.logger.debug('Resolved work-item type lifecycle validation target', {
        action: dto.action,
        typeKey: dto.targetEntityId,
        projectId: ctx.projectId,
        rowProjectId: row?.projectId ?? null,
        status: row?.status ?? null,
      });
      if (!row) {
        issues.push({
          field: `${prefix}.targetEntityId`,
          code: 'entity_not_found',
          reason: `WORK_ITEM_TYPE '${dto.targetEntityId}' is not available in this project.`,
          layer: 'referential',
          suggestion: 'Use a work-item type visible to this project.',
        });
      } else if (row.projectId !== ctx.projectId) {
        issues.push({
          field: `${prefix}.targetEntityId`,
          code: 'entity_not_found',
          reason: `WORK_ITEM_TYPE '${dto.targetEntityId}' is owned by a different project.`,
          layer: 'referential',
          suggestion: 'Use a retained work-item type owned by this project.',
        });
      } else if (isCanonicalReset) {
        if (row.effectiveSource !== 'CANONICAL_OVERRIDE') {
          issues.push({
            field: `${prefix}.targetEntityId`,
            code: 'canonical_override_required',
            reason: `Work-item type '${dto.targetEntityId}' is not a canonical override.`,
            layer: 'referential',
            suggestion: 'Reset only a customized canonical work-item type.',
          });
        }
      } else if (isCascadeDelete && row.effectiveSource !== 'PROJECT_CUSTOM') {
        issues.push({
          field: `${prefix}.targetEntityId`,
          code: 'canonical_type_read_only',
          reason: `Canonical work-item type '${dto.targetEntityId}' cannot be edited or hard-deleted.`,
          layer: 'referential',
          suggestion: 'Choose an archived project-defined custom type.',
        });
      } else if (
        row.effectiveSource === 'CANONICAL' &&
        (dto.updates as { acknowledgeCanonicalCustomization?: boolean })
          .acknowledgeCanonicalCustomization !== true
      ) {
        issues.push({
          field: `${prefix}.targetEntityId`,
          code: 'canonical_customization_acknowledgement_required',
          reason: `Canonical work-item type '${dto.targetEntityId}' requires explicit customization acknowledgement.`,
          layer: 'referential',
          suggestion:
            'Acknowledge that this change creates a project override.',
        });
      } else if (
        isCascadeDelete &&
        row.status !== WorkItemTypeLifecycleStatus.Archived
      ) {
        issues.push({
          field: `${prefix}.targetEntityId`,
          code: 'type_must_be_archived',
          reason: `Work-item type '${dto.targetEntityId}' must be archived before it can be hard-deleted.`,
          layer: 'referential',
          suggestion:
            'Archive the custom work-item type before requesting hard deletion.',
        });
      } else if (
        dto.action === 'DELETE' &&
        !isCascadeDelete &&
        row.status === WorkItemTypeLifecycleStatus.Archived
      ) {
        issues.push({
          field: `${prefix}.targetEntityId`,
          code: 'archived_type',
          reason: `Archived work-item type '${dto.targetEntityId}' cannot be archived again.`,
          layer: 'referential',
          suggestion:
            'Submit its complete retained definition to request restoration.',
        });
      } else if (
        dto.action === 'UPDATE' &&
        row.status === WorkItemTypeLifecycleStatus.Archived
      ) {
        const definition = (
          dto.updates as { definition: WorkItemTypeDefinitionDto }
        ).definition;
        if (!isDeepStrictEqual(row.definition, definition)) {
          this.logger.debug(
            'Rejected stale work-item type restoration target',
            {
              typeKey: dto.targetEntityId,
              projectId: ctx.projectId,
            },
          );
          issues.push({
            field: `${prefix}.updates.definition`,
            code: 'stale_work_item_type_definition',
            reason:
              `The submitted definition for '${dto.targetEntityId}' does not exactly match ` +
              'the retained archived definition.',
            layer: 'referential',
            suggestion:
              'Read the archived project-owned definition again and submit it without changes.',
          });
        }
      } else if (
        row.status !== WorkItemTypeLifecycleStatus.Active &&
        !isCascadeDelete
      ) {
        issues.push({
          field: `${prefix}.targetEntityId`,
          code: 'archived_type',
          reason: `Archived work-item type '${dto.targetEntityId}' cannot be edited or archived.`,
          layer: 'referential',
          suggestion: 'Choose an active custom work-item type.',
        });
      } else if (
        dto.action === 'UPDATE' &&
        row.status === WorkItemTypeLifecycleStatus.Active
      ) {
        const definition = (
          dto.updates as { definition: WorkItemTypeDefinitionDto }
        ).definition;
        const classification = classifyWorkItemTypeEdit(row, definition);
        if (classification.kind === 'unsupported') {
          issues.push({
            field: `${prefix}.updates.definition`,
            code: 'unsupported_work_item_type_edit',
            reason: classification.unsupportedReasons.join(' '),
            layer: 'referential',
            suggestion: classification.guidance,
          });
        }
      }
    }

    // For UPDATE/DELETE, verify the target entity exists. Work-item type
    // lifecycle proposals and entity prompt-template proposals are
    // key-addressed and are validated by their respective enactors rather
    // than through the entity registry.
    if (
      dto.action !== 'CREATE' &&
      dto.targetEntityType !== 'WORK_ITEM_TYPE' &&
      dto.targetEntityType !== 'ENTITY_PROMPT_TEMPLATE' &&
      !taskTargetWasPrechecked
    ) {
      const entityExists = await this.checkEntityExists(
        dto.targetEntityId,
        dto.targetEntityType,
        ctx.organizationId,
        ctx.projectId,
        db,
        ctx,
        metadata,
      );
      if (!entityExists) {
        issues.push({
          field: `${prefix}.targetEntityId`,
          code: 'entity_not_found',
          reason:
            `${dto.targetEntityType} ${dto.targetEntityId} ` +
            `not found in project ${ctx.projectId}`,
          layer: 'referential',
          suggestion:
            `Verify the ${dto.targetEntityType.toLowerCase()} exists ` +
            `and belongs to the specified project.`,
        });
      }
    }

    // Verify optional FK references in the DTO
    if (dto.conversationId) {
      const conv = await db.conversation.findFirst({
        where: { id: dto.conversationId },
        select: { id: true },
      });
      if (!conv) {
        issues.push({
          field: `${prefix}.conversationId`,
          code: 'entity_not_found',
          reason: `Conversation ${dto.conversationId} not found`,
          layer: 'referential',
        });
      }
    }

    if (dto.validationSessionId) {
      const session = await db.validationSession.findFirst({
        where: { id: dto.validationSessionId },
        select: { id: true },
      });
      if (!session) {
        issues.push({
          field: `${prefix}.validationSessionId`,
          code: 'entity_not_found',
          reason: `ValidationSession ${dto.validationSessionId} not found`,
          layer: 'referential',
        });
      }
    }

    // Check entity references within updates (e.g. assigneeId, parentTaskId)
    if (updates.assigneeId && typeof updates.assigneeId === 'string') {
      const user = await db.user.findFirst({
        where: { id: updates.assigneeId },
        select: { id: true },
      });
      if (!user) {
        issues.push({
          field: `${prefix}.updates.assigneeId`,
          code: 'entity_not_found',
          reason: `User ${updates.assigneeId} not found`,
          layer: 'referential',
          suggestion: 'Provide a valid user ID for the assignee.',
        });
      }
    }

    if (
      !taskParentageWasPrechecked &&
      !isWorkItemChangeSetPayload(dto.updates)
    ) {
      const parentageResult = await this.checkTaskParentage(
        dto,
        ctx.organizationId,
        ctx.projectId,
        db,
        ctx,
      );
      if (parentageResult.issue) {
        issues.push({
          field: `${prefix}.updates.parentTaskId`,
          code: parentageResult.issue.code,
          reason: parentageResult.issue.reason,
          layer: 'referential',
          suggestion: parentageResult.issue.suggestion,
        });
      }
    }

    if (updates.initiativeId && typeof updates.initiativeId === 'string') {
      const initiative = await db.initiative.findFirst({
        where: {
          id: updates.initiativeId,
          organizationId: ctx.organizationId,
          archivedAt: null,
        },
        select: { id: true },
      });
      if (!initiative) {
        issues.push({
          field: `${prefix}.updates.initiativeId`,
          code: 'entity_not_found',
          reason: `Initiative ${updates.initiativeId} not found`,
          layer: 'referential',
          suggestion: 'Verify the initiative exists and is not archived.',
        });
      }
    }

    return issues;
  }

  private async validateTaskServiceIds(
    dto: CreateProposalDto,
    ctx: ReferentialValidationContext,
    prefix: string,
    db: AnyTransactionClient,
  ): Promise<ProposalValidationIssue[]> {
    const updates = dto.updates as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(updates, 'serviceIds')) return [];

    const serviceIds = updates.serviceIds as string[];
    if (new Set(serviceIds).size !== serviceIds.length) {
      this.logger.warn(
        'Duplicate Service IDs accepted for work-item assignment',
        {
          field: `${prefix}.updates.serviceIds`,
          suppliedCount: serviceIds.length,
          duplicateCount: serviceIds.length - new Set(serviceIds).size,
        },
      );
    }

    let taskType: string;
    if (dto.action === 'CREATE') {
      if (typeof updates.type !== 'string') {
        throw new Error(
          'Structurally validated TASK CREATE proposal is missing its work-item type.',
        );
      }
      taskType = updates.type;
    } else {
      const task = await db.task.findFirst({
        where: {
          id: dto.targetEntityId,
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          archivedAt: null,
        },
        select: { type: true },
      });
      if (!task) return [];
      taskType = task.type;
    }
    if (
      !isWorkItemServiceScopeEligible(
        this.workItemTypeRegistry.getRulesForProject(taskType, ctx.projectId),
      )
    ) {
      return [
        {
          field: `${prefix}.updates.serviceIds`,
          code: 'invalid_field',
          reason: WORK_ITEM_SERVICE_SCOPE_INVALID_REASON,
          layer: 'referential',
          suggestion: WORK_ITEM_SERVICE_SCOPE_INVALID_SUGGESTION,
        },
      ];
    }

    const services = serviceIds.length
      ? await db.service.findMany({
          where: {
            id: { in: serviceIds },
            organizationId: ctx.organizationId,
            projectId: ctx.projectId,
            archivedAt: null,
          },
          select: { id: true },
        })
      : [];
    const validIds = new Set(
      services.map((service: { id: string }) => service.id),
    );
    const invalidIds = serviceIds.filter((id) => !validIds.has(id));
    const issues: ProposalValidationIssue[] = [];
    if (invalidIds.length > 0) {
      issues.push({
        field: `${prefix}.updates.serviceIds`,
        code: 'entity_not_found',
        reason: `serviceIds contains services outside this project: ${invalidIds.join(', ')}.`,
        layer: 'referential',
        suggestion: 'Use only active services belonging to this project.',
      });
    }

    const suppliedDescription = Array.isArray(updates.sections)
      ? (updates.sections as Array<{ key?: string; content?: string }>).find(
          (section) => section.key === 'description',
        )?.content
      : undefined;
    let body = suppliedDescription ?? '';
    if (dto.action === 'UPDATE' && suppliedDescription === undefined) {
      const currentDescription = await db.taskSection.findFirst({
        where: { taskId: dto.targetEntityId, key: 'description' },
        select: { materializedMarkdown: true },
      });
      body = currentDescription?.materializedMarkdown ?? '';
    }
    const mentionedIds = [
      ...new Set(
        extractMentions(body)
          .filter((mention) => mention.entityType.toUpperCase() === 'SERVICE')
          .map((mention) => mention.entityId),
      ),
    ];
    const omittedMentionIds = mentionedIds.filter(
      (id) => !serviceIds.includes(id),
    );
    if (omittedMentionIds.length > 0) {
      issues.push({
        field: `${prefix}.updates.serviceIds`,
        code: 'incomplete_service_scope',
        reason: `serviceIds omits explicitly mentioned services: ${omittedMentionIds.join(', ')}.`,
        layer: 'referential',
        suggestion:
          'Include every explicitly mentioned implementation service in the complete set.',
      });
    }
    return issues;
  }

  private async validateTaskSectionInputs(
    dto: CreateProposalDto,
    ctx: ReferentialValidationContext,
    prefix: string,
    db: AnyTransactionClient,
    parentageResult?: TaskParentageCheckResult,
  ): Promise<ProposalValidationIssue[]> {
    if (
      dto.targetEntityType !== 'TASK' ||
      dto.updates === null ||
      typeof dto.updates !== 'object'
    ) {
      return [];
    }

    const updates = dto.updates as Partial<CreateTaskDto & UpdateTaskDto>;
    const sections = Array.isArray(updates.sections) ? updates.sections : [];
    const hasParentTaskIdField =
      dto.action === 'UPDATE' &&
      Object.prototype.hasOwnProperty.call(updates, 'parentTaskId');
    const hasRequirementOpsField =
      dto.action === 'UPDATE' &&
      Object.prototype.hasOwnProperty.call(updates, 'requirementOps');
    const hasRequirementOps =
      dto.action === 'UPDATE' &&
      Array.isArray(updates.requirementOps) &&
      updates.requirementOps.length > 0;
    if (
      sections.length === 0 &&
      dto.action !== 'CREATE' &&
      !hasRequirementOpsField &&
      !hasParentTaskIdField
    ) {
      return [];
    }

    const targetType =
      parentageResult?.childType ??
      (await this.resolveTaskSectionValidationType(dto, updates, ctx, db));
    if (
      targetType === undefined ||
      !this.workItemTypeRegistry.isTypeActiveForProject(
        targetType,
        ctx.projectId,
      )
    ) {
      return [];
    }

    const issues: ProposalValidationIssue[] = [];
    if (
      dto.action === 'UPDATE' &&
      hasRequirementOpsField &&
      targetType !== WORK_ITEM_TYPE_KEYS.Feature
    ) {
      issues.push({
        field: `${prefix}.updates.requirementOps`,
        code: 'invalid_feature_requirement_operation',
        reason: 'requirementOps is only accepted for FEATURE tasks.',
        layer: 'referential',
        suggestion:
          'Use requirementOps only when updating a FEATURE task, or submit ordinary sections for this work-item type.',
      });
    }
    const hasRequirementsSection = sections.some(
      (section) => section?.key === 'requirements',
    );
    const hasInitialRequirementsField =
      dto.action === 'CREATE' &&
      Object.prototype.hasOwnProperty.call(updates, 'initialRequirements');
    if (
      targetType === WORK_ITEM_TYPE_KEYS.Feature &&
      hasRequirementsSection &&
      (hasInitialRequirementsField || hasRequirementOpsField)
    ) {
      const field = hasInitialRequirementsField
        ? 'initialRequirements'
        : 'requirementOps';
      issues.push({
        field: `${prefix}.updates.${field}`,
        code: 'feature_requirement_input_conflict',
        reason: `Provide FEATURE requirements through ${field} or sections[requirements], not both.`,
        layer: 'referential',
        suggestion:
          'Use exactly one FEATURE requirements authoring surface for this proposal.',
      });
    }
    const sectionDefinitions = this.workItemTypeRegistry.getSectionDefinitions(
      targetType,
      ctx.projectId,
    );
    const definitionsByKey = new Map(
      sectionDefinitions.map((section) => [section.key, section]),
    );

    let effectiveParentId: string | undefined;
    let workItemId: string | undefined;
    if (dto.action === 'CREATE') {
      effectiveParentId =
        typeof updates.parentTaskId === 'string'
          ? updates.parentTaskId
          : undefined;
    } else {
      workItemId = dto.targetEntityId;
      if (parentageResult?.childType !== undefined) {
        effectiveParentId = Object.prototype.hasOwnProperty.call(
          updates,
          'parentTaskId',
        )
          ? typeof updates.parentTaskId === 'string'
            ? updates.parentTaskId
            : undefined
          : (parentageResult.currentParentTaskId ?? undefined);
      } else {
        const currentTask = await db.task.findFirst({
          where: {
            id: dto.targetEntityId,
            organizationId: ctx.organizationId,
            projectId: ctx.projectId,
            archivedAt: null,
          },
          select: { parentTaskId: true },
        });
        effectiveParentId = Object.prototype.hasOwnProperty.call(
          updates,
          'parentTaskId',
        )
          ? typeof updates.parentTaskId === 'string'
            ? updates.parentTaskId
            : undefined
          : (currentTask?.parentTaskId ?? undefined);
      }
    }

    const appendFeatureRequirementDiagnostics = (
      field: string,
      result: Awaited<
        ReturnType<FeatureRequirementAuthoringService['validate']>
      >,
    ): void => {
      if (result.success) return;
      for (const diagnostic of result.diagnostics) {
        issues.push({
          field: `${prefix}.${field}.${diagnostic.field}`,
          code: `feature_requirement_${diagnostic.code}`,
          reason: diagnostic.message,
          layer: 'referential',
          suggestion:
            'Use a complete schema-backed FEATURE requirements collection with accessible same-project citations and the effective parent excluded.',
        });
      }
    };

    if (targetType === WORK_ITEM_TYPE_KEYS.Feature) {
      if (
        dto.action === 'CREATE' &&
        Array.isArray(updates.initialRequirements)
      ) {
        const prepared =
          await this.featureRequirementAuthoring().prepareInitialRequirements(
            updates.initialRequirements,
            { organizationId: ctx.organizationId, db },
          );
        if (!prepared.success) {
          for (const diagnostic of prepared.diagnostics) {
            issues.push({
              field: `${prefix}.updates.${diagnostic.field}`,
              code: `feature_requirement_${diagnostic.code}`,
              reason: diagnostic.message,
              layer: 'referential',
              suggestion:
                'Prepare the complete requirements collection before submitting the FEATURE proposal.',
            });
          }
        } else {
          appendFeatureRequirementDiagnostics(
            'updates.initialRequirements',
            await this.featureRequirementAuthoring().validate(
              prepared.section,
              {
                organizationId: ctx.organizationId,
                projectId: ctx.projectId,
                effectiveParentId,
                db,
              },
            ),
          );
        }
      }

      if (hasRequirementOps) {
        const requirementsSection = await db.taskSection.findFirst({
          where: { taskId: dto.targetEntityId, key: 'requirements' },
          select: { materializedMarkdown: true },
        });
        const prepared =
          await this.featureRequirementAuthoring().prepareRequirementOperations(
            requirementsSection?.materializedMarkdown,
            updates.requirementOps!,
            { organizationId: ctx.organizationId, db },
          );
        if (!prepared.success) {
          for (const diagnostic of prepared.diagnostics) {
            issues.push({
              field: `${prefix}.updates.${diagnostic.field}`,
              code: `feature_requirement_${diagnostic.code}`,
              reason: diagnostic.message,
              layer: 'referential',
              suggestion:
                'Use durable IDs from the current schema-backed requirements collection and apply operations in order.',
            });
          }
        } else {
          appendFeatureRequirementDiagnostics(
            'updates.requirementOps',
            await this.featureRequirementAuthoring().validate(
              prepared.section,
              {
                organizationId: ctx.organizationId,
                projectId: ctx.projectId,
                workItemId,
                effectiveParentId,
                db,
              },
            ),
          );
        }
      }

      if (
        dto.action === 'UPDATE' &&
        hasParentTaskIdField &&
        !hasRequirementsSection &&
        !hasRequirementOps
      ) {
        const existingRequirements = await db.taskSection.findFirst({
          where: { taskId: dto.targetEntityId, key: 'requirements' },
          select: { materializedMarkdown: true },
        });
        if (
          existingRequirements?.materializedMarkdown !== undefined &&
          existingRequirements.materializedMarkdown !== null
        ) {
          appendFeatureRequirementDiagnostics(
            'updates.parentTaskId',
            await this.featureRequirementAuthoring().validate(
              existingRequirements.materializedMarkdown,
              {
                organizationId: ctx.organizationId,
                projectId: ctx.projectId,
                workItemId,
                effectiveParentId,
                db,
              },
            ),
          );
        }
      }
    }

    for (const [index, section] of sections.entries()) {
      const sectionDefinition = definitionsByKey.get(section.key);
      if (!sectionDefinition) {
        issues.push({
          field: `${prefix}.updates.sections[${index}].key`,
          code: 'invalid_section',
          reason: `${section.key} is not a declared section for ${targetType}.`,
          layer: 'referential',
          suggestion: `Use one of ${targetType}'s declared sections: ${sectionDefinitions
            .map((definition) => definition.key)
            .join(', ')}.`,
        });
        continue;
      }

      const result = this.taskSectionSchemaValidators.validate(
        sectionDefinition,
        section.content,
      );
      if (!result.success) {
        const contentKind =
          resolveWorkItemSectionContentKind(sectionDefinition);
        const contentField = `${prefix}.updates.sections[${index}].content`;
        issues.push({
          field: fieldPath(contentField, result.path ?? []),
          code: result.code,
          reason:
            contentKind === 'json'
              ? `Invalid JSON section '${sectionDefinition.key}' (${sectionDefinition.schemaRef ?? 'missing schemaRef'}): ${result.message}`
              : result.message,
          layer: 'referential',
          suggestion:
            contentKind === 'json'
              ? 'Provide JSON content that matches the section schemaRef, or update the work-item type definition before writing this section.'
              : contentKind === 'html/css'
                ? 'Send exactly an object with string html and css fields.'
                : contentKind === 'structured-mockup'
                  ? STRUCTURED_MOCKUP_VALIDATION_SUGGESTION
                  : 'Send markdown section content as a string.',
        });
      }

      if (
        result.success &&
        sectionDefinition.schemaRef === PROJECT_MODE_SETTINGS_SCHEMA_REF
      ) {
        const settings = JSON.parse(
          result.canonicalContent,
        ) as ProjectModeSettings;
        const ineligible = findIneligibleProjectModeTypeKeys(
          settings,
          (typeKey) =>
            this.workItemTypeRegistry.isTypeActiveForProject(
              typeKey,
              ctx.projectId,
            ),
        );
        if (ineligible.length > 0) {
          issues.push({
            field: `${prefix}.updates.sections[${index}].content.eligibleWorkItemTypeKeys`,
            code: 'invalid_json_section',
            reason: `Eligible work-item type keys must be active in the project's effective registry: ${ineligible.join(', ')}.`,
            layer: 'referential',
            suggestion: `Use active effective work-item type keys: ${this.workItemTypeRegistry
              .getActiveTypeKeys(ctx.projectId)
              .join(', ')}.`,
          });
        }
      }

      if (
        targetType === WORK_ITEM_TYPE_KEYS.Feature &&
        section.key === 'requirements' &&
        result.success
      ) {
        appendFeatureRequirementDiagnostics(
          `updates.sections[${index}].content`,
          await this.featureRequirementAuthoring().validate(section.content, {
            organizationId: ctx.organizationId,
            projectId: ctx.projectId,
            workItemId,
            effectiveParentId,
            db,
          }),
        );
      }
    }

    return issues;
  }

  private async resolveTaskSectionValidationType(
    dto: CreateProposalDto,
    updates: Partial<CreateTaskDto & UpdateTaskDto>,
    ctx: ReferentialValidationContext,
    db: AnyTransactionClient,
  ): Promise<string | undefined> {
    if (dto.action === 'CREATE') {
      return typeof updates.type === 'string' && updates.type.length > 0
        ? updates.type
        : undefined;
    }

    const reservedTarget = ctx.group?.reservedEntities.find(
      (entity) =>
        entity.entityId === dto.targetEntityId && entity.entityType === 'TASK',
    );
    if (reservedTarget?.workItemType) {
      return reservedTarget.workItemType;
    }
    const task = await db.task.findFirst({
      where: {
        id: dto.targetEntityId,
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        archivedAt: null,
      },
      select: { type: true },
    });
    return task?.type;
  }

  private async validateTaskStatusUpdate(
    dto: CreateProposalDto,
    updates: Record<string, unknown>,
    ctx: ReferentialValidationContext,
    prefix: string,
    db: AnyTransactionClient,
  ): Promise<ProposalValidationIssue | null> {
    if (
      dto.action !== 'UPDATE' ||
      typeof updates.status !== 'string' ||
      isWorkItemChangeSetPayload(dto.updates)
    ) {
      return null;
    }

    const existingTask = await db.task.findFirst({
      where: {
        id: dto.targetEntityId,
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        archivedAt: null,
      },
      select: { type: true, status: true },
    });
    if (!existingTask || existingTask.status === updates.status) return null;

    const rules = this.workItemTypeRegistry.getRulesForProject(
      existingTask.type,
      ctx.projectId,
    );
    if (
      !rules ||
      rules.agentSettableStatuses.includes(updates.status as WorkStatus)
    ) {
      return null;
    }

    return {
      field: `${prefix}.updates.status`,
      code: 'status_not_allowed',
      reason: formatWorkItemStatusNotAllowedMessage(
        updates.status,
        existingTask.type,
        rules.agentSettableStatuses,
      ),
      layer: 'referential',
      suggestion:
        "Choose a status from the target work-item type's agent-settable status policy.",
    };
  }

  private async validateWorkflowFulfillmentTargets(
    updates: CreateTaskDto,
    ctx: ReferentialValidationContext,
    prefix: string,
    db: AnyTransactionClient,
  ): Promise<ProposalValidationIssue[]> {
    const targetIds = [
      ...new Set(
        (updates.workflowLinks ?? [])
          .filter((link) => link.type === 'FULFILLED_BY')
          .map((link) => link.targetTaskId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ] as TaskId[];
    if (targetIds.length === 0) {
      return [];
    }

    const tasks = await db.task.findMany({
      where: {
        id: { in: targetIds },
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        archivedAt: null,
      },
      select: { id: true },
    });
    const found = new Set(tasks.map((task: { id: string }) => task.id));
    for (const reserved of ctx.group?.reservedEntities ?? []) {
      if (reserved.entityType === 'TASK') {
        found.add(reserved.entityId);
      }
    }
    return targetIds
      .filter((id) => !found.has(id))
      .map((id) => ({
        field: `${prefix}.updates.workflowLinks`,
        code: 'entity_not_found',
        reason: `FULFILLED_BY target task ${id} was not found in this project`,
        layer: 'referential' as const,
        suggestion: 'Use an existing work item task ID for FULFILLED_BY links.',
      }));
  }

  /**
   * Same entity-existence logic as ProposalService.validateTargetEntity,
   * but returns a boolean instead of throwing.
   */
  private async checkEntityExists(
    targetEntityId: string,
    targetEntityType: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
    tx?: AnyTransactionClient,
    ctx?: ReferentialValidationContext,
    metadata?: ProposalReferenceMetadata,
  ): Promise<boolean> {
    const db = tx ?? this.prisma.db;
    if (
      ctx?.group?.reservedEntities.some(
        (entity) =>
          entity.entityId === targetEntityId &&
          entity.entityType === targetEntityType,
      )
    ) {
      return true;
    }
    if (metadata) {
      if (targetEntityType === 'TASK') {
        return metadata.taskRows.get(targetEntityId)?.projectId === projectId;
      }
      if (targetEntityType === 'DESIGN_DOC') {
        return metadata.designDocRows.has(targetEntityId);
      }
    }
    const baseWhere = {
      id: targetEntityId,
      organizationId,
      archivedAt: null,
    };

    switch (targetEntityType) {
      case 'TASK':
        return !!(await db.task.findFirst({
          where: { ...baseWhere, projectId },
          select: { id: true },
        }));
      case 'DESIGN_DOC':
        return !!(await db.designDoc.findFirst({
          where: baseWhere,
          select: { id: true },
        }));
      default:
        return false;
    }
  }

  // ── Layer 3: Permission ────────────────────────────────────────

  private validatePermissions(
    _dto: CreateProposalDto,
    ctx: ProposalValidationContext,
    index: number,
  ): ProposalValidationIssue[] {
    const prefix = `proposals[${index}]`;
    const issues: ProposalValidationIssue[] = [];

    const membership = ctx.requestor.orgMemberships?.find(
      (m) => m.orgId === ctx.organizationId,
    );

    if (!membership) {
      issues.push({
        field: prefix,
        code: 'no_org_membership',
        reason:
          `Requestor ${ctx.requestor.userId} is not a member of ` +
          `organization ${ctx.organizationId}`,
        layer: 'permission',
        suggestion: 'Ensure the requestor has been added to the organization.',
      });
      return issues;
    }

    if (!WRITE_ROLES.has(membership.role)) {
      issues.push({
        field: prefix,
        code: 'insufficient_role',
        reason:
          `Requestor role '${membership.role}' does not have write ` +
          `access. Required: OWNER, ADMIN, or MEMBER.`,
        layer: 'permission',
        suggestion:
          'Request elevated permissions or ask an org member to submit this proposal.',
      });
    }

    return issues;
  }
  private async validateFutureGraph(
    dto: CreateProposalDto,
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<void> {
    const mutation =
      dto.updates as import('src/generated').FutureRevisionMutation;
    if (mutation.operation !== 'REVISE') return;
    const before = futureGraph(mutation.baseline.content);
    const after = futureGraph(mutation.result);
    if (!before && !after && !mutation.graphChangeSet) return;
    if (!before || !after || !this.workItemChangeSetProjector)
      throw new BadRequestException(
        'A graph future requires complete baseline and result graphs.',
      );
    for (const projection of [before, after]) {
      if (
        projection.projectedRoot.identity.refType !== 'existing' ||
        projection.projectedRoot.identity.id !== dto.targetEntityId
      )
        throw new BadRequestException(
          'Future graph roots must match the proposal target.',
        );
    }
    if (!('type' in mutation.result))
      throw new BadRequestException(
        'Graph content requires a work-item target.',
      );
    for (const field of [
      'name',
      'status',
      'priority',
      'tag',
      'dueDate',
      'assigneeId',
    ] as const) {
      if (
        !isEqual(
          mutation.result[field] ?? null,
          after.projectedRoot[field] ?? null,
        )
      )
        throw new BadRequestException(
          `Future root field ${field} must match its graph projection.`,
        );
    }
    for (const section of mutation.result.sections) {
      const graphValue =
        after.projectedRoot.sections.find(
          (candidate) => candidate.key === section.key,
        )?.content ?? '';
      const value = sectionContent(
        section.materializedMarkdown,
        section.key,
        { result: mutation.result, projectId },
        this.workItemTypeRegistry,
      );
      if (!isEqual(value, graphValue === null ? '' : graphValue))
        throw new BadRequestException(
          `Future root section ${section.key} must match its graph projection.`,
        );
    }
    const request = graphChangeSet(before, after);
    assertFutureGraphBoundary(before, request);
    if (!isEqual(request, mutation.graphChangeSet))
      throw new BadRequestException(
        'Future graph operations must match the complete reviewed graph.',
      );
    const projected = await this.workItemChangeSetProjector.project({
      organizationId,
      projectId,
      request,
      basis: before,
      view: rootChildrenView,
    });
    if (
      !projected.valid ||
      this.reconciliation.decision({
        kind: 'graph',
        reviewed: after,
        current: projected,
      }).kind !== 'NOT_REQUIRED'
    )
      throw new BadRequestException({
        message:
          'Future graph does not match its validated complete projection.',
        issues: projected.issues,
      });
  }
}
