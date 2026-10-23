import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Context, Tool } from '@rekog/mcp-nest';
import type { Request } from 'express';
import { isEqual } from 'lodash';
import { z } from 'zod';
import type {
  CreateProposalDto,
  FutureRevisionAuthoring,
  FutureRevisionMutation,
  ProjectedWorkItemChangeSetIssue,
  ProposalGroupAuthoringMember,
  ProposalGroupAuthoringSnapshot,
  UpdateProposalDto,
  WorkItemChangeSetOperation,
  WorkItemChangeSetValidationRequest,
  WorkItemTypeGraphCapability,
  WorkItemUpdateOperation,
} from '../../generated';
import type { TaskSectionKey } from '../../generated/model/taskSectionKey';
import { ProposalEdgeEndpointMode } from '../../generated/model/proposalEdgeEndpointMode';
import { ProposalEdgeType } from '../../generated/model/proposalEdgeType';

import { PrismaService } from '../../prisma/prisma.service';
import { ProposalService } from '../../services/proposal/proposal.service';
import { ProposalGroupAuthoringService } from '../../services/proposal/proposal-group-authoring.service';
import { ORDINARY_PROPOSAL_VISIBILITY_WHERE } from '../../services/proposal/proposal-visibility';
import {
  rootChildrenView,
  WorkItemChangeSetProjectorService,
} from '../../services/proposal/work-item-change-set-projector.service';
import { createdProposalTargetType } from '../../services/proposal/proposal-validation.engine';
import type { StampedCreateProposalDto } from '../../services/proposal/proposal.types';
import { readFutureRevision } from '../../services/proposal/future-revision';
import { parseFutureRevisionAuthoring } from '../../services/proposal/future-revision-materializer';
import { TaskService } from '../../services/tasks/task.service';
import { FeatureRequirementAuthoringService } from '../../services/tasks/feature-requirement-authoring.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { resolveWorkItemSectionContentKind } from '../../services/tasks/task-section-schema-validator.registry';
import {
  validateWorkItemConfigForType,
  workItemConfigSchema,
} from '../../services/tasks/work-item-config';
import {
  featureRequirementInputSchema,
  featureRequirementOperationSchema,
  type LintWarning,
} from '../../services/tasks/feature-requirement-authoring.schemas';
import type {
  DesignDocId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from '../../types';
import { featureTagSchema } from '../../types/feature-tag.types';
import { foldImplementationIntoSections } from '../../utils/implementation-folding.util';
import { AGENT_EDGE_TYPES } from './agent-edge-vocabulary';
import { LintRecoveryStore } from './lint-recovery.store';
import { extractAuthContext, isAuthContext, mcpError } from './mcp-tool.utils';
import {
  blockingLintFindings,
  type LintFinding,
  type LintSection,
  lintFindingSchema,
  runProposalLint,
} from './proposal-lint';
import { lintProjectedTopology } from './proposal-topology-lint';
import { PROPOSAL_TOOL_NAMES } from './proposal-tool-names';
import {
  groupedAuthoringResultSchema,
  groupedBatchAuthoringResultSchema,
  invalidProposalChangeSetFromError,
  invalidProposalChangeSetOutputSchema,
  proposalGroupContextSchema,
  type ProposalGroupContext,
} from './proposal-group-tool.schemas';
import { validateProposalUpdateStatus } from './proposal-update-status-validator';
import { buildProvenanceEnvelope, influenceSchema } from './provenance';
import { extractRequestorContext } from './requestor-context';
import {
  GUIDANCE_TOKEN_FIELD,
  validateGuidanceToken,
} from './work-item-guidance-token';
import {
  AUTHORING_ROOT_PROOF_FIELD,
  topologyMutationRequested,
  validateAuthoringRootProof,
} from './authoring-guidance';
import {
  workItemChangeSetIdentitySchema,
  workItemChangeSetOperationSchema,
  workItemChangeSetValidationRequestSchema,
} from '../../services/proposal/work-item-change-set.schema';
import { LIFECYCLE_AWARE_TASK_EDIT_SAFETY_SUMMARY } from './tool-guidance';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const eli5Schema = z
  .string()
  .min(1)
  .max(150)
  .describe(
    'Required proposal-owned explanation that a reviewer can read at a glance (150 characters maximum).',
  );
const PLAN_CREATE_ROUTING_MESSAGE =
  'PLAN work items must be created through create_plan. Use create_plan for Plan intake; do not use create_work_item for Plan creation.';

export const CREATE_WORK_ITEM_TOOL_DESCRIPTION =
  'Propose a CREATE proposal for a work item of any type (STANDARD, FEATURE, GOAL, BUG, CONTRACT, DIAGRAM, DIAGRAM_ELEMENT, TASK_MONITOR, or project-defined custom types). Per-type rules — allowed sections, required fields, parentage, the feature-only tag, and Diagram graph payloads — are enforced from the central work-item type config. See get_tool_guidance({ toolName: "create_work_item", workItemType }) for the authoring conventions of the type you are creating. serviceIds is accepted when the project-effective type has registry role "work-item" and represents the complete known service scope.';

export const EDIT_WORK_ITEM_TOOL_DESCRIPTION =
  'Propose an UPDATE proposal for a work item of any type. The target\'s type is resolved server-side and that type\'s update rules — allowed sections, settable fields — are applied from the central work-item type config. See get_tool_guidance({ toolName: "edit_work_item", workItemType }) for the authoring conventions. ' +
  LIFECYCLE_AWARE_TASK_EDIT_SAFETY_SUMMARY +
  ' serviceIds is accepted when the project-effective type has registry role "work-item" and represents the complete known service scope.';

export const EDIT_TASKS_TOOL_DESCRIPTION =
  'Propose a batch of UPDATE proposals for tasks. See get_tool_guidance({ toolName: "edit_work_item" }) for the authoring conventions — the per-task discipline applies to every edit in the batch. ' +
  LIFECYCLE_AWARE_TASK_EDIT_SAFETY_SUMMARY +
  ' serviceIds is accepted for entries whose project-effective type has registry role "work-item" and represents the complete known service scope.';

// Work-item types whose `implementation` field folds into the description
// section. Create parity: the retired create_task folded for STANDARD only
// (no other type was creatable with the field). Edit parity: the retired
// edit_task reached both STANDARD and BUG targets.
const IMPLEMENTATION_FOLD_TYPES: Record<
  'create' | 'edit',
  ReadonlySet<string>
> = {
  create: new Set(['STANDARD']),
  edit: new Set(['STANDARD', 'BUG']),
};

// Shared `.describe()` text for the optional `implementation` field on
// create_work_item / edit_work_item / create_step / create_steps. The field is the
// dedicated home for file-level context; the handlers fold it into a
// trailing `## Implementation` block on the description rather than
// storing it as a raw update field. Exported so the plan-shaping tools
// can reuse the same agent-facing voice.
export const IMPLEMENTATION_FIELD_DESCRIBE =
  'Optional implementation context — the dedicated home for file-level ' +
  'detail: the relevant files, the patterns to follow, the APIs to call, ' +
  'and the architectural constraints that govern how this work is done. ' +
  'The tool folds this into a trailing `## Implementation` block on the ' +
  'task description, so keep this detail out of the description sections ' +
  'you pass directly and do not hand-write the heading yourself. Write it ' +
  'as markdown with real line breaks and a blank line between paragraphs; ' +
  'never type the two characters backslash and n as a stand-in for a ' +
  'newline, because they are stored and shown literally. Leave ' +
  'this empty only when there is genuinely no implementation context to ' +
  'offer.';

// Shared `.describe()` text for the optional `guidanceToken` field on
// create_work_item / edit_work_item. The token is issued by
// get_tool_guidance({ toolName, workItemType, projectId }) and proves the agent
// read the project-scoped per-type writing standards before authoring
// prose-quality fields. Required only when the payload carries a non-empty
// `sections` array or a non-empty `implementation` string; scalar-only edits
// stay token-free.
export const GUIDANCE_TOKEN_FIELD_DESCRIBE =
  'Proof-of-read token for the work-item authoring conventions. Obtain it ' +
  'from get_tool_guidance({ toolName, workItemType, projectId }) — it is ' +
  'returned alongside the project-scoped per-type writing standards. ' +
  'Required when this proposal ' +
  'carries prose-quality content: a non-empty sections array, a non-empty ' +
  'implementation string, or FEATURE requirement authoring (initialRequirements ' +
  'on create / requirementOps on edit). Optional for scalar-only changes ' +
  '(status, assignee, priority, parent, due date, tag). The token is scoped ' +
  'to the project and work-item type and covers both create and edit, so you ' +
  'only read the guidance once per type in that project.';

const AUTHORING_ROOT_PROOF_FIELD_DESCRIBE =
  `Reusable ${AUTHORING_ROOT_PROOF_FIELD} returned by get_authoring_guidance(). Required when this ` +
  'proposal carries a topology mutation such as hierarchy, typed edges, ' +
  'TRACKS, workflow graph fields, graph operations, or grouped authoring. ' +
  'It demonstrates that the shared topology guidance was read; it is not ' +
  'authorization and does not replace semantic validation.';

const taskSectionInputSchema = z.object({
  key: z.enum(['description', 'acceptanceCriteria']),
  content: z
    .string()
    .min(1)
    .describe(
      'Section content in markdown with real line breaks; never type the ' +
        'two characters backslash and n as a stand-in for a newline.',
    ),
  order: z.number().int().optional(),
});

const workItemSectionContentSchema = z
  .unknown()
  .refine((content) => content !== undefined, 'Section content is required.');

// Section keys are registry-defined and therefore an open string set. The
// generic create/edit handlers narrow them to the target type's declared
// sections at the boundary, so invalid keys still receive a type-specific
// error naming the allowed set.
const workItemSectionInputSchema = z.object({
  key: z.string().min(1),
  content: workItemSectionContentSchema,
  order: z.number().int().optional(),
});

const DIAGRAM_ELEMENT_LINK_EDGE_TYPES = [
  'RELATED_TO',
  'DEPENDS_ON',
  'DERIVES_FROM',
  'CONTRADICTS',
  'EVOLVES',
  'GUARANTEES',
  'IMPLEMENTS',
  'CONSUMES',
  'FULFILLED_BY',
  // Accepted only so admission can reject it with an element-named reason:
  // SUPERSEDES keeps its successor-authored supersede-transition path.
  'SUPERSEDES',
] as const;

// Deferred links persist as proposal edge declarations, whose wire vocabulary
// has no Contract-participation or FULFILLED_BY types.
const DEFERRED_DIAGRAM_ELEMENT_LINK_EDGE_TYPES: ReadonlySet<string> = new Set([
  'RELATED_TO',
  'DEPENDS_ON',
  'DERIVES_FROM',
  'CONTRADICTS',
  'EVOLVES',
]);

const diagramElementLinkInputSchema = z.object({
  edgeType: z
    .enum(DIAGRAM_ELEMENT_LINK_EDGE_TYPES)
    .describe(
      'Link type from this element. RELATED_TO, DERIVES_FROM, CONTRADICTS and EVOLVES are informational links (for example to a Mockup, design decision or Standard). GUARANTEES, IMPLEMENTS and CONSUMES record Contract participation and target a CONTRACT. FULFILLED_BY points at the work item that implements this element. Allowed target types come from the project registry; DEPENDS_ON is not a Contract-participation link, and SUPERSEDES is rejected.',
    ),
  targetEntityId: z
    .string()
    .uuid()
    .describe(
      'ID of an existing work item (TASK) or of a same-project CREATE proposal (PROPOSAL).',
    ),
  targetEntityType: z
    .enum(['TASK', 'PROPOSAL'])
    .describe(
      'TASK links to an existing work item and is created when the Diagram is approved. PROPOSAL links to a CREATE proposal from the same round and is created when that proposal is approved (RELATED_TO, DEPENDS_ON, DERIVES_FROM, CONTRADICTS and EVOLVES only).',
    ),
  description: z
    .string()
    .optional()
    .describe('Human-readable explanation of the link'),
});

type DiagramElementLinkParam = z.infer<typeof diagramElementLinkInputSchema>;

const diagramElementInputSchema = z.object({
  tempId: z
    .string()
    .min(1)
    .describe(
      'Proposal-local identity for this Diagram Element. Relationship and layout operations reference this value before approval materializes a real ID.',
    ),
  name: z.string().min(1).describe('Name/title for the Diagram Element'),
  sections: z
    .preprocess(repairSections, z.array(workItemSectionInputSchema).optional())
    .describe('Registry-declared sections for the Diagram Element.'),
  status: z
    .enum([
      'BACKLOG',
      'ACTIVE',
      'ON_HOLD',
      'VERIFYING',
      'COMPLETED',
      'CANCELLED',
      'ARCHIVED',
      'SUPERSEDED',
    ])
    .optional()
    .describe('Initial status for the Diagram Element'),
  priority: z
    .enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
    .optional()
    .describe('Priority for the Diagram Element'),
  dueDate: z.string().datetime().optional().describe('Due date for the step'),
  assigneeId: z
    .string()
    .uuid()
    .optional()
    .describe('User ID to assign the Diagram Element to'),
  serviceIds: z
    .array(z.string().uuid())
    .optional()
    .describe(
      'Complete known service scope for the Diagram Element. Omit when genuinely unknown.',
    ),
  edges: z
    .array(diagramElementLinkInputSchema)
    .max(50)
    .optional()
    .describe(
      "This element's links to the rest of the project: existing work items or same-round CREATE proposals. Declare every link from this element here; flow between elements (STANDARD, CONDITIONAL, LOOP) and layout stay in `operations`.",
    ),
});

type DiagramElementParam = z.infer<typeof diagramElementInputSchema>;

type CompiledDiagramElementLink = {
  elementIndex: number;
  linkIndex: number;
  element: DiagramElementParam;
  link: DiagramElementLinkParam;
  /** Present for existing-work-item targets. */
  operation?: Extract<
    WorkItemChangeSetOperation,
    { op: 'relationship.create' }
  >;
  /** Present for PROPOSAL targets; sourceRef is set here, never by the agent. */
  deferredEdge?: StoredProposalEdgeDeclaration;
};

type StoredProposalEdgeDeclaration = NonNullable<
  CreateProposalDto['edges']
>[number];

const diagramElementLinkField = (link: CompiledDiagramElementLink): string =>
  `diagramElements[${link.elementIndex}].edges[${link.linkIndex}]`;

const diagramElementLinkLabel = (link: CompiledDiagramElementLink): string =>
  `Diagram Element "${link.element.name}" link ${link.linkIndex} ` +
  `(${link.link.edgeType} to ${link.link.targetEntityType} ${link.link.targetEntityId})`;

/**
 * Compile per-element links into the two existing carriers: existing targets
 * become element-sourced relationship.create operations validated and
 * materialized with the change set; PROPOSAL targets become deferred outer
 * edges whose sourceRef is the element's temporary identity.
 */
export function compileDiagramElementLinks(
  elements: readonly DiagramElementParam[],
): CompiledDiagramElementLink[] {
  return elements.flatMap((element, elementIndex) =>
    (element.edges ?? []).map((link, linkIndex) => {
      const compiled: CompiledDiagramElementLink = {
        elementIndex,
        linkIndex,
        element,
        link,
      };
      const source = { refType: 'temporary' as const, tempId: element.tempId };
      if (link.targetEntityType === 'PROPOSAL') {
        compiled.deferredEdge = {
          targetEntityId: link.targetEntityId,
          targetEntityType: 'PROPOSAL',
          edgeType: link.edgeType as ProposalEdgeType,
          sourceRef: source,
          ...(link.description === undefined
            ? {}
            : { description: link.description }),
        };
      } else {
        compiled.operation = {
          op: 'relationship.create',
          ref: {
            refType: 'temporary',
            tempId: diagramElementLinkField(compiled),
          },
          source,
          target: { refType: 'existing', id: link.targetEntityId },
          edgeType: link.edgeType,
          category: 'meta',
          ...(link.description === undefined
            ? {}
            : { reasoning: link.description }),
        } as Extract<WorkItemChangeSetOperation, { op: 'relationship.create' }>;
      }
      return compiled;
    }),
  );
}

const ELEMENT_LINK_OPERATION_FIELD =
  /^(?:proposals\[\d+\]\.)?(?:updates\.)?operations(?:\[(\d+)\]|\.(\d+))(.*)$/;
const ELEMENT_LINK_EDGE_FIELD =
  /^(?:proposals\[\d+\]\.)?edges(?:\[(\d+)\]|\.(\d+))(.*)$/;
const ELEMENT_LINK_RELATIONSHIP_FIELD =
  /^relationships\.temporary:(diagramElements\[\d+\]\.edges\[\d+\])(.*)$/;
const ELEMENT_LINK_REFERENCE_FIELD = /^references\.([0-9a-f-]{36})(.*)$/i;

/**
 * Rewrite shared-admission findings on compiled carriers (operations[N],
 * edges[K], temporary relationship refs, dangling target references) to the
 * agent-authored `diagramElements[i].edges[j]` path and name the element.
 * Findings unrelated to element links pass through unchanged.
 */
export function remapDiagramElementLinkIssues(params: {
  issues: readonly ProjectedWorkItemChangeSetIssue[];
  links: readonly CompiledDiagramElementLink[];
  operations: readonly WorkItemChangeSetOperation[];
  outerEdgeCount: number;
}): ProjectedWorkItemChangeSetIssue[] {
  const linkByField = new Map(
    params.links.map((link) => [diagramElementLinkField(link), link]),
  );
  const deferredLinks = params.links.filter((link) => link.deferredEdge);
  const relationshipSuffix = (suffix: string) =>
    suffix.replace(/^\.target\b/, '.targetEntityId');

  const locate = (
    field: string,
  ): { link: CompiledDiagramElementLink; suffix: string } | undefined => {
    const operationMatch = ELEMENT_LINK_OPERATION_FIELD.exec(field);
    if (operationMatch) {
      const operation =
        params.operations[Number(operationMatch[1] ?? operationMatch[2])];
      const link =
        operation?.op === 'relationship.create' &&
        operation.ref.refType === 'temporary'
          ? linkByField.get(operation.ref.tempId)
          : undefined;
      return link
        ? { link, suffix: relationshipSuffix(operationMatch[3] ?? '') }
        : undefined;
    }
    const edgeMatch = ELEMENT_LINK_EDGE_FIELD.exec(field);
    if (edgeMatch) {
      const link =
        deferredLinks[
          Number(edgeMatch[1] ?? edgeMatch[2]) - params.outerEdgeCount
        ];
      return link ? { link, suffix: edgeMatch[3] ?? '' } : undefined;
    }
    const relationshipMatch = ELEMENT_LINK_RELATIONSHIP_FIELD.exec(field);
    if (relationshipMatch) {
      const link = linkByField.get(relationshipMatch[1]!);
      return link
        ? { link, suffix: relationshipSuffix(relationshipMatch[2] ?? '') }
        : undefined;
    }
    const referenceMatch = ELEMENT_LINK_REFERENCE_FIELD.exec(field);
    if (referenceMatch) {
      const link = params.links.find(
        (candidate) =>
          candidate.operation &&
          candidate.link.targetEntityId === referenceMatch[1],
      );
      return link ? { link, suffix: '.targetEntityId' } : undefined;
    }
    return undefined;
  };

  return params.issues.map((issue) => {
    const located = locate(issue.field);
    if (!located) return issue;
    return {
      ...issue,
      field: `${diagramElementLinkField(located.link)}${located.suffix}`,
      reason: `${diagramElementLinkLabel(located.link)}: ${issue.reason}`,
    };
  });
}

const designDocSectionInputSchema = z.object({
  key: z
    .string()
    .min(1)
    .describe('Section key (e.g. context, decision, status)'),
  content: z.string().optional().describe('Section content in markdown'),
  order: z.number().int().nullable().optional().describe('Display order'),
});

/**
 * Repair sections when an LLM serializes the array to a JSON string
 * instead of passing a native array (common with smaller models).
 */
function repairSections(value: unknown): unknown[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    // Strip trailing .toString()" artifacts that some models append
    let cleaned = value.trim();
    if (cleaned.endsWith('.toString()"')) {
      cleaned = cleaned.slice(0, cleaned.lastIndexOf('].toString()"')) + ']';
    }
    try {
      const parsed: unknown = JSON.parse(cleaned);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through
    }
  }
  return value as unknown[];
}

const updateTaskFields = {
  name: z.string().min(1).optional().describe('New name/title for the task'),
  sections: z
    .preprocess(repairSections, z.array(taskSectionInputSchema).optional())
    .describe(
      'Updated task sections. Allowed keys: description, ' +
        'acceptanceCriteria. See get_tool_guidance({ toolName: ' +
        '"edit_work_item", workItemType: "STANDARD" }) for the authoring ' +
        'conventions. ' +
        LIFECYCLE_AWARE_TASK_EDIT_SAFETY_SUMMARY,
    ),
  status: z
    .enum([
      'BACKLOG',
      'ACTIVE',
      'ON_HOLD',
      'VERIFYING',
      'COMPLETED',
      'CANCELLED',
      'ARCHIVED',
    ])
    .optional()
    .describe('New status for the task'),
  priority: z
    .enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
    .optional()
    .describe('New priority level'),
  dueDate: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .describe('New due date; omission preserves, explicit null clears'),
  assigneeId: z
    .string()
    .uuid()
    .optional()
    .describe('User ID to assign the task to'),
  parentTaskId: z
    .string()
    .uuid()
    .optional()
    .describe('New parent task ID for hierarchy changes'),
  sectionUpdateSource: z
    .enum(['USER', 'AGENT_SUGGESTED'])
    .optional()
    .describe('Source of the section update'),
  serviceIds: z
    .array(z.string().uuid())
    .optional()
    .describe(
      'For work-item types (registry role "work-item") only: complete replacement service set. Omit to preserve existing assignments; an empty array clears them.',
    ),
};

const UPDATE_TASK_KEYS = Object.keys(updateTaskFields);

// ---------------------------------------------------------------------------
// Generic work-item authoring surface. A single create/edit schema covers
// every WorkItemTypeKey; the per-type rules — allowed sections, required scalars,
// parentage, the feature-only tag — are enforced at the handler boundary
// against WORK_ITEM_TYPE_CONFIG rather than baked into per-type schemas,
// so adding a type is a config edit, not a new tool.
// ---------------------------------------------------------------------------

export const workItemTypeSchema = z
  .string()
  .min(1)
  .describe(
    'Work-item type key to author — a built-in (STANDARD, FEATURE, GOAL, ' +
      'BUG, CONTRACT, DIAGRAM, DIAGRAM_ELEMENT, TASK_MONITOR, MODE) or any ' +
      'project-defined type active in this project. The type is ' +
      'resolved against the project-scoped registry at the handler boundary, ' +
      "not constrained to a fixed set here. Fetch the type's sections, " +
      'required fields, parentage, and writing standards via ' +
      'get_tool_guidance({ toolName: "create_work_item", workItemType }).',
  );

const createWorkItemFields = {
  name: z.string().min(1).describe('Name/title for the new work item'),
  sections: z
    .preprocess(repairSections, z.array(workItemSectionInputSchema).optional())
    .describe(
      'Work-item sections. Allowed keys depend on the work-item type — ' +
        'see get_tool_guidance({ toolName: "create_work_item", ' +
        'workItemType }) for the per-type contract.',
    ),
  priority: z
    .enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
    .optional()
    .describe('Priority level'),
  dueDate: z
    .string()
    .datetime()
    .optional()
    .describe(
      'Optional due date (ISO 8601 datetime). Omission creates an undated ' +
        'Goal unless project-effective required scalar rules require a date.',
    ),
  assigneeId: z
    .string()
    .uuid()
    .optional()
    .describe('User ID to assign the work item to'),
  parentTaskId: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Parent feature or task ID for hierarchy. Required when type is ' +
        'STANDARD or BUG — both must belong to a parent (feature or task). ' +
        "A bug's scope can span features, but it must still be parented " +
        'in the graph. Not accepted when type is GOAL (goals are top-level ' +
        'by definition; use TRACKS edges to associate work with a goal).',
    ),
  serviceIds: z
    .array(z.string().uuid())
    .optional()
    .describe(
      'For work-item types (registry role "work-item") only: complete known implementation-service set. Omit when genuinely unknown; an empty array asserts a known empty set.',
    ),
  tag: featureTagSchema
    .optional()
    .describe(
      'Coarse-grained classification of what a feature delivers. Required ' +
        'when type is FEATURE; rejected for every other type. Allowed ' +
        'values: product (user-facing product capability), frontend ' +
        '(client/UI delivery), backend (server/API/data), infra (platform, ' +
        'deployment, observability), design (design-system or UX research), ' +
        'AI (AI/agent-shaped delivery: prompts, agent orchestration, ' +
        'runners). Pick the tag that best matches the feature in its ' +
        'hierarchy and parent path; the user can override it before ' +
        'approval.',
    ),
  config: workItemConfigSchema
    .nullable()
    .optional()
    .describe(
      'Optional typed launch defaults. The project-effective work-item type ' +
        'definition must explicitly accept the config kind; do not infer ' +
        'eligibility from the type key, role, or capabilities. INITIAL_WORKTREE ' +
        'carries an optional initial branch and does not create a checkout ' +
        'during work-item creation.',
    ),
};

const CREATE_WORK_ITEM_KEYS = Object.keys(createWorkItemFields);

// Update surface: shares the edit_tasks field bundle, widens `sections`
// to the cross-type superset, and adds the feature-only `tag`. The
// handler narrows both to the target's type from the central config.
const { sections: _omittedUpdateSections, ...baseUpdateWorkItemFields } =
  updateTaskFields;
const updateWorkItemFields = {
  ...baseUpdateWorkItemFields,
  sections: z
    .preprocess(repairSections, z.array(workItemSectionInputSchema).optional())
    .describe(
      "Updated work-item sections. Allowed keys depend on the target's " +
        'type — see get_tool_guidance({ toolName: "edit_work_item", ' +
        'workItemType }) for the per-type contract. ' +
        LIFECYCLE_AWARE_TASK_EDIT_SAFETY_SUMMARY,
    ),
  tag: featureTagSchema
    .optional()
    .describe(
      'Updated coarse-grained classification. Only valid when the target ' +
        'is a FEATURE (allowed values: product, frontend, backend, infra, ' +
        'design, AI). Omit to leave the existing tag unchanged.',
    ),
};

const UPDATE_WORK_ITEM_KEYS = Object.keys(updateWorkItemFields);

const proposalEdgeDeclarationObjectSchema = z.object({
  targetEntityId: z
    .string()
    .uuid()
    .describe(
      'ID of the target of the edge. When targetEntityType is TASK or ' +
        'DESIGN_DOC, this must be the id of an existing entity. When ' +
        'targetEntityType is PROPOSAL, this must identify an existing ' +
        'proposal in the same organization and project.',
    ),
  targetEntityType: z
    .enum(['TASK', 'DESIGN_DOC', 'PROPOSAL'])
    .describe(
      'Kind of thing the edge points at. Use TASK or DESIGN_DOC to link to ' +
        'an already-materialized entity (the edge is created immediately on ' +
        'approval). PROPOSAL targets use endpointMode to choose durable ' +
        'proposal identity or deferred entity materialization.',
    ),
  endpointMode: z
    .nativeEnum(ProposalEdgeEndpointMode)
    .optional()
    .describe(
      'Omitted or ENTITY creates entity relationships on approval. For Diagram proposals, deferred outer edges may target only a same-project CREATE proposal that is not rejected. PROPOSAL requires a PROPOSAL target in the same organization/project and retains both proposal identities, even if the target is undecided or rejected. It does not impose an enactment prerequisite.',
    ),
  sourceRef: workItemChangeSetIdentitySchema
    .optional()
    .describe(
      'Optional source for a deferred ENTITY-mode link to a PROPOSAL target in a Diagram proposal. Use { refType: "temporary", tempId } for an element created in this change set or { refType: "existing", id } for an element in the projected Diagram. Omit to source the Diagram root. Not valid for TASK/DESIGN_DOC targets or durable endpointMode PROPOSAL links.',
    ),
  targetEntityTitle: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Optional snapshot of the target entity title. The server fills this ' +
        'in from the EntityRegistry when omitted (for TASK and DESIGN_DOC ' +
        'targets); durable PROPOSAL mode snapshots the proposal title at authoring.',
    ),
  edgeType: z
    .enum(AGENT_EDGE_TYPES)
    .describe(
      'Relationship type, drawn from the canonical agent edge vocabulary ' +
        `(${AGENT_EDGE_TYPES.join(', ')}): RELATED_TO is an informational ` +
        'link; DEPENDS_ON means this entity cannot proceed until the ' +
        'target is done; DERIVES_FROM means this entity was created based ' +
        'on the target; CONTRADICTS means the entities conflict. ' +
        'SUPERSEDES is accepted here even though raw create_edge rejects ' +
        'it — on create_work_item/edit_work_item proposals, point it at ' +
        'the predecessor work item being replaced; on approval, the server ' +
        'sets that predecessor to SUPERSEDED and writes the successor edge ' +
        'through the supersede transition, not through a raw edge write.',
    ),
  description: z
    .string()
    .optional()
    .describe('Human-readable explanation of the relationship'),
});

const validateProposalEdgeDeclaration = (
  edge: Pick<
    z.infer<typeof proposalEdgeDeclarationObjectSchema>,
    'targetEntityType' | 'endpointMode' | 'sourceRef'
  >,
  ctx: z.RefinementCtx,
) => {
  if (edge.sourceRef !== undefined && edge.targetEntityType !== 'PROPOSAL') {
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
};

const proposalEdgeDeclarationSchema =
  proposalEdgeDeclarationObjectSchema.superRefine(
    validateProposalEdgeDeclaration,
  );

// create_work_item never accepts an agent-authored sourceRef: Diagram
// Element links are declared on the element and compiled server-side, so
// outer edges on a create always start from the new work item itself.
const createProposalEdgeDeclarationSchema = proposalEdgeDeclarationObjectSchema
  .omit({ sourceRef: true })
  .strict();

type ProposalEdgeDeclarationParam = z.infer<
  typeof proposalEdgeDeclarationSchema
>;

// --- Cite-fulfillment Zod schemas (FEATURE requirements ops) ---

// --------------------------------------------------------

export const createWorkItemParameters = z.object({
  groupContext: proposalGroupContextSchema.optional(),
  eli5: eli5Schema,
  authoringRootProof: z
    .string()
    .optional()
    .describe(AUTHORING_ROOT_PROOF_FIELD_DESCRIBE),
  type: workItemTypeSchema,
  reason: z
    .string()
    .optional()
    .describe('Why this work item is being proposed'),
  influences: z
    .array(influenceSchema)
    .max(100)
    .optional()
    .describe(
      'Entities that influenced this proposal. Each entry declares ' +
        'the entity ID, reason type (explicit_mention, implied, derived), ' +
        'and a brief reasoning explanation.',
    ),
  generatedWithVersion: z
    .string()
    .max(255)
    .optional()
    .describe('Model or tool version used to generate this proposal'),
  edges: z
    .array(createProposalEdgeDeclarationSchema)
    .max(50)
    .optional()
    .describe(
      "Declared relationships from the new work item. Explicit endpointMode PROPOSAL retains source and target proposal identities regardless of review outcome. Omitted or ENTITY mode creates entity relationships on approval and defers PROPOSAL targets until approved. For a Diagram, these link the whole Diagram (for example to a same-project CREATE proposal); declare each Diagram Element's own links in `diagramElements[].edges`.",
    ),
  tracks: z
    .object({
      sourceEntityId: z
        .string()
        .uuid()
        .describe(
          'Existing work-item id that will originate TRACKS to the newly created item.',
        ),
    })
    .strict()
    .optional()
    .describe(
      'Optional compound TRACKS attachment for the newly created work item. ' +
        'The source work-item type and allowed target types are resolved from ' +
        'the central registry before any proposal is persisted. Use ' +
        'attach_to_goal when the target work item already exists.',
    ),
  ...createWorkItemFields,
  // Declared on createWorkItemParameters directly — not on the shared
  // createWorkItemFields bundle — so it never leaks into key-copy loops:
  // the handler folds it into the description section instead of storing
  // it as a raw update field.
  implementation: z.string().optional().describe(IMPLEMENTATION_FIELD_DESCRIBE),
  // Declared on createWorkItemParameters directly — not on the shared
  // createWorkItemFields bundle — so it never enters the CREATE_WORK_ITEM_KEYS
  // key-copy loop. The handler validates it and never stores it as a field.
  guidanceToken: z.string().optional().describe(GUIDANCE_TOKEN_FIELD_DESCRIBE),
  // Declared directly here (not in createWorkItemFields) so it never enters
  // the CREATE_WORK_ITEM_KEYS key-copy loop.  FEATURE only.
  initialRequirements: z
    .array(featureRequirementInputSchema)
    .optional()
    .describe(
      'Initial requirement records for a FEATURE work item. Each entry carries ' +
        'the requirement statement, an optional group label using letters, ' +
        'digits, spaces, and hyphens, and optional cite slots (designedBy, ' +
        'fulfilledBy, contracts). ' +
        'designedBy cites Design Docs, Mockups or Diagrams. ' +
        'Fulfillment may cite Features, eligible work items, Plans or Diagram Elements. Legacy workflow identities are supported during the Diagram transition. ' +
        'The server mints durable UUID IDs and stores ' +
        'the reviewed collection as canonical JSON in the requirements section — do not pass a requirements ' +
        'section via sections[] alongside this field.',
    ),
  operations: z
    .array(workItemChangeSetOperationSchema)
    .optional()
    .describe(
      'Canonical complete Diagram creation change set. Include the DIAGRAM root workItem.create operation, every DIAGRAM_ELEMENT, section, flow relationship, and layout operation in one reviewable payload. Optional groups and boundaries are a `section.replace` of the root\'s `diagramGroups` section whose members use `{ kind: "temporaryWorkItem", temporaryRef }` for new elements. An element\'s links to the rest of the project belong in `diagramElements[].edges`.',
    ),
  layoutBoundary: z
    .array(workItemChangeSetIdentitySchema)
    .optional()
    .describe(
      'Complete set of work-item identities expected in the new Diagram layout.',
    ),
  diagramElements: z
    .array(diagramElementInputSchema)
    .optional()
    .describe(
      "Canonical initial Diagram Elements for a DIAGRAM compound CREATE. Each tempId becomes the temporary work-item identity used by flow relationship and layout operations; every element is validated and materialized as a DIAGRAM_ELEMENT under the new Diagram. Declare each element's links to existing work items or same-round CREATE proposals in its `edges`.",
    ),
});

export const editWorkItemParameters = z.object({
  groupContext: proposalGroupContextSchema.optional(),
  eli5: eli5Schema,
  authoringRootProof: z
    .string()
    .optional()
    .describe(AUTHORING_ROOT_PROOF_FIELD_DESCRIBE),
  targetEntityId: z.string().uuid().describe('ID of the work item to edit'),
  reason: z.string().optional().describe('Why this change is being proposed'),
  influences: z
    .array(influenceSchema)
    .max(100)
    .optional()
    .describe(
      'Entities that influenced this proposal. Each entry declares ' +
        'the entity ID, reason type (explicit_mention, implied, derived), ' +
        'and a brief reasoning explanation.',
    ),
  generatedWithVersion: z
    .string()
    .max(255)
    .optional()
    .describe('Model or tool version used to generate this proposal'),
  edges: z
    .array(proposalEdgeDeclarationSchema)
    .max(50)
    .optional()
    .describe(
      'Declared relationships. Explicit endpointMode PROPOSAL retains proposal identities independently of approval. Omitted or ENTITY mode materializes entity relationships on approval, including atomic SUPERSEDES transitions. Diagram proposals may use deferred links to same-project CREATE proposal targets and may identify a Diagram Element source with sourceRef; omit sourceRef to use the Diagram root. Links to existing entities stay in graph operations.',
    ),
  operations: z
    .array(workItemChangeSetOperationSchema)
    .optional()
    .describe(
      'Generic graph change-set operations. Existing identities use ' +
        '`{ refType: "existing", id }`; newly-created work items and ' +
        'relationships use proposal-scoped temporary identities. Graph ' +
        'relationships to existing entities stay in operations. Outer edges ' +
        'can declare durable PROPOSAL links; Diagram proposals can also ' +
        'declare deferred ENTITY links to CREATE proposals, using sourceRef ' +
        'for a Diagram Element source or omitting it for the Diagram root. ' +
        'Diagram groups are edited by replacing the complete `diagramGroups` ' +
        'section; this never moves saved element positions.',
    ),
  layoutBoundary: z
    .array(workItemChangeSetIdentitySchema)
    .optional()
    .describe(
      'Complete set of work-item identities expected in the graph layout. ' +
        'Supplying this field selects graph editing. Graph relationships to ' +
        'existing entities stay in operations. Outer edges can declare ' +
        'durable PROPOSAL links; Diagram proposals can also declare deferred ' +
        'ENTITY links to CREATE proposals, with sourceRef identifying an ' +
        'element source or omitted to use the Diagram root.',
    ),
  textReplacement: z
    .object({
      sectionKey: z.string().min(1),
      find: z.string().min(1),
      replace: z.string(),
    })
    .strict()
    .optional()
    .describe(
      'Replace exactly one literal occurrence in a registry-declared Markdown section. ' +
        'The server resolves this against the current canonical section and persists only the complete resulting section content.',
    ),
  ...updateWorkItemFields,
  // Declared on editWorkItemParameters directly — not on the shared
  // updateWorkItemFields bundle — so it stays out of the edit_tasks batch
  // schema and the key-copy loop; the handler folds it into the
  // description section.
  implementation: z.string().optional().describe(IMPLEMENTATION_FIELD_DESCRIBE),
  // Declared on editWorkItemParameters directly — not on the shared
  // updateWorkItemFields bundle — so it stays out of the UPDATE_WORK_ITEM_KEYS
  // key-copy loop. The handler validates it and never stores it as a field.
  guidanceToken: z.string().optional().describe(GUIDANCE_TOKEN_FIELD_DESCRIBE),
  // Declared directly here (not in updateWorkItemFields) so it stays out of
  // the UPDATE_WORK_ITEM_KEYS loop.  FEATURE only.
  requirementOps: z
    .array(featureRequirementOperationSchema)
    .optional()
    .describe(
      "Patch ops applied to a FEATURE work item's requirements section. " +
        'Ops are applied in order. Each op is one of: ' +
        '`add` (append or insert a new requirement), ' +
        '`update` (modify the statement text, group label, or slot cites — group labels use letters, digits, spaces, and hyphens; changing the text preserves the durable ID), ' +
        '`delete` (remove a requirement by durable ID). ' +
        'Do not also pass a requirements section via sections[] when using this field.',
    ),
});

export const createWorkItemOutput = z.discriminatedUnion('status', [
  invalidProposalChangeSetOutputSchema,
  z.object({
    status: z.literal('needs_revision'),
    lintFindings: z
      .array(lintFindingSchema)
      .min(1)
      .describe(
        'Lint findings blocking persistence. The agent must revise the ' +
          'content and call create_work_item again.',
      ),
  }),
  z.object({
    status: z.literal('proposed'),
    lintFindings: z
      .array(lintFindingSchema)
      .describe('Advisory warnings; these do not block persistence.'),
    proposalId: z.string().describe('Persisted proposal ID'),
    action: z.string().describe('Proposal action (CREATE)'),
    targetEntityType: z.string().describe('Target entity type (TASK)'),
    targetEntityId: z
      .string()
      .describe('Placeholder ID for the work item to be created'),
    fields: z
      .array(z.string())
      .describe('List of fields included in the proposal'),
    createdAt: z.string().describe('When the proposal was created'),
    mintedRequirementIds: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Durable UUID → original statement map for requirements minted ' +
          'from initialRequirements. Present only when initialRequirements ' +
          'was supplied. Use these IDs in requirementOps on subsequent edits.',
      ),
    requirementLintFindings: z
      .array(z.object({ id: z.string(), message: z.string() }))
      .optional()
      .describe(
        'Non-blocking warnings from initial requirement preparation, such as a record with no citations.',
      ),
    groupedAuthoring: groupedAuthoringResultSchema.optional(),
  }),
]);

type CreateWorkItemOutput = z.infer<typeof createWorkItemOutput>;

const editEntrySchema = z.object({
  taskId: z.string().uuid().describe('ID of the task to edit'),
  eli5: eli5Schema,
  ...updateTaskFields,
  // Declared directly on the entry — not in updateTaskFields — so it never
  // enters the UPDATE_TASK_KEYS key-copy loop. The token is per-entry because
  // each entry targets its own task, whose type (STANDARD or BUG) is resolved
  // server-side; a batch can mix types, and each token is scoped to the
  // request project plus that entry's type.
  guidanceToken: z.string().optional().describe(GUIDANCE_TOKEN_FIELD_DESCRIBE),
});

const MAX_BATCH_SIZE = 50;

export const editTasksParameters = z.object({
  groupContext: proposalGroupContextSchema.optional(),
  authoringRootProof: z
    .string()
    .optional()
    .describe(AUTHORING_ROOT_PROOF_FIELD_DESCRIBE),
  edits: z
    .array(editEntrySchema)
    .min(1)
    .max(MAX_BATCH_SIZE)
    .refine(
      (edits) => new Set(edits.map((e) => e.taskId)).size === edits.length,
      { message: 'Duplicate taskId values are not allowed' },
    )
    .describe(
      'Array of task edits to propose as a batch. For entries whose effective type has registry role "work-item", apply the canonical section-edit policy to `sections` and check status before editing section content.',
    ),
  influences: z
    .array(influenceSchema)
    .max(100)
    .optional()
    .describe(
      'Entities that influenced this batch of proposals. Shared ' +
        'across all edits in the batch.',
    ),
  generatedWithVersion: z
    .string()
    .max(255)
    .optional()
    .describe('Model or tool version used to generate these proposals'),
});

const editTasksOutputEntry = z.object({
  id: z.string().describe('Proposal ID'),
  status: z.string().describe('Proposal status (e.g. DRAFT)'),
  action: z.string().describe('Proposal action (UPDATE)'),
  targetEntityType: z.string().describe('Target entity type (TASK)'),
  targetEntityId: z.string().describe('ID of the task being edited'),
  modifiedFields: z.array(z.string()).describe('List of fields being modified'),
  createdAt: z.string().describe('When the proposal was created'),
});

export const editTasksOutput = z.object({
  proposals: z.array(editTasksOutputEntry),
  groupedAuthoring: groupedBatchAuthoringResultSchema.optional(),
});

const editTasksResultOutput = z.union([
  invalidProposalChangeSetOutputSchema,
  editTasksOutput,
]);

type EditTasksOutput = z.infer<typeof editTasksResultOutput>;

// Server-resolved work-item type, echoed on every edit_work_item response.
// The target's type is looked up from the entity, never from the caller, so
// this field is authoritative — an agent holding a wrong belief about what
// it is editing gets corrected even when the call succeeds.
const resolvedWorkItemTypeField = z
  .string()
  .describe(
    'Work-item type key of the target — a built-in (STANDARD, FEATURE, ' +
      'GOAL, BUG) or a project-defined type — resolved server-side from the ' +
      'entity. Authoritative — if it differs from what you assumed, update ' +
      'your understanding of the target.',
  );

export const editWorkItemOutput = z.discriminatedUnion('status', [
  invalidProposalChangeSetOutputSchema.extend({
    workItemType: resolvedWorkItemTypeField,
  }),
  z.object({
    status: z.literal('needs_revision'),
    workItemType: resolvedWorkItemTypeField,
    lintFindings: z
      .array(lintFindingSchema)
      .min(1)
      .describe(
        'Lint findings blocking persistence. The agent must revise the ' +
          'content and call edit_work_item again.',
      ),
  }),
  z.object({
    status: z.literal('proposed'),
    workItemType: resolvedWorkItemTypeField,
    lintFindings: z
      .array(lintFindingSchema)
      .describe('Advisory warnings; these do not block persistence.'),
    proposalId: z.string().describe('Persisted proposal ID'),
    action: z.string().describe('Proposal action (UPDATE)'),
    targetEntityType: z.string().describe('Target entity type (TASK)'),
    targetEntityId: z.string().describe('ID of the work item being edited'),
    modifiedFields: z
      .array(z.string())
      .describe('List of fields being modified'),
    createdAt: z.string().describe('When the proposal was created'),
    requirementLintFindings: z
      .array(z.object({ id: z.string(), message: z.string() }))
      .optional()
      .describe(
        'Non-blocking warnings from requirementOps processing — e.g. ' +
          'requirements that have no fulfillment cites after the patch. ' +
          'Present only when requirementOps was supplied and warnings exist. ' +
          'These do NOT block the proposal from being persisted.',
      ),
    mintedRequirementIds: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Durable UUID → statement map for requirements added by requirementOps. ' +
          'Present when requirementOps was supplied so later operations can ' +
          'address the exact reviewed IDs.',
      ),
    groupedAuthoring: groupedAuthoringResultSchema.optional(),
  }),
]);

type EditWorkItemOutput = z.infer<typeof editWorkItemOutput>;

const createDesignDocFields = {
  name: z.string().min(1).describe('Name/title for the design document'),
  content: z
    .string()
    .min(1)
    .describe(
      'Full brainstorm body as a single markdown string. Stored as the ' +
        "sole `content` section of the document's BRAINSTORM template — " +
        'the tool does not accept arbitrary section keys.',
    ),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
  summary: z
    .string()
    .optional()
    .describe('Optional short summary of the document'),
  parentEntityId: z
    .string()
    .uuid()
    .optional()
    .describe(
      'UUID of the entity that owns this design document (a Task or another Design Doc). Set together with parentEntityType.',
    ),
  parentEntityType: z
    .enum(['TASK', 'DESIGN_DOC'])
    .optional()
    .describe(
      'Type of the owning entity. Required when parentEntityId is provided.',
    ),
};

export const createDesignDocParameters = z.object({
  groupContext: proposalGroupContextSchema.optional(),
  eli5: eli5Schema,
  authoringRootProof: z
    .string()
    .optional()
    .describe(AUTHORING_ROOT_PROOF_FIELD_DESCRIBE),
  reason: z
    .string()
    .optional()
    .describe('Why this design document is being proposed'),
  influences: z
    .array(influenceSchema)
    .max(100)
    .optional()
    .describe(
      'Entities that influenced this proposal. Each entry declares ' +
        'the entity ID, reason type (explicit_mention, implied, derived), ' +
        'and a brief reasoning explanation.',
    ),
  generatedWithVersion: z
    .string()
    .max(255)
    .optional()
    .describe('Model or tool version used to generate this proposal'),
  ...createDesignDocFields,
});

export const createDesignDocOutput = z.discriminatedUnion('status', [
  invalidProposalChangeSetOutputSchema,
  z.object({
    status: z.literal('needs_revision'),
    lintFindings: z
      .array(lintFindingSchema)
      .min(1)
      .describe(
        'Lint findings blocking persistence. The agent must revise the ' +
          'content and call create_design_doc again.',
      ),
  }),
  z.object({
    status: z.literal('proposed'),
    lintFindings: z
      .array(lintFindingSchema)
      .describe('Advisory warnings; these do not block persistence.'),
    proposalId: z.string().describe('Persisted proposal ID'),
    action: z.string().describe('Proposal action (CREATE)'),
    targetEntityType: z.string().describe('Target entity type (DESIGN_DOC)'),
    targetEntityId: z
      .string()
      .describe('Placeholder ID for the design document to be created'),
    fields: z
      .array(z.string())
      .describe('List of fields included in the proposal'),
    createdAt: z.string().describe('When the proposal was created'),
    groupedAuthoring: groupedAuthoringResultSchema.optional(),
  }),
]);

type CreateDesignDocOutput = z.infer<typeof createDesignDocOutput>;

const updateDesignDocFields = {
  name: z.string().min(1).optional().describe('Updated name/title'),
  template: z
    .enum(['ADR', 'DECISION', 'BRAINSTORM', 'PLAN_DOCUMENT'])
    .optional()
    .describe(
      'Updated template structure (ADR, DECISION, BRAINSTORM, PLAN_DOCUMENT)',
    ),
  sections: z
    .preprocess(repairSections, z.array(designDocSectionInputSchema).optional())
    .describe('Updated sections for the document'),
  tags: z.array(z.string()).optional().describe('Updated tags'),
  summary: z.string().nullable().optional().describe('Updated summary'),
  parentEntityId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe(
      'New parent entity UUID. Pair with parentEntityType to move the document; pair both with null to clear the parent.',
    ),
  parentEntityType: z
    .enum(['TASK', 'DESIGN_DOC'])
    .nullable()
    .optional()
    .describe(
      'Type of the new parent entity. Required whenever parentEntityId is provided.',
    ),
  sectionUpdateSource: z
    .enum(['USER', 'AGENT_SUGGESTED'])
    .optional()
    .describe('Source of the section update'),
};

const UPDATE_DESIGN_DOC_KEYS = Object.keys(updateDesignDocFields);

export const editDesignDocParameters = z.object({
  groupContext: proposalGroupContextSchema.optional(),
  eli5: eli5Schema,
  authoringRootProof: z
    .string()
    .optional()
    .describe(AUTHORING_ROOT_PROOF_FIELD_DESCRIBE),
  targetEntityId: z
    .string()
    .uuid()
    .describe('ID of the design document to edit'),
  reason: z.string().optional().describe('Why this change is being proposed'),
  influences: z
    .array(influenceSchema)
    .max(100)
    .optional()
    .describe(
      'Entities that influenced this proposal. Each entry declares ' +
        'the entity ID, reason type (explicit_mention, implied, derived), ' +
        'and a brief reasoning explanation.',
    ),
  generatedWithVersion: z
    .string()
    .max(255)
    .optional()
    .describe('Model or tool version used to generate this proposal'),
  ...updateDesignDocFields,
});

export const editDesignDocOutput = z.discriminatedUnion('status', [
  invalidProposalChangeSetOutputSchema,
  z.object({
    status: z.literal('needs_revision'),
    lintFindings: z
      .array(lintFindingSchema)
      .min(1)
      .describe(
        'Lint findings blocking persistence. The agent must revise the ' +
          'content and call edit_design_doc again.',
      ),
  }),
  z.object({
    status: z.literal('proposed'),
    lintFindings: z
      .array(lintFindingSchema)
      .describe('Advisory warnings; these do not block persistence.'),
    proposalId: z.string().describe('Persisted proposal ID'),
    action: z.string().describe('Proposal action (UPDATE)'),
    targetEntityType: z.string().describe('Target entity type (DESIGN_DOC)'),
    targetEntityId: z
      .string()
      .describe('ID of the design document being edited'),
    modifiedFields: z
      .array(z.string())
      .describe('List of fields being modified'),
    createdAt: z.string().describe('When the proposal was created'),
    groupedAuthoring: groupedAuthoringResultSchema.optional(),
  }),
]);

type EditDesignDocOutput = z.infer<typeof editDesignDocOutput>;

// The FutureRevisionAuthoring contract is a deep oneOf generated from OpenAPI;
// it is validated in the handler with the generated JSON schema rather than
// mirrored in zod, so there is a single validator.
export const proposeFutureRevisionParameters = z.object({
  groupContext: proposalGroupContextSchema.optional(),
  eli5: eli5Schema,
  authoringRootProof: z
    .string()
    .optional()
    .describe(AUTHORING_ROOT_PROOF_FIELD_DESCRIBE),
  guidanceToken: z.string().optional().describe(GUIDANCE_TOKEN_FIELD_DESCRIBE),
  targetEntityType: z
    .enum(['TASK', 'DESIGN_DOC'])
    .describe(
      'TASK for a Feature, Contract, Diagram or Mockup; DESIGN_DOC for a Design Doc',
    ),
  targetEntityId: z
    .string()
    .uuid()
    .describe('ID of the Feature, Contract, Diagram, Mockup or Design Doc'),
  mutation: z
    .record(z.string(), z.unknown())
    .describe(
      'FutureRevisionAuthoring: { operation: "REVISE", futureId, ' +
        'expectedRevision, baseline?, changes, dependencies? } where changes ' +
        'uses the edit_work_item or edit_design_doc change shape, or { ' +
        'operation: "CANCEL", futureId, expectedRevision }. The server reads ' +
        'the baseline and stores the complete result. See ' +
        'get_tool_guidance({ toolName: "propose_future_revision" }).',
    ),
  reason: z.string().optional().describe('Why this change is being proposed'),
  influences: z
    .array(influenceSchema)
    .max(100)
    .optional()
    .describe(
      'Entities that influenced this proposal. Each entry declares ' +
        'the entity ID, reason type (explicit_mention, implied, derived), ' +
        'and a brief reasoning explanation.',
    ),
  generatedWithVersion: z
    .string()
    .max(255)
    .optional()
    .describe('Model or tool version used to generate this proposal'),
});

export const proposeFutureRevisionOutput = z.discriminatedUnion('status', [
  invalidProposalChangeSetOutputSchema,
  z.object({
    status: z.literal('proposed'),
    proposalId: z.string().describe('Persisted proposal ID'),
    futureId: z.string().describe('Stable future identity'),
    operation: z.enum(['REVISE', 'CANCEL']),
    targetEntityType: z.enum(['TASK', 'DESIGN_DOC']),
    targetEntityId: z.string(),
    createdAt: z.string().describe('When the proposal was created'),
    groupedAuthoring: groupedAuthoringResultSchema.optional(),
  }),
]);

type ProposeFutureRevisionOutput = z.infer<typeof proposeFutureRevisionOutput>;

const proposalUpdatesSchema = z
  .object({
    name: z.string().min(1).optional().describe('Updated name/title'),
    sections: z
      .preprocess(
        repairSections,
        z
          .array(
            z.object({
              key: z.string().min(1),
              content: workItemSectionContentSchema.optional(),
              order: z.number().int().nullable().optional(),
            }),
          )
          .optional(),
      )
      .describe('Updated sections array'),
    status: z
      .string()
      .optional()
      .describe(
        'Updated entity status. Valid values depend on the proposal' +
          "'s targetEntityType: for TASK/FEATURE proposals use the " +
          'task user-settable subset (BACKLOG, ACTIVE, ON_HOLD, ' +
          'VERIFYING, COMPLETED, CANCELLED, ARCHIVED); for DESIGN_DOC ' +
          'use AdrStatus values (e.g. REFINING_CONTENT, IN_REVIEW, ' +
          'READY). Plan and Stage work items use TASK statuses. ' +
          'Never use proposal-lifecycle states ' +
          '(APPROVED/REJECTED) here.',
      ),
    priority: z.string().optional().describe('Updated priority level'),
    dueDate: z
      .string()
      .datetime()
      .nullable()
      .optional()
      .describe('Updated due date; omission preserves, null clears'),
    assigneeId: z.string().uuid().optional().describe('Updated assignee'),
    parentTaskId: z.string().uuid().optional().describe('Updated parent task'),
    serviceIds: z
      .array(z.string().uuid())
      .optional()
      .describe(
        'For work-item types whose registry role is "work-item": complete replacement service set. Omit to preserve existing assignments; an empty array clears them.',
      ),
    template: z.string().optional().describe('Design doc template'),
    tags: z.array(z.string()).optional().describe('Updated tags'),
    summary: z.string().optional().describe('Updated summary'),
  })
  .describe(
    'The proposed changes to store. Shape matches the target entity ' +
      'update DTO (e.g. name, sections, status, priority for tasks).',
  );

export const updateProposalParameters = z.object({
  groupContext: proposalGroupContextSchema.optional(),
  eli5: eli5Schema.optional(),
  authoringRootProof: z
    .string()
    .optional()
    .describe(AUTHORING_ROOT_PROOF_FIELD_DESCRIBE),
  proposalId: z.string().uuid().describe('ID of the proposal to update'),
  updates: proposalUpdatesSchema.optional(),
  reason: z.string().optional().describe('Why this update is being made'),
  influences: z
    .array(influenceSchema)
    .max(100)
    .optional()
    .describe(
      'Entities that influenced this proposal. Each entry declares ' +
        'the entity ID, reason type (explicit_mention, implied, derived), ' +
        'and a brief reasoning explanation.',
    ),
  generatedWithVersion: z
    .string()
    .max(255)
    .optional()
    .describe('Model or tool version used to generate this proposal'),
});

const updatedProposalOutput = z.object({
  status: z.string().describe('Current proposal status'),
  id: z.string().describe('Proposal ID'),
  action: z.string().describe('Proposal action (CREATE, UPDATE, DELETE)'),
  targetEntityType: z
    .string()
    .describe('Target entity type (TASK, DESIGN_DOC)'),
  targetEntityId: z.string().describe('ID of the target entity'),
  updatedAt: z.string().describe('When the proposal was last updated'),
  groupedAuthoring: groupedAuthoringResultSchema.optional(),
});

export const updateProposalOutput = z.union([
  invalidProposalChangeSetOutputSchema,
  updatedProposalOutput,
]);

type UpdateProposalOutput = z.infer<typeof updateProposalOutput>;

export const deleteProposalParameters = z.object({
  proposalId: z.string().uuid().describe('ID of the proposal to delete'),
});

export const deleteProposalOutput = z.object({
  deleted: z.literal(true).describe('Whether the proposal was deleted'),
  proposalId: z.string().uuid().describe('ID of the deleted proposal'),
});

type DeleteProposalOutput = z.infer<typeof deleteProposalOutput>;

export const getProposalParameters = z.object({
  proposalId: z.string().uuid().describe('ID of the proposal to fetch'),
});

export const getProposalOutput = z.object({
  edges: z
    .array(
      proposalEdgeDeclarationObjectSchema
        .extend({ edgeType: z.nativeEnum(ProposalEdgeType) })
        .superRefine(validateProposalEdgeDeclaration),
    )
    .optional(),
  id: z.string().describe('Proposal ID'),
  status: z.string().describe('Proposal status (DRAFT, APPROVED, or REJECTED)'),
  action: z.string().describe('Proposal action (CREATE, UPDATE, or DELETE)'),
  targetEntityType: z
    .string()
    .describe(
      'Target entity type (TASK, DESIGN_DOC, etc.). Plan and Stage work items use TASK.',
    ),
  targetEntityId: z
    .string()
    .describe(
      'ID of the target entity. For APPROVED proposals, this reflects the ' +
        'materialized entity ID assigned at enactment time — which may differ ' +
        'from any placeholder/handle ID carried on the DRAFT proposal.',
    ),
  conversationId: z
    .string()
    .optional()
    .describe('Conversation the proposal is scoped to, if any'),
  createdAt: z.string().describe('When the proposal was created'),
  updatedAt: z.string().describe('When the proposal was last updated'),
});

type GetProposalOutput = z.infer<typeof getProposalOutput>;

export const getFutureRevisionParameters = z.object({
  futureId: z.string().uuid().describe('Identity of the future to read'),
});

// FutureRevisionResponse is generated from OpenAPI; it is returned as-is
// rather than mirrored in zod so there is a single contract.
export const getFutureRevisionOutput = z.object({
  future: z.record(z.string(), z.unknown()),
});

type GetFutureRevisionOutput = z.infer<typeof getFutureRevisionOutput>;

/**
 * Convert a raw input sections array (the agent-authored shape, before
 * any server-side folding) into lint-ready sections. Lint always runs
 * on what the agent wrote — not on the post-folded body — so the
 * `## Implementation` block appended by `foldImplementationIntoSections`
 * never counts toward the paragraph budget.
 */
function paramsToLintSections(
  rawSections: ReadonlyArray<{ key: string; content?: unknown }> | undefined,
): LintSection[] {
  return (rawSections ?? []).map((s) => ({
    key: s.key,
    content: typeof s.content === 'string' ? s.content : undefined,
  }));
}

function recoveryKey(
  tool: string,
  userId: string,
  scope: string | undefined,
): string {
  return `${tool}::${userId}::${scope ?? ''}`;
}

type GraphAction = WorkItemTypeGraphCapability['supportedActions'][number];

function graphIssue(
  field: string,
  code: string,
  reason: string,
): ProjectedWorkItemChangeSetIssue {
  return { field, code, reason, layer: 'permission' };
}

/**
 * Gate authoring affordances before projection. The projector remains the
 * authority for complete-state endpoint, metadata, and layout validation;
 * this check prevents an MCP caller from invoking actions the resolved type
 * does not expose in the first place.
 */
export function validateGraphOperationsAgainstCapability(params: {
  graph: WorkItemTypeGraphCapability;
  operations: readonly WorkItemChangeSetOperation[];
}): ProjectedWorkItemChangeSetIssue[] {
  const issues: ProjectedWorkItemChangeSetIssue[] = [];
  const supported = new Set<GraphAction>(params.graph.supportedActions);

  const requireAction = (
    action: GraphAction,
    operationIndex: number,
    operation: WorkItemChangeSetOperation,
  ) => {
    if (!supported.has(action)) {
      issues.push(
        graphIssue(
          `operations.${operationIndex}`,
          'unsupported_graph_action',
          `${operation.op} requires graph action ${action}, which this work-item type does not support.`,
        ),
      );
    }
  };

  params.operations.forEach((operation, operationIndex) => {
    switch (operation.op) {
      case 'workItem.create':
        requireAction('createNode', operationIndex, operation);
        if (operation.status === 'SUPERSEDED') {
          issues.push(
            graphIssue(
              `operations.${operationIndex}.status`,
              'supersede_transition_required',
              'SUPERSEDED is assigned only by approval of a successor-authored SUPERSEDES proposal edge.',
            ),
          );
        }
        break;
      case 'workItem.update':
        requireAction('updateNode', operationIndex, operation);
        if (operation.status === 'SUPERSEDED') {
          issues.push(
            graphIssue(
              `operations.${operationIndex}.status`,
              'supersede_transition_required',
              'SUPERSEDED is assigned only by approval of a successor-authored SUPERSEDES proposal edge.',
            ),
          );
        }
        break;
      case 'section.replace':
      case 'section.clear':
        requireAction('updateNode', operationIndex, operation);
        break;
      case 'workItem.delete':
        requireAction('deleteNode', operationIndex, operation);
        break;
      case 'relationship.create':
        requireAction('createRelationship', operationIndex, operation);
        if (operation.edgeType === 'SUPERSEDES') {
          issues.push(
            graphIssue(
              `operations.${operationIndex}.edgeType`,
              'supersede_transition_required',
              'SUPERSEDES must be declared as a successor-authored proposal edge so approval can atomically transition the predecessor.',
            ),
          );
          break;
        }
        if (
          !params.graph.editableRelationships.some(
            (declaration) =>
              declaration.edgeType === operation.edgeType &&
              (operation.category === undefined ||
                declaration.category === operation.category),
          )
        ) {
          issues.push(
            graphIssue(
              `operations.${operationIndex}.edgeType`,
              'relationship_not_editable',
              `${operation.edgeType} is not declared as an editable relationship for this graph.`,
            ),
          );
        }
        break;
      case 'relationship.update': {
        const reconnects =
          operation.source !== undefined ||
          operation.sourceEntityType !== undefined ||
          operation.target !== undefined ||
          operation.targetEntityType !== undefined;
        const updatesFields = Object.keys(operation).some(
          (key) =>
            ![
              'op',
              'ref',
              'source',
              'sourceEntityType',
              'target',
              'targetEntityType',
            ].includes(key),
        );
        if (reconnects) {
          requireAction('reconnectRelationship', operationIndex, operation);
        }
        if (updatesFields || !reconnects) {
          requireAction('updateRelationship', operationIndex, operation);
        }
        if (operation.edgeType === 'SUPERSEDES') {
          issues.push(
            graphIssue(
              `operations.${operationIndex}.edgeType`,
              'supersede_transition_required',
              'SUPERSEDES must be declared as a successor-authored proposal edge so approval can atomically transition the predecessor.',
            ),
          );
          break;
        }
        if (
          operation.edgeType !== undefined &&
          !params.graph.editableRelationships.some(
            (declaration) =>
              declaration.edgeType === operation.edgeType &&
              (operation.category === undefined ||
                declaration.category === operation.category),
          )
        ) {
          issues.push(
            graphIssue(
              `operations.${operationIndex}.edgeType`,
              'relationship_not_editable',
              `${operation.edgeType} is not declared as an editable relationship for this graph.`,
            ),
          );
        }
        break;
      }
      case 'relationship.delete':
        requireAction('deleteRelationship', operationIndex, operation);
        break;
      case 'layout.replace':
        requireAction('replaceLayout', operationIndex, operation);
        break;
      case 'layout.clear':
        requireAction('clearLayout', operationIndex, operation);
        break;
    }
  });

  return issues;
}

@Injectable()
export class ProposalToolsProvider {
  private readonly logger = new Logger(ProposalToolsProvider.name);

  constructor(
    private readonly proposalService: ProposalService,
    private readonly taskService: TaskService,
    private readonly lintRecovery: LintRecoveryStore,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
    private readonly prisma: PrismaService,
    private readonly workItemChangeSetProjector?: WorkItemChangeSetProjectorService,
    @Optional()
    private readonly proposalGroupAuthoringService?: ProposalGroupAuthoringService,
    @Optional()
    private readonly featureRequirementAuthoringService?: FeatureRequirementAuthoringService,
  ) {}

  private featureRequirementAuthoring(): FeatureRequirementAuthoringService {
    return (
      this.featureRequirementAuthoringService ??
      new FeatureRequirementAuthoringService(this.workItemTypeRegistry)
    );
  }

  private requirementPreparationError(
    field: string,
    result: Awaited<
      ReturnType<
        FeatureRequirementAuthoringService['prepareInitialRequirements']
      >
    >,
  ): CallToolResult | null {
    if (result.success) return null;
    return mcpError(
      `${field} validation failed:\n${result.diagnostics
        .map((diagnostic) => `  ${diagnostic.field}: ${diagnostic.message}`)
        .join('\n')}`,
    );
  }

  private requireGroupAuthoringService(): ProposalGroupAuthoringService {
    if (!this.proposalGroupAuthoringService) {
      throw new Error('Proposal-group authoring service is not configured');
    }
    return this.proposalGroupAuthoringService;
  }

  private async validateProposalStatusUpdate(args: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    targetEntityId: string;
    targetEntityType: string;
    status: string;
  }) {
    let configuredStatuses: ReadonlyArray<string> | undefined;
    if (args.targetEntityType === 'TASK') {
      const task = await this.prisma.db.task.findFirst({
        where: {
          id: args.targetEntityId,
          organizationId: args.organizationId,
          projectId: args.projectId,
          archivedAt: null,
        },
        select: { type: true },
      });
      configuredStatuses = task
        ? this.workItemTypeRegistry.getAgentSettableStatuses(
            task.type,
            args.projectId,
          )
        : undefined;
    }
    return validateProposalUpdateStatus(
      args.targetEntityType,
      args.status,
      configuredStatuses,
    );
  }

  private async persistProposal(args: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    dto: StampedCreateProposalDto;
    groupContext?: ProposalGroupContext;
    tool: string;
  }) {
    if (!args.groupContext) {
      const proposal = await this.proposalService.create(
        args.organizationId,
        args.projectId,
        args.userId,
        args.dto,
      );
      return { proposal };
    }

    const snapshot = await this.requireGroupAuthoringService().addMember(
      args.organizationId,
      args.projectId,
      args.groupContext.groupId,
      args.userId,
      {
        expectedRevision: args.groupContext.expectedRevision,
        proposal: args.dto,
      },
    );
    const member = snapshot.members.at(-1);
    if (!member) {
      throw new Error('Persisted proposal-group member was not returned');
    }
    const row = await this.prisma.db.proposalGroupMember.findFirst({
      where: {
        id: member.memberId,
        groupId: args.groupContext.groupId,
      },
      select: {
        proposal: {
          select: {
            id: true,
            status: true,
            action: true,
            targetEntityType: true,
            targetEntityId: true,
            updates: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!row) {
      throw new Error('Persisted proposal-group member could not be re-read');
    }
    const proposal = {
      ...row.proposal,
      createdAt: row.proposal.createdAt.toISOString(),
      updatedAt: row.proposal.updatedAt.toISOString(),
    };
    const groupedAuthoring = this.toGroupedAuthoring(snapshot, member);
    this.logger.log('MCP routed proposal authoring through explicit group', {
      tool: args.tool,
      organizationId: args.organizationId,
      projectId: args.projectId,
      groupId: args.groupContext.groupId,
      expectedRevision: args.groupContext.expectedRevision,
      returnedRevision: snapshot.currentRevision,
      memberId: member.memberId,
      proposalId: proposal.id,
      action: proposal.action,
      returnedTargetIdentity:
        member.reservedEntityId ?? proposal.targetEntityId,
      identityDecision:
        proposal.action === 'CREATE'
          ? 'reserved_create_entity_id'
          : 'existing_target_entity_id',
    });
    return { proposal, groupedAuthoring };
  }

  private async persistProposalBatch(args: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    dtos: StampedCreateProposalDto[];
    groupContext?: ProposalGroupContext;
    tool: string;
  }) {
    if (!args.groupContext) {
      const proposals = await this.proposalService.createBatch(
        args.organizationId,
        args.projectId,
        args.userId,
        args.dtos,
      );
      return { proposals };
    }

    const snapshot = await this.requireGroupAuthoringService().addMembers(
      args.organizationId,
      args.projectId,
      args.groupContext.groupId,
      args.userId,
      args.groupContext.expectedRevision,
      args.dtos,
    );
    const members = snapshot.members.slice(-args.dtos.length);
    const rows = await this.prisma.db.proposalGroupMember.findMany({
      where: {
        groupId: args.groupContext.groupId,
        id: { in: members.map((member) => member.memberId) },
      },
      select: {
        id: true,
        proposal: {
          select: {
            id: true,
            status: true,
            action: true,
            targetEntityType: true,
            targetEntityId: true,
            updates: true,
            createdAt: true,
          },
        },
      },
    });
    const rowByMemberId = new Map(rows.map((row) => [row.id, row.proposal]));
    const proposals = members.map((member) => {
      const proposal = rowByMemberId.get(member.memberId);
      if (!proposal) {
        throw new Error(
          `Persisted proposal-group member ${member.memberId} could not be re-read`,
        );
      }
      return {
        ...proposal,
        createdAt: proposal.createdAt.toISOString(),
      };
    });
    const groupedAuthoring = {
      groupId: snapshot.groupId,
      currentRevision: snapshot.currentRevision,
      members,
      authoringSnapshot: snapshot,
    };
    this.logger.log('MCP routed proposal batch through explicit group', {
      tool: args.tool,
      organizationId: args.organizationId,
      projectId: args.projectId,
      groupId: args.groupContext.groupId,
      expectedRevision: args.groupContext.expectedRevision,
      returnedRevision: snapshot.currentRevision,
      memberIds: members.map((member) => member.memberId),
      returnedTargetIdentities: members.map(
        (member) => member.reservedEntityId ?? member.proposal.targetEntityId,
      ),
    });
    return { proposals, groupedAuthoring };
  }

  private toGroupedAuthoring(
    snapshot: ProposalGroupAuthoringSnapshot,
    member: ProposalGroupAuthoringMember,
  ) {
    return {
      groupId: snapshot.groupId,
      currentRevision: snapshot.currentRevision,
      member,
      authoringSnapshot: snapshot,
    };
  }

  private async reviseGroupedProposal(args: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    proposalId: string;
    groupContext: ProposalGroupContext;
    requestorContext: StampedCreateProposalDto['requestorContext'];
    updates?: UpdateProposalDto['updates'];
    eli5?: UpdateProposalDto['eli5'];
    influences?: UpdateProposalDto['influences'];
    generatedWithVersion?: string;
    conversationId?: string;
  }) {
    const existing = await this.prisma.db.proposalGroupMember.findFirst({
      where: {
        groupId: args.groupContext.groupId,
        proposalId: args.proposalId,
        group: {
          organizationId: args.organizationId,
          projectId: args.projectId,
          status: 'BUILDING',
        },
      },
      include: { proposal: true },
    });
    if (!existing) {
      throw new Error(
        'Proposal is not a mutable member of the explicitly identified BUILDING group',
      );
    }

    const proposedStatus = (args.updates as { status?: string } | undefined)
      ?.status;
    if (proposedStatus !== undefined) {
      const validation = await this.validateProposalStatusUpdate({
        organizationId: args.organizationId,
        projectId: args.projectId,
        targetEntityId: existing.proposal.targetEntityId,
        targetEntityType: existing.proposal.targetEntityType,
        status: proposedStatus,
      });
      if (!validation.ok) throw new Error(validation.error);
    }

    const proposal = existing.proposal;
    const eli5 = args.eli5 ?? proposal.eli5;
    if (eli5 === null) {
      throw new BadRequestException(
        'An ELI5 explanation is required to revise this legacy proposal.',
      );
    }
    const replacement = {
      type: proposal.type,
      action: proposal.action,
      targetEntityId: proposal.targetEntityId,
      targetEntityType: proposal.targetEntityType,
      title: proposal.title ?? undefined,
      eli5,
      updates:
        args.updates ?? (proposal.updates as CreateProposalDto['updates']),
      requestorContext: args.requestorContext,
      influences:
        args.influences ??
        (proposal.influences as unknown as CreateProposalDto['influences']) ??
        undefined,
      generatedWithVersion:
        args.generatedWithVersion ?? proposal.generatedWithVersion ?? undefined,
      validationSessionId: proposal.validationSessionId ?? undefined,
      conversationId:
        args.conversationId ?? proposal.conversationId ?? undefined,
      edges:
        (proposal.edges as unknown as CreateProposalDto['edges']) ?? undefined,
    } satisfies StampedCreateProposalDto;

    const snapshot = await this.requireGroupAuthoringService().updateMember(
      args.organizationId,
      args.projectId,
      args.groupContext.groupId,
      existing.id,
      args.userId,
      {
        expectedRevision: args.groupContext.expectedRevision,
        proposal: replacement,
      },
    );
    const member = snapshot.members.find(
      (candidate) => candidate.memberId === existing.id,
    );
    if (!member) {
      throw new Error('Updated proposal-group member was not returned');
    }
    this.logger.log('MCP revised proposal through explicit group', {
      tool: PROPOSAL_TOOL_NAMES.UPDATE_PROPOSAL,
      organizationId: args.organizationId,
      projectId: args.projectId,
      groupId: args.groupContext.groupId,
      expectedRevision: args.groupContext.expectedRevision,
      returnedRevision: snapshot.currentRevision,
      memberId: member.memberId,
      proposalId: args.proposalId,
      returnedTargetIdentity:
        member.reservedEntityId ?? member.proposal.targetEntityId,
    });
    return {
      proposal: {
        id: args.proposalId,
        status: proposal.status,
        action: member.proposal.action,
        targetEntityType: member.proposal.targetEntityType,
        targetEntityId: member.proposal.targetEntityId,
        updatedAt: snapshot.updatedAt,
      },
      groupedAuthoring: this.toGroupedAuthoring(snapshot, member),
    };
  }

  /**
   * Emit one structured telemetry entry per finding (and one
   * recovery=true entry when a previously-blocked call now passes).
   * Centralized so every handler has the same shape. The recovery
   * marker is Redis-backed so it survives the request landing on a
   * different replica than the one that returned needs_revision.
   */
  private async emitLintTelemetry(args: {
    tool: string;
    userId: string;
    scopeKey: string;
    findings: LintFinding[];
  }): Promise<void> {
    const { tool, userId, scopeKey, findings } = args;
    const key = recoveryKey(tool, userId, scopeKey);
    if (findings.length > 0) {
      for (const finding of findings) {
        this.logger.log(
          `lint.${tool} rule=${finding.rule} ` +
            (finding.sectionKey ? `section=${finding.sectionKey} ` : '') +
            `path=${finding.path} severity=${finding.severity} ` +
            `agent=${userId} outcome=${
              finding.severity === 'error' ? 'needs_revision' : 'proposed'
            }`,
        );
      }
      if (findings.some((finding) => finding.severity === 'error')) {
        await this.lintRecovery.markNeedsRevision(key);
        return;
      }
    }
    const recovered = await this.lintRecovery.consumeRecovery(key);
    this.logger.log(
      `lint.${tool} outcome=proposed agent=${userId}` +
        (recovered ? ' recovery=true' : ''),
    );
  }

  /**
   * Per-type field validation for the generic work-item tools. Every rule
   * is read from the work-item type registry, so adding a work-item type is
   * a registry edit rather than new tool logic. Returns the boundary error
   * message, or null when the fields are valid for the type.
   */
  private validateWorkItemFields(args: {
    type: WorkItemTypeKey;
    mode: 'create' | 'edit';
    sections: ReadonlyArray<{ key: string }> | undefined;
    tag: string | undefined;
    dueDate: string | null | undefined;
    parentTaskId: string | undefined;
    implementation: string | undefined;
    // FEATURE-only on CREATE: an explicitly supplied collection, including an
    // empty one, covers the `requirements` section without needing it in
    // sections[].
    initialRequirementsCount?: number;
    projectId: string;
  }): string | null {
    const { type, mode, projectId } = args;

    const badSection = (args.sections ?? []).find(
      (s) =>
        !this.workItemTypeRegistry.isSectionAllowed(
          type,
          s.key as TaskSectionKey,
          projectId,
        ),
    );
    if (badSection) {
      return (
        `Section "${badSection.key}" is not valid for ${type} work items. ` +
        `Allowed section keys: ${this.workItemTypeRegistry
          .getSections(type, projectId)
          .join(', ')}.`
      );
    }

    // FEATURE requirements must go through initialRequirements (create) or
    // requirementOps (edit) — the raw sections[] path is rejected so callers
    // cannot bypass cite-fulfillment validation.
    if (
      type === 'FEATURE' &&
      (args.sections ?? []).some((s) => s.key === 'requirements')
    ) {
      return (
        'requirements section cannot be set via sections[] on FEATURE work items — ' +
        'use initialRequirements (on create_work_item) or requirementOps ' +
        '(on edit_work_item) instead.'
      );
    }

    if (
      args.tag !== undefined &&
      this.workItemTypeRegistry.isScalarForbidden(type, 'tag', projectId)
    ) {
      return `tag is only valid on FEATURE work items; ${type} does not accept it.`;
    }

    if (
      mode === 'edit' &&
      args.dueDate === null &&
      this.workItemTypeRegistry.isScalarRequired(type, 'dueDate', projectId)
    ) {
      return `dueDate is required for ${type} work items and cannot be cleared.`;
    }

    if (mode === 'create') {
      if (
        this.workItemTypeRegistry.isScalarRequired(type, 'tag', projectId) &&
        args.tag === undefined
      ) {
        return `tag is required to create a ${type} work item.`;
      }
      if (
        this.workItemTypeRegistry.isScalarRequired(
          type,
          'dueDate',
          projectId,
        ) &&
        args.dueDate === undefined
      ) {
        return `dueDate is required to create a ${type} work item.`;
      }
      if (
        this.workItemTypeRegistry.isParentRequired(type, projectId) &&
        args.parentTaskId === undefined
      ) {
        return (
          `parentTaskId is required to create a ${type} work item — it ` +
          'must belong to a parent (feature or task).'
        );
      }

      // Every section the type declares must be supplied at CREATE. A
      // declared section absent from the payload would let the entity
      // materialize with missing load-bearing content — the bug that
      // motivated this check: a BUG CREATE proposal silently dropped its
      // sections payload and the bug landed with no description.
      //
      // Coverage counts the effective sections after server-side fold-in:
      // `implementation` folds into the description section, and FEATURE's
      // `initialRequirements` renders the requirements section. Either
      // satisfies the corresponding key without it appearing in sections[].
      const suppliedKeys = new Set<string>(
        (args.sections ?? []).map((s) => s.key),
      );
      if (args.implementation?.trim()) {
        suppliedKeys.add('description');
      }
      if (type === 'FEATURE' && args.initialRequirementsCount !== undefined) {
        suppliedKeys.add('requirements');
      }
      const missing = this.workItemTypeRegistry
        .getSectionDefinitions(type, projectId)
        .filter((definition) => definition.required !== false)
        .map((definition) => definition.key)
        .filter((key) => !suppliedKeys.has(key));
      if (missing.length > 0) {
        const list = missing.map((k) => `"${k}"`).join(', ');
        return (
          `Section${missing.length > 1 ? 's' : ''} ${list} ` +
          `${missing.length > 1 ? 'are' : 'is'} required to create a ${type} ` +
          'work item.'
        );
      }
    }

    if (
      this.workItemTypeRegistry.getAllowedParentTypes(type, projectId)
        .length === 0 &&
      args.parentTaskId !== undefined
    ) {
      return mode === 'create'
        ? `${type} work items do not declare any allowed structural parent ` +
            'types, so parentTaskId is not accepted.'
        : `parentTaskId is not editable on ${type} work items because the ` +
            'type does not declare any allowed structural parent types.';
    }

    if (
      args.implementation !== undefined &&
      !IMPLEMENTATION_FOLD_TYPES[mode].has(type)
    ) {
      return (
        `implementation is not accepted for ${type} work items — fold ` +
        'file-level detail into the sections instead.'
      );
    }

    return null;
  }

  /**
   * Resolve successor-authored SUPERSEDES declarations before proposal
   * persistence. The declared target is the predecessor, whether it is an
   * existing TASK or a sibling work-item PROPOSAL. Eligibility comes from the
   * same registry-backed SUPERSEDED status policy used by the transition.
   */
  private async validateSupersedesDeclarations(args: {
    edges: readonly ProposalEdgeDeclarationParam[] | undefined;
    organizationId: string;
    projectId: string;
  }): Promise<string | null> {
    const supersedesEdges = (args.edges ?? []).filter(
      (edge) =>
        edge.edgeType === 'SUPERSEDES' && edge.endpointMode !== 'PROPOSAL',
    );

    for (const edge of supersedesEdges) {
      const resolved = await this.resolveSupersedesPredecessorType({
        edge,
        organizationId: args.organizationId,
        projectId: args.projectId,
      });
      if ('error' in resolved) return resolved.error;

      if (
        !this.workItemTypeRegistry.isSupersedable(resolved.type, args.projectId)
      ) {
        return (
          `SUPERSEDES target ${edge.targetEntityId} resolves to predecessor ` +
          `type ${resolved.type}, which does not permit SUPERSEDED. ` +
          'SUPERSEDES requires a predecessor type whose allowed-status ' +
          'policy permits SUPERSEDED.'
        );
      }
    }

    return null;
  }

  private async resolveSupersedesPredecessorType(args: {
    edge: ProposalEdgeDeclarationParam;
    organizationId: string;
    projectId: string;
  }): Promise<{ type: string } | { error: string }> {
    const { edge, organizationId, projectId } = args;

    if (edge.targetEntityType === 'DESIGN_DOC') {
      return {
        error:
          `SUPERSEDES target ${edge.targetEntityId} is a DESIGN_DOC. ` +
          'A declared SUPERSEDES relationship must target a predecessor work item.',
      };
    }

    if (edge.targetEntityType === 'TASK') {
      const predecessor = await this.prisma.db.task.findFirst({
        where: {
          id: edge.targetEntityId,
          organizationId,
          projectId,
          archivedAt: null,
        },
        select: { type: true },
      });
      return predecessor
        ? { type: predecessor.type }
        : {
            error:
              `Declared SUPERSEDES predecessor work item ` +
              `${edge.targetEntityId} was not found or is not accessible.`,
          };
    }

    const predecessorProposal = await this.prisma.db.proposal.findFirst({
      where: {
        id: edge.targetEntityId,
        organizationId,
        projectId,
        ...ORDINARY_PROPOSAL_VISIBILITY_WHERE,
      },
      select: {
        targetEntityType: true,
        targetEntityId: true,
        updates: true,
      },
    });
    if (!predecessorProposal) {
      return {
        error:
          `Declared SUPERSEDES predecessor proposal ${edge.targetEntityId} ` +
          'was not found or is not accessible.',
      };
    }
    if (predecessorProposal.targetEntityType !== 'TASK') {
      return {
        error:
          `SUPERSEDES target ${edge.targetEntityId} resolves to a proposal ` +
          `for ${predecessorProposal.targetEntityType}, not a predecessor work item.`,
      };
    }

    if (predecessorProposal.targetEntityId !== NIL_UUID) {
      const materializedPredecessor = await this.prisma.db.task.findFirst({
        where: {
          id: predecessorProposal.targetEntityId,
          organizationId,
          projectId,
          archivedAt: null,
        },
        select: { type: true },
      });
      if (materializedPredecessor) {
        return { type: materializedPredecessor.type };
      }
    }

    const updates = predecessorProposal.updates;
    if (
      typeof updates === 'object' &&
      updates !== null &&
      !Array.isArray(updates) &&
      typeof (updates as Record<string, unknown>)['type'] === 'string'
    ) {
      return { type: (updates as Record<string, string>)['type']! };
    }

    return {
      error:
        `Could not resolve work-item type for SUPERSEDES target proposal ` +
        `${edge.targetEntityId}. SUPERSEDES requires a predecessor work item ` +
        'with a resolved type.',
    };
  }

  /**
   * Admit every per-element link before persistence (Agent Proposal Authoring
   * Admission): targets are resolved in one project-scoped read per carrier,
   * link types are checked against the Diagram graph policy and the
   * DIAGRAM_ELEMENT edge targets, and every finding names its element.
   */
  private async validateDiagramElementLinks(params: {
    links: readonly CompiledDiagramElementLink[];
    organizationId: OrganizationId;
    projectId: ProjectId;
  }): Promise<{
    issues: ProjectedWorkItemChangeSetIssue[];
    rejected: Set<CompiledDiagramElementLink>;
  }> {
    const { links, organizationId, projectId } = params;
    const issues: ProjectedWorkItemChangeSetIssue[] = [];
    const rejected = new Set<CompiledDiagramElementLink>();
    const reject = (
      link: CompiledDiagramElementLink,
      subfield: 'edgeType' | 'targetEntityId',
      code: string,
      reason: string,
      suggestion?: string,
    ) => {
      rejected.add(link);
      issues.push({
        field: `${diagramElementLinkField(link)}.${subfield}`,
        code,
        reason: `${diagramElementLinkLabel(link)}: ${reason}`,
        layer: 'referential',
        ...(suggestion ? { suggestion } : {}),
      });
    };

    const taskIds = [
      ...new Set(
        links
          .filter((link) => link.link.targetEntityType === 'TASK')
          .map((link) => link.link.targetEntityId),
      ),
    ];
    const proposalIds = [
      ...new Set(
        links
          .filter((link) => link.link.targetEntityType === 'PROPOSAL')
          .map((link) => link.link.targetEntityId),
      ),
    ];
    const [taskRows, proposalRows] = await Promise.all([
      taskIds.length
        ? this.prisma.db.task.findMany({
            where: {
              id: { in: taskIds as TaskId[] },
              organizationId,
              projectId,
              archivedAt: null,
              status: { not: 'ARCHIVED' },
            },
            select: { id: true, type: true },
          })
        : Promise.resolve([]),
      proposalIds.length
        ? this.prisma.db.proposal.findMany({
            where: {
              id: { in: proposalIds },
              organizationId,
              projectId,
              ...ORDINARY_PROPOSAL_VISIBILITY_WHERE,
            },
            select: {
              id: true,
              status: true,
              action: true,
              targetEntityType: true,
              updates: true,
            },
          })
        : Promise.resolve([]),
    ]);
    const taskTypes = new Map(
      (taskRows ?? []).map((row) => [row.id as string, row.type]),
    );
    const proposals = new Map(
      (proposalRows ?? []).map((row) => [row.id as string, row]),
    );

    const graph = this.workItemTypeRegistry.getGraphCapability(
      WORK_ITEM_TYPE_KEYS.Diagram,
      projectId,
    );
    const edgeTargets =
      this.workItemTypeRegistry.getDefinition(
        projectId,
        WORK_ITEM_TYPE_KEYS.DiagramElement,
      )?.definition.edgeTargets ?? [];
    const edgeTargetAllowed = (edgeType: string, targetType: string) =>
      edgeTargets.some(
        (rule) =>
          rule.edgeType === edgeType &&
          // The registry contract defines an empty target list as unrestricted.
          (rule.targetTypeKeys.length === 0 ||
            rule.targetTypeKeys.includes(targetType)),
      );
    const graphPolicyAllows = (edgeType: string, targetType: string) =>
      (graph?.editableRelationships ?? []).some(
        (declaration) =>
          declaration.edgeType === edgeType &&
          declaration.category === 'meta' &&
          (!declaration.targetEndpoint.workItemTypeKeys?.length ||
            declaration.targetEndpoint.workItemTypeKeys.includes(targetType)),
      );

    for (const link of links) {
      const { edgeType, targetEntityType, targetEntityId } = link.link;
      if (edgeType === 'SUPERSEDES') {
        reject(
          link,
          'edgeType',
          'supersede_transition_required',
          'SUPERSEDES cannot be declared from a Diagram Element.',
          'Declare SUPERSEDES as a successor-authored edge on the proposal that replaces the predecessor.',
        );
        continue;
      }

      let targetType: string | undefined;
      if (targetEntityType === 'TASK') {
        targetType = taskTypes.get(targetEntityId);
        if (targetType === undefined) {
          reject(
            link,
            'targetEntityId',
            'dangling_reference',
            'The target work item was not found in this project or is archived.',
          );
          continue;
        }
      } else {
        const proposal = proposals.get(targetEntityId);
        if (!proposal) {
          reject(
            link,
            'targetEntityId',
            'dangling_reference',
            'The target proposal was not found in this project.',
          );
          continue;
        }
        if (proposal.status === 'REJECTED') {
          reject(
            link,
            'targetEntityId',
            'invalid_value',
            'Deferred Diagram links cannot target a rejected proposal.',
          );
          continue;
        }
        if (proposal.action !== 'CREATE') {
          reject(
            link,
            'targetEntityId',
            'invalid_value',
            'Deferred Diagram links require a CREATE proposal target.',
          );
          continue;
        }
        targetType = createdProposalTargetType(proposal);
        if (
          targetType === undefined ||
          (proposal.targetEntityType === 'TASK' &&
            !this.workItemTypeRegistry.isTypeActiveForProject(
              targetType,
              projectId,
            ))
        ) {
          reject(
            link,
            'targetEntityId',
            'unresolved_reference',
            'The CREATE proposal target does not have a currently registered work-item type.',
          );
          continue;
        }
        if (!DEFERRED_DIAGRAM_ELEMENT_LINK_EDGE_TYPES.has(edgeType)) {
          reject(
            link,
            'edgeType',
            'invalid_value',
            `${edgeType} cannot target a proposal; links to proposals support ${[
              ...DEFERRED_DIAGRAM_ELEMENT_LINK_EDGE_TYPES,
            ].join(', ')}.`,
            'Link to the existing work item once the target proposal is approved.',
          );
          continue;
        }
      }

      if (edgeType === 'DEPENDS_ON' && targetType === 'CONTRACT') {
        reject(
          link,
          'edgeType',
          'invalid_contract_participants',
          'DEPENDS_ON is not a Contract-participation link.',
          'Use GUARANTEES, IMPLEMENTS or CONSUMES according to the element responsibility for the Contract.',
        );
        continue;
      }

      const allowed =
        targetEntityType === 'TASK'
          ? graphPolicyAllows(edgeType, targetType) &&
            // FULFILLED_BY is governed by the Diagram graph policy alone.
            (edgeType === 'FULFILLED_BY' ||
              edgeTargetAllowed(edgeType, targetType))
          : edgeTargetAllowed(edgeType, targetType);
      if (!allowed) {
        reject(
          link,
          'edgeType',
          'invalid_value',
          `The project registry does not allow ${edgeType} from DIAGRAM_ELEMENT to ${targetType}.`,
        );
      }
    }

    return { issues, rejected };
  }

  @Tool({
    name: PROPOSAL_TOOL_NAMES.CREATE_WORK_ITEM,
    description: CREATE_WORK_ITEM_TOOL_DESCRIPTION,
    parameters: createWorkItemParameters,
    outputSchema: createWorkItemOutput,
  })
  async createWorkItem(
    params: z.infer<typeof createWorkItemParameters>,
    _context: Context,
    request: Request,
  ): Promise<CreateWorkItemOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const type = params.type as WorkItemTypeKey;

    const projectId = request.headers['x-project-id'] as string | undefined;
    if (!projectId) {
      return mcpError(
        'Missing project context. Ensure X-Project-ID header is set.',
      );
    }

    if (type === WORK_ITEM_TYPE_KEYS.Plan) {
      this.logger.warn(
        `create_work_item rejected PLAN creation for project ${projectId}: ` +
          PLAN_CREATE_ROUTING_MESSAGE,
      );
      return mcpError(PLAN_CREATE_ROUTING_MESSAGE);
    }

    const rootProofError = validateAuthoringRootProof({
      toolName: PROPOSAL_TOOL_NAMES.CREATE_WORK_ITEM,
      token: params.authoringRootProof,
      required: topologyMutationRequested({
        parentTaskId: params.parentTaskId,
        edges: params.edges,
        tracks: params.tracks,
        groupContext: params.groupContext,
        diagramElements: params.diagramElements,
        operations: params.operations,
        layoutBoundary: params.layoutBoundary,
      }),
    });
    if (rootProofError) return mcpError(rootProofError);

    // Gate the type before any per-type rule resolution: assertTypeActive
    // throws BadRequestException naming the valid project-scoped types when
    // the key is unknown or archived, so the section/scalar/parentage checks
    // below always run against a real registry entry. Mirrors the gate in
    // get-tool-guidance-tools.provider.ts.
    try {
      this.workItemTypeRegistry.assertTypeActive(type, projectId);
    } catch (error) {
      return mcpError(
        `type: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let validatedConfig: ReturnType<typeof validateWorkItemConfigForType>;
    try {
      validatedConfig = validateWorkItemConfigForType(
        params.config,
        this.workItemTypeRegistry.getAcceptedConfigKinds(type, projectId),
        type,
      );
    } catch (error) {
      return mcpError(error instanceof Error ? error.message : String(error));
    }

    const graphCreateRequested =
      params.diagramElements !== undefined ||
      params.operations !== undefined ||
      params.layoutBoundary !== undefined;
    if (graphCreateRequested && type !== WORK_ITEM_TYPE_KEYS.Diagram) {
      return mcpError(
        'Canonical graph creation operations are accepted only for DIAGRAM work items.',
      );
    }
    if (graphCreateRequested) {
      const mixedFields = [
        'sections',
        'priority',
        'dueDate',
        'assigneeId',
        'parentTaskId',
        'serviceIds',
        'tag',
        'config',
        'implementation',
        'initialRequirements',
        'tracks',
      ].filter((field) => params[field as keyof typeof params] !== undefined);
      if (mixedFields.length > 0) {
        return mcpError(
          'Canonical Diagram CREATE cannot mix generated `operations`/`layoutBoundary` ' +
            `with outer authoring fields: ${mixedFields.join(', ')}. ` +
            'Represent sections, parentage, relationships, and other Diagram content ' +
            'with generated change-set operations.',
        );
      }
    }

    // Proof-of-read gate: a payload carrying prose-quality fields (sections or
    // implementation) must present the project-scoped per-type token from
    // get_tool_guidance.
    // Runs before the per-type field rules so the agent is told to read the
    // conventions before it is told which section keys are wrong. Scalar-only
    // creates carry no prose and pass without a token.
    const diagramElementSections =
      params.diagramElements?.flatMap((element) => element.sections ?? []) ??
      [];
    const tokenError = validateGuidanceToken({
      toolName: 'create_work_item',
      type,
      projectId,
      token: params.guidanceToken,
      sections: [...(params.sections ?? []), ...diagramElementSections],
      implementation: params.implementation,
      // FEATURE requirement authoring is prose-quality too: initialRequirements
      // carry requirement statements + cites whose conventions the guidance
      // body teaches. Scoped to FEATURE — the only type that processes them.
      requirementProse:
        type === 'FEATURE' && (params.initialRequirements?.length ?? 0) > 0,
    });
    if (tokenError) {
      this.logger.log(
        `create_work_item: ${GUIDANCE_TOKEN_FIELD} gate rejected ` +
          `proposal for type ${type}`,
      );
      return mcpError(tokenError);
    }

    if (!graphCreateRequested) {
      const fieldError = this.validateWorkItemFields({
        type,
        mode: 'create',
        sections: params.sections,
        tag: params.tag,
        dueDate: params.dueDate,
        parentTaskId: params.parentTaskId,
        implementation: params.implementation,
        initialRequirementsCount: params.initialRequirements?.length,
        projectId,
      });
      if (fieldError) return mcpError(fieldError);
    }

    try {
      const supersedesError = await this.validateSupersedesDeclarations({
        edges: params.edges,
        organizationId: auth.organizationId,
        projectId,
      });
      if (supersedesError) return mcpError(supersedesError);
    } catch (error) {
      return mcpError(error instanceof Error ? error.message : String(error));
    }

    const updates: Record<string, unknown> = {};
    for (const key of CREATE_WORK_ITEM_KEYS) {
      const value = params[key as keyof typeof params];
      if (value !== undefined) {
        updates[key] = value;
      }
    }
    if (params.config !== undefined) {
      updates['config'] = validatedConfig;
    }
    if (!updates['name']) {
      return mcpError(`name is required to create a ${type} work item.`);
    }
    updates['type'] = type;

    // Fold the optional `implementation` field into the description
    // section. It is intentionally absent from CREATE_WORK_ITEM_KEYS, so
    // the key-copy loop above does not store it as a raw field. The
    // validator has already limited it to the fold-eligible types.
    const foldedSections = foldImplementationIntoSections(
      params.sections,
      params.implementation,
    );
    if (foldedSections !== undefined) {
      updates['sections'] = foldedSections;
    }
    if (params.implementation?.trim()) {
      this.logger.log(
        'create_work_item: folded implementation field into the ' +
          'description section',
      );
    }

    let elementLinks: CompiledDiagramElementLink[] = [];
    if (graphCreateRequested) {
      const suppliedOperations = params.operations ?? [];
      const rootCreates = suppliedOperations.filter(
        (operation) =>
          operation.op === 'workItem.create' &&
          operation.type === WORK_ITEM_TYPE_KEYS.Diagram,
      ) as Array<
        Extract<WorkItemChangeSetOperation, { op: 'workItem.create' }>
      >;
      if (rootCreates.length !== 1) {
        return mcpError(
          'A canonical Diagram CREATE requires exactly one DIAGRAM root workItem.create operation.',
        );
      }
      if (rootCreates[0]!.name !== params.name) {
        return mcpError(
          'Canonical Diagram CREATE requires outer `name` to match the DIAGRAM root workItem.create operation name.',
        );
      }
      const root = rootCreates[0]!.ref;
      const diagramElementOperations = (params.diagramElements ?? []).flatMap(
        (element: DiagramElementParam): WorkItemChangeSetOperation[] => {
          const ref = {
            refType: 'temporary' as const,
            tempId: element.tempId,
          };
          return [
            {
              op: 'workItem.create',
              ref,
              name: element.name,
              type: WORK_ITEM_TYPE_KEYS.DiagramElement,
              parent: root,
              ...(element.status === undefined
                ? {}
                : { status: element.status }),
              ...(element.priority === undefined
                ? {}
                : { priority: element.priority }),
              ...(element.dueDate === undefined
                ? {}
                : { dueDate: element.dueDate }),
              ...(element.assigneeId === undefined
                ? {}
                : { assigneeId: element.assigneeId }),
              ...(element.serviceIds === undefined
                ? {}
                : { serviceIds: element.serviceIds }),
            },
            ...(element.sections ?? []).map((section) => ({
              op: 'section.replace' as const,
              ref,
              key: section.key,
              content: section.content,
            })),
          ];
        },
      );
      elementLinks = compileDiagramElementLinks(params.diagramElements ?? []);
      const request = workItemChangeSetValidationRequestSchema.parse({
        root,
        operations: [
          rootCreates[0]!,
          ...diagramElementOperations,
          ...elementLinks.flatMap((link) =>
            link.operation ? [link.operation] : [],
          ),
          ...suppliedOperations.filter(
            (operation) => operation !== rootCreates[0],
          ),
        ],
        ...(params.layoutBoundary === undefined
          ? {}
          : { layoutBoundary: params.layoutBoundary }),
      }) satisfies WorkItemChangeSetValidationRequest;

      if (elementLinks.length > 0) {
        const { issues: linkIssues, rejected } =
          await this.validateDiagramElementLinks({
            links: elementLinks,
            organizationId: auth.organizationId,
            projectId: projectId as ProjectId,
          });
        if (linkIssues.length > 0) {
          // Report the rest of the change set in the same response so the
          // agent gets the complete explanation set in one rejection.
          const rejectedRefs = new Set(
            [...rejected].map((link) => diagramElementLinkField(link)),
          );
          const remaining = {
            ...request,
            operations: request.operations.filter(
              (operation) =>
                !(
                  operation.op === 'relationship.create' &&
                  operation.ref.refType === 'temporary' &&
                  rejectedRefs.has(operation.ref.tempId)
                ),
            ),
          };
          const projection = this.workItemChangeSetProjector
            ? await this.workItemChangeSetProjector.project({
                organizationId: auth.organizationId,
                projectId: projectId as ProjectId,
                request: remaining,
              })
            : undefined;
          return {
            status: 'invalid_change_set',
            workItemType: type,
            issues: [
              ...linkIssues,
              ...remapDiagramElementLinkIssues({
                issues: projection?.valid === false ? projection.issues : [],
                links: elementLinks,
                operations: remaining.operations,
                outerEdgeCount: params.edges?.length ?? 0,
              }),
            ],
          };
        }
      }
      for (const key of Object.keys(updates)) delete updates[key];
      Object.assign(updates, request);
    }

    // Prepare the complete JSON collection before proposal creation. The
    // proposal row therefore contains the exact reviewed IDs and wording;
    // approval only persists this already-prepared section.
    let mintedRequirementIds: Record<string, string> | undefined;
    let requirementLintFindings: LintWarning[] = [];
    if (type === 'FEATURE' && params.initialRequirements !== undefined) {
      const prepared =
        await this.featureRequirementAuthoring().prepareInitialRequirements(
          params.initialRequirements,
          { organizationId: auth.organizationId, db: this.prisma.db },
        );
      const preparationError = this.requirementPreparationError(
        'initialRequirements',
        prepared,
      );
      if (preparationError) return preparationError;
      if (!prepared.success)
        return mcpError('Requirements could not be prepared.');

      mintedRequirementIds = prepared.mintedRequirementIds;
      requirementLintFindings = prepared.warnings.map((warning) => ({
        id:
          warning.recordIndex === undefined
            ? warning.field
            : (prepared.section.records[warning.recordIndex]?.id ??
              warning.field),
        message: warning.message,
      }));
      const existingSections =
        (updates['sections'] as
          | Array<{ key: string; content: unknown }>
          | undefined) ?? [];
      updates['sections'] = [
        ...existingSections.filter((section) => section.key !== 'requirements'),
        { key: 'requirements', content: prepared.section },
      ];
      this.logger.log(
        `create_work_item: prepared ${prepared.section.records.length} requirements as canonical JSON`,
      );
    }

    const conversationId = request.headers['x-conversation-id'] as
      | string
      | undefined;

    const requestorContext = extractRequestorContext(
      auth,
      request,
      PROPOSAL_TOOL_NAMES.CREATE_WORK_ITEM,
      conversationId,
    );

    const provenance = buildProvenanceEnvelope(
      requestorContext,
      params.influences,
      params.generatedWithVersion,
    );

    const targetEntityId = NIL_UUID;

    // Lint runs on the agent-authored sections (params.sections),
    // NOT on the post-fold body — the `## Implementation` block the
    // fold appends would otherwise inflate the paragraph count and
    // trip the lint on content the agent didn't write. The workItemType
    // keeps per-type rule scoping now that one tool covers all types.
    const lintFindings = runProposalLint({
      tool: PROPOSAL_TOOL_NAMES.CREATE_WORK_ITEM,
      workItemType: type,
      sections: paramsToLintSections(params.sections),
    });
    const lintScope = `${params.parentTaskId ?? ''}::${params.name}`;
    await this.emitLintTelemetry({
      tool: PROPOSAL_TOOL_NAMES.CREATE_WORK_ITEM,
      userId: auth.user.userId,
      scopeKey: lintScope,
      findings: lintFindings,
    });
    const blockingFindings = blockingLintFindings(lintFindings);
    if (blockingFindings.length > 0) {
      return { status: 'needs_revision', lintFindings: blockingFindings };
    }

    // Deferred element links follow the agent's outer edges so shared
    // admission findings at edges[K] can be traced back to their element.
    const edges = [
      ...(params.edges ?? []),
      ...elementLinks.flatMap((link) =>
        link.deferredEdge ? [link.deferredEdge] : [],
      ),
    ];
    const dto: StampedCreateProposalDto = {
      type: 'SINGLE',
      action: 'CREATE',
      targetEntityId,
      targetEntityType: 'TASK',
      title: params.name,
      eli5: params.eli5,
      updates,
      requestorContext,
      influences: provenance.influences,
      ...(provenance.generatedWithVersion
        ? { generatedWithVersion: provenance.generatedWithVersion }
        : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(edges.length ? { edges } : {}),
      ...(params.tracks ? { tracks: params.tracks } : {}),
    };

    try {
      const { proposal, groupedAuthoring } = await this.persistProposal({
        organizationId: auth.organizationId,
        projectId: projectId as ProjectId,
        userId: auth.user.userId,
        dto,
        groupContext: params.groupContext,
        tool: PROPOSAL_TOOL_NAMES.CREATE_WORK_ITEM,
      });

      this.logger.log(
        `create_work_item proposal created: ${proposal.id} ` +
          `(type ${type}) for project ${projectId}`,
      );

      return {
        status: 'proposed',
        lintFindings,
        proposalId: proposal.id,
        action: proposal.action,
        targetEntityType: proposal.targetEntityType,
        targetEntityId: proposal.targetEntityId,
        fields: Object.keys(updates),
        createdAt: proposal.createdAt,
        ...(mintedRequirementIds !== undefined ? { mintedRequirementIds } : {}),
        ...(requirementLintFindings.length ? { requirementLintFindings } : {}),
        ...(groupedAuthoring ? { groupedAuthoring } : {}),
      };
    } catch (error: unknown) {
      const invalidChangeSet = invalidProposalChangeSetFromError(error, type);
      if (invalidChangeSet) {
        if (elementLinks.length === 0) return invalidChangeSet;
        return {
          ...invalidChangeSet,
          issues: remapDiagramElementLinkIssues({
            issues: invalidChangeSet.issues,
            links: elementLinks,
            operations:
              (updates as { operations?: WorkItemChangeSetOperation[] })
                .operations ?? [],
            outerEdgeCount: params.edges?.length ?? 0,
          }),
        };
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`create_work_item failed: ${message}`);
      return mcpError(message);
    }
  }

  @Tool({
    name: PROPOSAL_TOOL_NAMES.EDIT_WORK_ITEM,
    description: EDIT_WORK_ITEM_TOOL_DESCRIPTION,
    parameters: editWorkItemParameters,
    outputSchema: editWorkItemOutput,
  })
  async editWorkItem(
    params: z.infer<typeof editWorkItemParameters>,
    _context: Context,
    request: Request,
  ): Promise<EditWorkItemOutput | CallToolResult> {
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

    const rootProofError = validateAuthoringRootProof({
      toolName: PROPOSAL_TOOL_NAMES.EDIT_WORK_ITEM,
      token: params.authoringRootProof,
      required: topologyMutationRequested({
        parentTaskId: params.parentTaskId,
        edges: params.edges,
        groupContext: params.groupContext,
        operations: params.operations,
        layoutBoundary: params.layoutBoundary,
        requirementOps: params.requirementOps,
      }),
    });
    if (rootProofError) return mcpError(rootProofError);

    let resolvedWorkItemType: string | undefined;
    try {
      const original = await this.taskService.findOne(
        auth.organizationId,
        params.targetEntityId as TaskId,
      );

      if (!original) {
        return mcpError(
          `Work item ${params.targetEntityId} not found or not accessible.`,
        );
      }

      const type = original.type as WorkItemTypeKey;
      resolvedWorkItemType = type;
      const graphEditRequested =
        params.operations !== undefined || params.layoutBoundary !== undefined;

      let normalizedSections = params.sections;
      if (params.textReplacement) {
        const { sectionKey, find, replace } = params.textReplacement;
        if (params.sections?.some((section) => section.key === sectionKey)) {
          return mcpError(
            `textReplacement for section "${sectionKey}" cannot be combined with a direct sections update for the same section.`,
          );
        }
        const sectionDefinition =
          this.workItemTypeRegistry.getSectionDefinition(
            type,
            sectionKey,
            projectId,
          );
        if (!sectionDefinition) {
          return mcpError(
            `Section "${sectionKey}" is not valid for ${type} work items. Allowed section keys: ${this.workItemTypeRegistry
              .getSections(type, projectId)
              .join(', ')}.`,
          );
        }
        const sectionKind =
          resolveWorkItemSectionContentKind(sectionDefinition);
        if (sectionKind !== 'markdown') {
          return mcpError(
            `textReplacement is only accepted for Markdown sections; section "${sectionKey}" has kind "${sectionKind}".`,
          );
        }
        const currentContent = original.sections?.find(
          (section) => section.key === sectionKey,
        )?.materializedMarkdown;
        if (typeof currentContent !== 'string') {
          return mcpError(
            `Cannot apply textReplacement: Markdown section "${sectionKey}" has no current canonical text.`,
          );
        }
        let occurrenceCount = 0;
        let occurrenceIndex = currentContent.indexOf(find);
        while (occurrenceIndex !== -1) {
          occurrenceCount += 1;
          occurrenceIndex = currentContent.indexOf(find, occurrenceIndex + 1);
        }
        if (occurrenceCount !== 1) {
          return mcpError(
            `Cannot apply textReplacement to section "${sectionKey}": find text must occur exactly once, but occurred ${occurrenceCount} times.`,
          );
        }
        normalizedSections = [
          ...(params.sections ?? []),
          {
            key: sectionKey,
            content: currentContent.replace(find, replace),
          },
        ];
      }

      // Proof-of-read gate, validated against the server-resolved type. An
      // agent that read guidance for the wrong type presents a syntactically
      // valid token that still fails here, so the gate doubles as a
      // wrong-type correction. Runs before the per-type field rules; a
      // scalar-only edit carries no prose and needs no token.
      const tokenError = validateGuidanceToken({
        toolName: 'edit_work_item',
        type,
        projectId,
        token: params.guidanceToken,
        sections: normalizedSections,
        implementation: params.implementation,
        // FEATURE requirement authoring (requirementOps) is prose-quality too —
        // it rewrites requirement statements and cite-fulfillment per the
        // conventions the guidance teaches. Scoped to FEATURE, the only type
        // that accepts requirementOps; a non-FEATURE target stays token-free
        // here and is rejected later by the FEATURE-only requirementOps check.
        requirementProse:
          type === 'FEATURE' && (params.requirementOps?.length ?? 0) > 0,
      });
      if (tokenError) {
        this.logger.log(
          `edit_work_item: ${GUIDANCE_TOKEN_FIELD} gate rejected edit of ` +
            `work item ${params.targetEntityId} (type ${type})`,
        );
        return mcpError(
          `Work item ${params.targetEntityId} is a ${type}. ${tokenError}`,
        );
      }

      const fieldError = this.validateWorkItemFields({
        type,
        mode: 'edit',
        sections: normalizedSections,
        tag: params.tag,
        dueDate: params.dueDate,
        parentTaskId: params.parentTaskId,
        implementation: params.implementation,
        projectId,
      });
      if (fieldError) {
        // Lead with the resolved identity: a type-rule rejection usually
        // means the agent holds a wrong belief about the target's type,
        // and the per-type message alone reads like a wrong-ID error.
        return mcpError(
          `Work item ${params.targetEntityId} is a ${type}. ${fieldError}`,
        );
      }

      if (!graphEditRequested) {
        const supersedesError = await this.validateSupersedesDeclarations({
          edges: params.edges,
          organizationId: auth.organizationId,
          projectId,
        });
        if (supersedesError) return mcpError(supersedesError);
      }

      const updates: Record<string, unknown> = {};
      for (const key of UPDATE_WORK_ITEM_KEYS) {
        const value = params[key as keyof typeof params];
        if (value !== undefined) {
          updates[key] = value;
        }
      }

      // Fold the optional `implementation` field into the description
      // section before the empty-payload guard, so an implementation-only
      // edit still counts as a real change. When the call supplies no
      // description section, append to the work item's current description.
      const originalDescription = original.sections?.find(
        (section) => section.key === 'description',
      )?.materializedMarkdown;
      const foldedSections = foldImplementationIntoSections(
        normalizedSections,
        params.implementation,
        originalDescription,
      );
      if (foldedSections !== undefined) {
        updates['sections'] = foldedSections;
      }
      if (params.implementation?.trim()) {
        this.logger.log(
          'edit_work_item: folded implementation field into the ' +
            `description section for work item ${params.targetEntityId}`,
        );
      }

      // Prepare requirementOps into a complete canonical JSON section. The
      // durable IDs minted for adds are returned with the proposal response
      // and remain part of the reviewed payload through approval and retries.
      let requirementLintFindings: LintWarning[] = [];
      let mintedRequirementIds: Record<string, string> | undefined;
      if (params.requirementOps !== undefined) {
        if (type !== 'FEATURE') {
          return mcpError(
            `requirementOps is only accepted for FEATURE work items; ` +
              `${params.targetEntityId} is a ${type}.`,
          );
        }
        if (
          (params.sections ?? []).some(
            (section) => section.key === 'requirements',
          )
        ) {
          return mcpError(
            'Provide FEATURE requirements through requirementOps or sections[requirements], not both.',
          );
        }
        if (params.requirementOps.length > 0) {
          const currentSection = original.sections?.find(
            (section) => section.key === 'requirements',
          )?.materializedMarkdown;
          const prepared =
            await this.featureRequirementAuthoring().prepareRequirementOperations(
              currentSection,
              params.requirementOps,
              { organizationId: auth.organizationId, db: this.prisma.db },
            );
          const preparationError = this.requirementPreparationError(
            'requirementOps',
            prepared,
          );
          if (preparationError) return preparationError;
          if (!prepared.success)
            return mcpError('Requirements could not be prepared.');

          mintedRequirementIds = prepared.mintedRequirementIds;
          requirementLintFindings = prepared.warnings.map((warning) => ({
            id:
              warning.recordIndex === undefined
                ? warning.field
                : (prepared.section.records[warning.recordIndex]?.id ??
                  warning.field),
            message: warning.message,
          }));
          const existingSections =
            (updates['sections'] as
              | Array<{ key: string; content: unknown }>
              | undefined) ?? [];
          updates['sections'] = [
            ...existingSections.filter(
              (section) => section.key !== 'requirements',
            ),
            { key: 'requirements', content: prepared.section },
          ];
          this.logger.log(
            `edit_work_item: prepared ${prepared.section.records.length} requirements as canonical JSON` +
              (requirementLintFindings.length
                ? ` (${requirementLintFindings.length} advisory warnings)`
                : ''),
          );
        }
      }

      let proposalUpdates: Record<string, unknown> = updates;
      let topologyLintFindings: LintFinding[] = [];
      if (graphEditRequested) {
        const graph = this.workItemTypeRegistry.getGraphCapability(
          type,
          projectId,
        );
        if (!graph) {
          return {
            status: 'invalid_change_set',
            workItemType: type,
            issues: [
              graphIssue(
                'operations',
                'graph_capability_required',
                `${type} does not declare graph editing capabilities.`,
              ),
            ],
          };
        }

        const unsupportedTranslatedFields = [
          'serviceIds',
          'sectionUpdateSource',
        ].filter((field) => updates[field] !== undefined);
        if (unsupportedTranslatedFields.length > 0) {
          return {
            status: 'invalid_change_set',
            workItemType: type,
            issues: unsupportedTranslatedFields.map((field) =>
              graphIssue(
                field,
                'field_not_supported_in_change_set',
                `${field} cannot be represented by the generated generic graph change-set contract.`,
              ),
            ),
          };
        }

        if (
          (
            (updates['sections'] as Array<{ key: string }> | undefined) ?? []
          ).some((section) => section.key === graph.layout.sectionKey)
        ) {
          return {
            status: 'invalid_change_set',
            workItemType: type,
            issues: [
              graphIssue(
                'sections',
                'layout_requires_graph_operation',
                `${graph.layout.sectionKey} must be changed with layout.replace or layout.clear, not as a prose section update.`,
              ),
            ],
          };
        }

        const root = {
          refType: 'existing' as const,
          id: params.targetEntityId,
        };
        const translatedOperations: WorkItemChangeSetOperation[] = [];
        const scalarUpdate: Omit<WorkItemUpdateOperation, 'op' | 'ref'> = {};
        for (const field of [
          'name',
          'status',
          'priority',
          'dueDate',
          'assigneeId',
          'tag',
        ] as const) {
          if (updates[field] !== undefined) {
            Object.assign(scalarUpdate, { [field]: updates[field] });
          }
        }
        if (updates['parentTaskId'] !== undefined) {
          scalarUpdate.parent = {
            refType: 'existing',
            id: updates['parentTaskId'] as string,
          };
        }
        if (Object.keys(scalarUpdate).length > 0) {
          translatedOperations.push({
            op: 'workItem.update',
            ref: root,
            ...scalarUpdate,
          });
        }
        for (const section of (updates['sections'] as
          | Array<{ key: string; content: unknown }>
          | undefined) ?? []) {
          translatedOperations.push({
            op: 'section.replace',
            ref: root,
            key: section.key,
            content: section.content,
          });
        }

        const operations = [
          ...translatedOperations,
          ...(params.operations ?? []),
        ];
        const request = workItemChangeSetValidationRequestSchema.parse({
          root,
          operations,
          ...(params.layoutBoundary === undefined
            ? {}
            : { layoutBoundary: params.layoutBoundary }),
        }) satisfies WorkItemChangeSetValidationRequest;
        const capabilityIssues = validateGraphOperationsAgainstCapability({
          graph,
          operations: request.operations,
        });
        if (capabilityIssues.length > 0) {
          return {
            status: 'invalid_change_set',
            workItemType: type,
            issues: capabilityIssues,
          };
        }
        if (!this.workItemChangeSetProjector) {
          throw new Error(
            'Work-item graph change-set projection is not configured.',
          );
        }
        const projectionParams = {
          organizationId: auth.organizationId,
          projectId: projectId as ProjectId,
          request,
          view: rootChildrenView,
        };
        const topology = this.workItemChangeSetProjector.projectTopology
          ? await this.workItemChangeSetProjector.projectTopology(
              projectionParams,
            )
          : await this.workItemChangeSetProjector
              .project(projectionParams)
              .then((projection) => ({
                projection,
                nodes: [
                  projection.projectedRoot,
                  ...(projection.children ?? []),
                ].filter((node): node is NonNullable<typeof node> =>
                  Boolean(node),
                ),
                relationships: projection.incidentRelationships ?? [],
                featureContractCitations: new Map<
                  string,
                  ReadonlySet<string>
                >(),
                participatingFeatureByWorkflowNode: new Map<string, string>(),
              }));
        const projected = topology.projection;
        if (!projected.valid) {
          return {
            status: 'invalid_change_set',
            workItemType: type,
            issues: projected.issues,
          };
        }
        topologyLintFindings = lintProjectedTopology({
          ...topology,
          semantics: this.workItemTypeRegistry.getProjectedTopologySemantics(
            projectId,
            projected.projectedRoot?.type ?? type,
          ),
        });
        proposalUpdates = request as unknown as Record<string, unknown>;
      }

      if (Object.keys(proposalUpdates).length === 0 && !params.edges?.length) {
        return mcpError(
          'No update fields provided. Include at least one field ' +
            'to change (name, status, priority, sections, etc.) or a ' +
            'structured edge declaration.',
        );
      }

      const requestorContext = extractRequestorContext(
        auth,
        request,
        PROPOSAL_TOOL_NAMES.EDIT_WORK_ITEM,
        conversationId,
      );

      const provenance = buildProvenanceEnvelope(
        requestorContext,
        params.influences,
        params.generatedWithVersion,
      );

      // Literal replacements are normalized before lint so the complete
      // resulting section is evaluated; implementation folding remains
      // excluded from lint as on the existing direct-edit path.
      const lintFindings = [
        ...runProposalLint({
          tool: PROPOSAL_TOOL_NAMES.EDIT_WORK_ITEM,
          workItemType: type,
          sections: paramsToLintSections(normalizedSections),
        }),
        ...topologyLintFindings,
      ];
      await this.emitLintTelemetry({
        tool: PROPOSAL_TOOL_NAMES.EDIT_WORK_ITEM,
        userId: auth.user.userId,
        scopeKey: params.targetEntityId,
        findings: lintFindings,
      });
      const blockingFindings = blockingLintFindings(lintFindings);
      if (blockingFindings.length > 0) {
        return {
          status: 'needs_revision',
          workItemType: type,
          lintFindings: blockingFindings,
        };
      }

      const dto: StampedCreateProposalDto = {
        type: 'SINGLE',
        action: 'UPDATE',
        targetEntityId: params.targetEntityId,
        targetEntityType: 'TASK',
        updates: proposalUpdates,
        eli5: params.eli5,
        requestorContext,
        influences: provenance.influences,
        ...(provenance.generatedWithVersion
          ? { generatedWithVersion: provenance.generatedWithVersion }
          : {}),
        ...(conversationId ? { conversationId } : {}),
        ...(params.edges?.length ? { edges: params.edges } : {}),
      };

      const { proposal, groupedAuthoring } = await this.persistProposal({
        organizationId: auth.organizationId,
        projectId: projectId as ProjectId,
        userId: auth.user.userId,
        dto,
        groupContext: params.groupContext,
        tool: PROPOSAL_TOOL_NAMES.EDIT_WORK_ITEM,
      });

      this.logger.log(
        `edit_work_item proposal created: ${proposal.id} ` +
          `(type ${type}) for work item ${params.targetEntityId}`,
      );

      return {
        status: 'proposed',
        workItemType: type,
        lintFindings,
        proposalId: proposal.id,
        action: proposal.action,
        targetEntityType: proposal.targetEntityType,
        targetEntityId: proposal.targetEntityId,
        modifiedFields: Object.keys(proposalUpdates),
        createdAt: proposal.createdAt,
        ...(requirementLintFindings.length ? { requirementLintFindings } : {}),
        ...(mintedRequirementIds !== undefined ? { mintedRequirementIds } : {}),
        ...(groupedAuthoring ? { groupedAuthoring } : {}),
      };
    } catch (error: unknown) {
      const invalidChangeSet = invalidProposalChangeSetFromError(
        error,
        resolvedWorkItemType,
      );
      if (invalidChangeSet && resolvedWorkItemType) {
        return { ...invalidChangeSet, workItemType: resolvedWorkItemType };
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`edit_work_item failed: ${message}`);
      return mcpError(message);
    }
  }

  @Tool({
    name: PROPOSAL_TOOL_NAMES.EDIT_TASKS,
    description: EDIT_TASKS_TOOL_DESCRIPTION,
    parameters: editTasksParameters,
    outputSchema: editTasksResultOutput,
  })
  async editTasks(
    params: z.infer<typeof editTasksParameters>,
    _context: Context,
    request: Request,
  ): Promise<EditTasksOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const errors: Array<{ index: number; taskId: string; error: string }> = [];

    const conversationId = request.headers['x-conversation-id'] as
      | string
      | undefined;
    const projectId = request.headers['x-project-id'] as string | undefined;

    if (!projectId) {
      return mcpError(
        'Missing project context. Ensure X-Project-ID header is set.',
      );
    }

    const rootProofError = validateAuthoringRootProof({
      toolName: PROPOSAL_TOOL_NAMES.EDIT_TASKS,
      token: params.authoringRootProof,
      required: topologyMutationRequested({
        groupContext: params.groupContext,
        parentTaskId: params.edits.some(
          (edit) => edit.parentTaskId !== undefined,
        )
          ? true
          : undefined,
      }),
    });
    if (rootProofError) return mcpError(rootProofError);

    const requestorContext = extractRequestorContext(
      auth,
      request,
      PROPOSAL_TOOL_NAMES.EDIT_TASKS,
      conversationId,
    );

    const provenance = buildProvenanceEnvelope(
      requestorContext,
      params.influences,
      params.generatedWithVersion,
    );

    try {
      const originals = await Promise.all(
        params.edits.map((edit) =>
          this.taskService.findOne(auth.organizationId, edit.taskId as TaskId),
        ),
      );

      const dtos: StampedCreateProposalDto[] = params.edits.map(
        (edit, index) => {
          const original = originals[index];
          if (!original) {
            errors.push({
              index,
              taskId: edit.taskId,
              error: `Task ${edit.taskId} not found or not accessible.`,
            });
          } else if (original.type === 'FEATURE') {
            errors.push({
              index,
              taskId: edit.taskId,
              error:
                `${edit.taskId} is a FEATURE, not a TASK. ` +
                'Use edit_work_item instead.',
            });
          } else if (original.type === 'GOAL') {
            errors.push({
              index,
              taskId: edit.taskId,
              error:
                `${edit.taskId} is a GOAL, not a TASK. ` +
                'Use edit_work_item instead.',
            });
          } else {
            // Proof-of-read gate, same as edit_work_item — edit_tasks must not
            // be an open lane for authoring sections without reading the
            // per-type conventions. The token is validated against each entry's
            // server-resolved type and request project; edit_tasks carries no
            // `implementation` field, so a non-empty `sections` array is the
            // only trigger. The retry call names edit_work_item, which is where
            // get_tool_guidance serves the project-scoped per-type body (the
            // token is tool-agnostic within that project/type scope).
            // Token-first: a token failure short-circuits the per-type field
            // check, so the agent is told to read the conventions before it is
            // told which section keys are wrong.
            const tokenError = validateGuidanceToken({
              toolName: 'edit_work_item',
              type: original.type as string,
              projectId,
              token: edit.guidanceToken,
              sections: edit.sections,
            });
            if (tokenError) {
              errors.push({
                index,
                taskId: edit.taskId,
                error: `Work item ${edit.taskId} is a ${original.type}. ${tokenError}`,
              });
            } else {
              // Plain-task entries (STANDARD, BUG) get the same config-driven
              // boundary as edit_work_item — without this, a BUG entry could
              // carry an acceptanceCriteria section the type cannot hold and
              // the mismatch would only surface at enactment.
              const fieldError = this.validateWorkItemFields({
                type: original.type as WorkItemTypeKey,
                mode: 'edit',
                sections: edit.sections,
                tag: undefined,
                dueDate: edit.dueDate,
                parentTaskId: edit.parentTaskId,
                implementation: undefined,
                projectId,
              });
              if (fieldError) {
                errors.push({
                  index,
                  taskId: edit.taskId,
                  error: `Work item ${edit.taskId} is a ${original.type}. ${fieldError}`,
                });
              }
            }
          }

          const updates: Record<string, unknown> = {};
          for (const key of UPDATE_TASK_KEYS) {
            const value = edit[key as keyof typeof edit];
            if (value !== undefined) {
              updates[key] = value;
            }
          }

          if (Object.keys(updates).length === 0) {
            errors.push({
              index,
              taskId: edit.taskId,
              error: 'No update fields provided',
            });
          }

          return {
            type: 'BATCH' as const,
            action: 'UPDATE' as const,
            targetEntityId: edit.taskId,
            targetEntityType: 'TASK' as const,
            updates,
            eli5: edit.eli5,
            requestorContext,
            influences: provenance.influences,
            ...(provenance.generatedWithVersion
              ? { generatedWithVersion: provenance.generatedWithVersion }
              : {}),
            ...(conversationId ? { conversationId } : {}),
          };
        },
      );

      if (errors.length > 0) {
        return mcpError(
          `Validation failed for ${errors.length} edit(s): ` +
            JSON.stringify(errors),
        );
      }

      const { proposals, groupedAuthoring } = await this.persistProposalBatch({
        organizationId: auth.organizationId,
        projectId: projectId as ProjectId,
        userId: auth.user.userId,
        dtos,
        groupContext: params.groupContext,
        tool: PROPOSAL_TOOL_NAMES.EDIT_TASKS,
      });

      this.logger.log(
        `edit_tasks batch created: ${proposals.length} proposals for project ${projectId}`,
      );

      return {
        proposals: proposals.map((p) => ({
          id: p.id,
          status: p.status,
          action: p.action,
          targetEntityType: p.targetEntityType,
          targetEntityId: p.targetEntityId,
          modifiedFields: Object.keys(p.updates as Record<string, unknown>),
          createdAt: p.createdAt,
        })),
        ...(groupedAuthoring ? { groupedAuthoring } : {}),
      };
    } catch (error: unknown) {
      const invalidChangeSet = invalidProposalChangeSetFromError(error);
      if (invalidChangeSet) return invalidChangeSet;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`edit_tasks failed: ${message}`);
      return mcpError(message);
    }
  }

  @Tool({
    name: PROPOSAL_TOOL_NAMES.CREATE_DESIGN_DOC,
    description:
      'Propose a CREATE proposal for a BRAINSTORM design document. See ' +
      'get_tool_guidance({ toolName: "create_design_doc" }) for the ' +
      'authoring conventions.',
    parameters: createDesignDocParameters,
    outputSchema: createDesignDocOutput,
  })
  async createDesignDoc(
    params: z.infer<typeof createDesignDocParameters>,
    _context: Context,
    request: Request,
  ): Promise<CreateDesignDocOutput | CallToolResult> {
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

    const rootProofError = validateAuthoringRootProof({
      toolName: PROPOSAL_TOOL_NAMES.CREATE_DESIGN_DOC,
      token: params.authoringRootProof,
      required: topologyMutationRequested({
        parentEntityId: params.parentEntityId,
        parentEntityType: params.parentEntityType,
        groupContext: params.groupContext,
      }),
    });
    if (rootProofError) return mcpError(rootProofError);

    const updates: Record<string, unknown> = {
      name: params.name,
      template: 'BRAINSTORM',
      projectId,
      sections: [{ key: 'content', content: params.content, order: 0 }],
    };
    if (params.tags !== undefined) updates['tags'] = params.tags;
    if (params.summary !== undefined) updates['summary'] = params.summary;
    if (params.parentEntityId !== undefined) {
      updates['parentEntityId'] = params.parentEntityId;
    }
    if (params.parentEntityType !== undefined) {
      updates['parentEntityType'] = params.parentEntityType;
    }
    if (
      (params.parentEntityId !== undefined) !==
      (params.parentEntityType !== undefined)
    ) {
      return mcpError(
        'parentEntityId and parentEntityType must be provided together',
      );
    }

    const requestorContext = extractRequestorContext(
      auth,
      request,
      PROPOSAL_TOOL_NAMES.CREATE_DESIGN_DOC,
      conversationId,
    );

    const provenance = buildProvenanceEnvelope(
      requestorContext,
      params.influences,
      params.generatedWithVersion,
    );

    const targetEntityId = NIL_UUID;

    // create_design_doc has no `sections` input — the agent supplies
    // a single `content` string and the server synthesizes the
    // `content` section. Lint sees that single section directly so the
    // pre-vs-post-fold distinction is moot here, but the contract
    // stays uniform across the family.
    const lintFindings = runProposalLint({
      tool: PROPOSAL_TOOL_NAMES.CREATE_DESIGN_DOC,
      sections: [{ key: 'content', content: params.content }],
    });
    const lintScope = `${params.parentEntityId ?? ''}::${params.name}`;
    await this.emitLintTelemetry({
      tool: PROPOSAL_TOOL_NAMES.CREATE_DESIGN_DOC,
      userId: auth.user.userId,
      scopeKey: lintScope,
      findings: lintFindings,
    });
    if (lintFindings.length > 0) {
      return { status: 'needs_revision', lintFindings };
    }

    const dto: StampedCreateProposalDto = {
      type: 'SINGLE',
      action: 'CREATE',
      targetEntityId,
      targetEntityType: 'DESIGN_DOC',
      title: params.name,
      eli5: params.eli5,
      updates,
      requestorContext,
      influences: provenance.influences,
      ...(provenance.generatedWithVersion
        ? { generatedWithVersion: provenance.generatedWithVersion }
        : {}),
      ...(conversationId ? { conversationId } : {}),
    };

    try {
      const { proposal, groupedAuthoring } = await this.persistProposal({
        organizationId: auth.organizationId,
        projectId: projectId as ProjectId,
        userId: auth.user.userId,
        dto,
        groupContext: params.groupContext,
        tool: PROPOSAL_TOOL_NAMES.CREATE_DESIGN_DOC,
      });

      this.logger.log(
        `create_design_doc proposal created: ${proposal.id} for project ${projectId}`,
      );

      return {
        status: 'proposed',
        lintFindings: [],
        proposalId: proposal.id,
        action: proposal.action,
        targetEntityType: proposal.targetEntityType,
        targetEntityId: proposal.targetEntityId,
        fields: Object.keys(updates),
        createdAt: proposal.createdAt,
        ...(groupedAuthoring ? { groupedAuthoring } : {}),
      };
    } catch (error: unknown) {
      const invalidChangeSet = invalidProposalChangeSetFromError(error);
      if (invalidChangeSet) return invalidChangeSet;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`create_design_doc failed: ${message}`);
      return mcpError(message);
    }
  }

  @Tool({
    name: PROPOSAL_TOOL_NAMES.EDIT_DESIGN_DOC,
    description:
      'Propose an UPDATE proposal for a design document. See ' +
      'get_tool_guidance({ toolName: "edit_design_doc" }) for the authoring ' +
      'conventions.',
    parameters: editDesignDocParameters,
    outputSchema: editDesignDocOutput,
  })
  async editDesignDoc(
    params: z.infer<typeof editDesignDocParameters>,
    _context: Context,
    request: Request,
  ): Promise<EditDesignDocOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const updates: Record<string, unknown> = {};
    for (const key of UPDATE_DESIGN_DOC_KEYS) {
      const value = params[key as keyof typeof params];
      if (value !== undefined) {
        updates[key] = value;
      }
    }

    if (Object.keys(updates).length === 0) {
      return mcpError(
        'No update fields provided. Include at least one field ' +
          'to change (name, sections, tags, summary, etc.).',
      );
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

    const rootProofError = validateAuthoringRootProof({
      toolName: PROPOSAL_TOOL_NAMES.EDIT_DESIGN_DOC,
      token: params.authoringRootProof,
      required: topologyMutationRequested({
        parentEntityId: params.parentEntityId,
        parentEntityType: params.parentEntityType,
        groupContext: params.groupContext,
      }),
    });
    if (rootProofError) return mcpError(rootProofError);

    const requestorContext = extractRequestorContext(
      auth,
      request,
      PROPOSAL_TOOL_NAMES.EDIT_DESIGN_DOC,
      conversationId,
    );

    const provenance = buildProvenanceEnvelope(
      requestorContext,
      params.influences,
      params.generatedWithVersion,
    );

    const lintFindings = runProposalLint({
      tool: PROPOSAL_TOOL_NAMES.EDIT_DESIGN_DOC,
      sections: paramsToLintSections(params.sections),
    });
    await this.emitLintTelemetry({
      tool: PROPOSAL_TOOL_NAMES.EDIT_DESIGN_DOC,
      userId: auth.user.userId,
      scopeKey: params.targetEntityId,
      findings: lintFindings,
    });
    if (lintFindings.length > 0) {
      return { status: 'needs_revision', lintFindings };
    }

    const dto: StampedCreateProposalDto = {
      type: 'SINGLE',
      action: 'UPDATE',
      targetEntityId: params.targetEntityId,
      targetEntityType: 'DESIGN_DOC',
      updates,
      eli5: params.eli5,
      requestorContext,
      influences: provenance.influences,
      ...(provenance.generatedWithVersion
        ? { generatedWithVersion: provenance.generatedWithVersion }
        : {}),
      ...(conversationId ? { conversationId } : {}),
    };

    try {
      const { proposal, groupedAuthoring } = await this.persistProposal({
        organizationId: auth.organizationId,
        projectId: projectId as ProjectId,
        userId: auth.user.userId,
        dto,
        groupContext: params.groupContext,
        tool: PROPOSAL_TOOL_NAMES.EDIT_DESIGN_DOC,
      });

      this.logger.log(
        `edit_design_doc proposal created: ${proposal.id} for design doc ${params.targetEntityId}`,
      );

      return {
        status: 'proposed',
        lintFindings: [],
        proposalId: proposal.id,
        action: proposal.action,
        targetEntityType: proposal.targetEntityType,
        targetEntityId: proposal.targetEntityId,
        modifiedFields: Object.keys(updates),
        createdAt: proposal.createdAt,
        ...(groupedAuthoring ? { groupedAuthoring } : {}),
      };
    } catch (error: unknown) {
      const invalidChangeSet = invalidProposalChangeSetFromError(error);
      if (invalidChangeSet) return invalidChangeSet;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`edit_design_doc failed: ${message}`);
      return mcpError(message);
    }
  }

  @Tool({
    name: PROPOSAL_TOOL_NAMES.PROPOSE_FUTURE_REVISION,
    description:
      'Propose a reviewed, non-live future revision of a Feature, Contract, ' +
      'Diagram, Mockup or Design Doc whose change describes the outcome of ' +
      'linked implementation work (VERSIONED_UPDATE), with that work as the ' +
      'completion dependencies that gate its ' +
      'application. Approval stores the future; live content changes only ' +
      'when a user applies it. See get_tool_guidance({ toolName: ' +
      '"propose_future_revision" }).',
    parameters: proposeFutureRevisionParameters,
    outputSchema: proposeFutureRevisionOutput,
  })
  async proposeFutureRevision(
    params: z.infer<typeof proposeFutureRevisionParameters>,
    _context: Context,
    request: Request,
  ): Promise<ProposeFutureRevisionOutput | CallToolResult> {
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

    let authoring: FutureRevisionAuthoring;
    try {
      authoring = parseFutureRevisionAuthoring(
        params.mutation,
        params.targetEntityType,
      );
    } catch (error: unknown) {
      const errors: unknown[] =
        error instanceof BadRequestException
          ? ((error.getResponse() as { errors?: unknown[] }).errors ?? [])
          : [];
      const details = (
        errors as Array<{ instancePath?: string; message?: string }>
      )
        .map(
          (e) => `mutation${e.instancePath ?? ''}: ${e.message ?? 'invalid'}`,
        )
        .join('\n');
      const firstError = details.split('\n')[0];
      this.logger.log(
        `propose_future_revision: rejected malformed mutation for ` +
          `${params.targetEntityType} ${params.targetEntityId} ` +
          `(${errors.length} error(s)${firstError ? `; first: ${firstError}` : ''})`,
      );
      return mcpError(
        `mutation does not satisfy FutureRevisionAuthoring.${details ? `\n${details}` : ''}`,
      );
    }

    // Approved completion dependencies become dependency links, so they are
    // topology just like a group placement.
    const rootProofError = validateAuthoringRootProof({
      toolName: PROPOSAL_TOOL_NAMES.PROPOSE_FUTURE_REVISION,
      token: params.authoringRootProof,
      required: topologyMutationRequested({
        groupContext: params.groupContext,
        edges:
          authoring.operation === 'REVISE' ? authoring.dependencies : undefined,
      }),
    });
    if (rootProofError) {
      this.logger.log(
        `propose_future_revision: authoring root proof rejected for ` +
          `${params.targetEntityType} ${params.targetEntityId}`,
      );
      return mcpError(rootProofError);
    }

    let mutation: FutureRevisionMutation;
    try {
      mutation = await this.proposalService.materializeFutureRevision(
        {
          organizationId: auth.organizationId,
          projectId,
          targetEntityType: params.targetEntityType,
          targetEntityId: params.targetEntityId,
        },
        authoring,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.log(
        `propose_future_revision: rejected delta for ` +
          `${params.targetEntityType} ${params.targetEntityId}: ${message}`,
      );
      return mcpError(message);
    }

    if (
      params.targetEntityType === 'TASK' &&
      mutation.operation === 'REVISE' &&
      'type' in mutation.result
    ) {
      const baselineType =
        'type' in mutation.baseline.content
          ? mutation.baseline.content.type
          : undefined;
      if (baselineType !== undefined && mutation.result.type !== baselineType) {
        this.logger.log(
          `propose_future_revision: rejected type change ` +
            `${baselineType} -> ${mutation.result.type} for work item ${params.targetEntityId}`,
        );
        return mcpError(
          `mutation/result/type: a future revision cannot change the work item type ` +
            `(baseline "${baselineType}", result "${mutation.result.type}").`,
        );
      }
      const sectionsChanged = !isEqual(
        mutation.result.sections ?? null,
        mutation.baseline.content.sections ?? null,
      );
      const tokenError = validateGuidanceToken({
        toolName: 'edit_work_item',
        type: mutation.result.type,
        projectId,
        token: params.guidanceToken,
        sections: sectionsChanged ? mutation.result.sections : undefined,
      });
      if (tokenError) {
        this.logger.log(
          `propose_future_revision: ${GUIDANCE_TOKEN_FIELD} gate rejected ` +
            `future of work item ${params.targetEntityId}`,
        );
        return mcpError(tokenError);
      }
    }

    const requestorContext = extractRequestorContext(
      auth,
      request,
      PROPOSAL_TOOL_NAMES.PROPOSE_FUTURE_REVISION,
      conversationId,
    );
    const provenance = buildProvenanceEnvelope(
      requestorContext,
      params.influences,
      params.generatedWithVersion,
    );

    const dto: StampedCreateProposalDto = {
      type: 'SINGLE',
      action: 'VERSIONED_UPDATE',
      targetEntityId: params.targetEntityId,
      targetEntityType: params.targetEntityType,
      updates: mutation,
      eli5: params.eli5,
      requestorContext,
      influences: provenance.influences,
      ...(provenance.generatedWithVersion
        ? { generatedWithVersion: provenance.generatedWithVersion }
        : {}),
      ...(conversationId ? { conversationId } : {}),
    };

    try {
      const { proposal, groupedAuthoring } = await this.persistProposal({
        organizationId: auth.organizationId,
        projectId: projectId as ProjectId,
        userId: auth.user.userId,
        dto,
        groupContext: params.groupContext,
        tool: PROPOSAL_TOOL_NAMES.PROPOSE_FUTURE_REVISION,
      });

      this.logger.log(
        `propose_future_revision proposal created: ${proposal.id} for ` +
          `${params.targetEntityType} ${params.targetEntityId} ` +
          `(future ${mutation.futureId}, ${mutation.operation})`,
      );

      return {
        status: 'proposed',
        proposalId: proposal.id,
        futureId: mutation.futureId,
        operation: mutation.operation,
        targetEntityType: params.targetEntityType,
        targetEntityId: params.targetEntityId,
        createdAt: proposal.createdAt,
        ...(groupedAuthoring ? { groupedAuthoring } : {}),
      };
    } catch (error: unknown) {
      const invalidChangeSet = invalidProposalChangeSetFromError(error);
      if (invalidChangeSet) return invalidChangeSet;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`propose_future_revision failed: ${message}`);
      return mcpError(message);
    }
  }

  @Tool({
    name: PROPOSAL_TOOL_NAMES.UPDATE_PROPOSAL,
    description:
      'Update an existing proposal record. Use this to modify the ' +
      'proposed changes (updates), influences, or version ' +
      'metadata of a proposal that is still in DRAFT state. ' +
      'Cannot update proposals that have already ' +
      'been APPROVED or REJECTED.',
    parameters: updateProposalParameters,
    outputSchema: updateProposalOutput,
  })
  async updateProposal(
    params: z.infer<typeof updateProposalParameters>,
    _context: Context,
    request: Request,
  ): Promise<UpdateProposalOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const projectId = request.headers['x-project-id'] as string | undefined;
    if (!projectId) {
      return mcpError(
        'Missing project context. Ensure X-Project-ID header is set.',
      );
    }

    const rootProofError = validateAuthoringRootProof({
      toolName: PROPOSAL_TOOL_NAMES.UPDATE_PROPOSAL,
      token: params.authoringRootProof,
      required: topologyMutationRequested({
        parentTaskId: params.updates?.parentTaskId,
        groupContext: params.groupContext,
      }),
    });
    if (rootProofError) return mcpError(rootProofError);

    const conversationId = request.headers['x-conversation-id'] as
      | string
      | undefined;

    const requestorContext = extractRequestorContext(
      auth,
      request,
      PROPOSAL_TOOL_NAMES.UPDATE_PROPOSAL,
      conversationId,
    );

    const provenance = buildProvenanceEnvelope(
      requestorContext,
      params.influences,
      params.generatedWithVersion,
    );

    const dto: UpdateProposalDto = {};

    if (params.updates !== undefined) {
      dto.updates = params.updates as UpdateProposalDto['updates'];
    }
    if (params.eli5 !== undefined) dto.eli5 = params.eli5;
    if (provenance.influences) {
      dto.influences = provenance.influences as UpdateProposalDto['influences'];
    }
    if (provenance.generatedWithVersion) {
      dto.generatedWithVersion = provenance.generatedWithVersion;
    }
    dto.requestorContext =
      requestorContext as UpdateProposalDto['requestorContext'];
    if (conversationId) dto.conversationId = conversationId;

    const fieldCount = [
      params.updates,
      params.influences,
      params.generatedWithVersion,
      params.eli5,
    ].filter((v) => v !== undefined).length;

    if (fieldCount === 0) {
      return mcpError(
        'No update fields provided. Include at least one field ' +
          'to change (updates, eli5, influences, generatedWithVersion).',
      );
    }

    try {
      if (params.groupContext) {
        const { proposal, groupedAuthoring } = await this.reviseGroupedProposal(
          {
            organizationId: auth.organizationId,
            projectId: projectId as ProjectId,
            userId: auth.user.userId,
            proposalId: params.proposalId,
            groupContext: params.groupContext,
            requestorContext,
            updates: dto.updates,
            influences: dto.influences,
            generatedWithVersion: dto.generatedWithVersion,
            eli5: dto.eli5,
            conversationId,
          },
        );
        return {
          id: proposal.id,
          status: proposal.status,
          action: proposal.action,
          targetEntityType: proposal.targetEntityType,
          targetEntityId: proposal.targetEntityId,
          updatedAt: proposal.updatedAt,
          groupedAuthoring,
        };
      }

      if (params.updates?.status !== undefined) {
        const existing = await this.proposalService.findOne(
          params.proposalId,
          auth.organizationId,
          projectId as ProjectId,
        );
        const validation = await this.validateProposalStatusUpdate({
          organizationId: auth.organizationId,
          projectId: projectId as ProjectId,
          targetEntityId: existing.targetEntityId,
          targetEntityType: existing.targetEntityType,
          status: params.updates.status,
        });
        if (!validation.ok) {
          this.logger.warn(`update_proposal rejected: ${validation.error}`);
          return mcpError(validation.error);
        }
      }

      const proposal = await this.proposalService.update(
        params.proposalId,
        auth.organizationId,
        projectId as ProjectId,
        dto,
        auth.user.userId,
        auth.token,
      );

      this.logger.log(
        `update_proposal succeeded: ${proposal.id} in project ${projectId}`,
      );

      return {
        id: proposal.id,
        status: proposal.status,
        action: proposal.action,
        targetEntityType: proposal.targetEntityType,
        targetEntityId: proposal.targetEntityId,
        updatedAt: proposal.updatedAt,
      };
    } catch (error: unknown) {
      const invalidChangeSet = invalidProposalChangeSetFromError(error);
      if (invalidChangeSet) return invalidChangeSet;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`update_proposal failed: ${message}`);
      return mcpError(message);
    }
  }

  @Tool({
    name: PROPOSAL_TOOL_NAMES.DELETE_PROPOSAL,
    description:
      'Delete an existing proposal record by ID. The deletion is scoped to ' +
      'the authenticated organization and project and reuses the API proposal ' +
      'lifecycle safeguards. This removes the proposal record; it does not ' +
      'approve or enact an entity DELETE proposal.',
    parameters: deleteProposalParameters,
    outputSchema: deleteProposalOutput,
  })
  async deleteProposal(
    params: z.infer<typeof deleteProposalParameters>,
    _context: Context,
    request: Request,
  ): Promise<DeleteProposalOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const projectId = request.headers['x-project-id'] as string | undefined;
    if (!projectId) {
      return mcpError(
        'Missing project context. Ensure X-Project-ID header is set.',
      );
    }

    try {
      await this.proposalService.delete(
        params.proposalId,
        auth.organizationId,
        projectId as ProjectId,
      );

      this.logger.log(
        `delete_proposal succeeded: ${params.proposalId} in project ${projectId}`,
      );

      return { deleted: true, proposalId: params.proposalId };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`delete_proposal failed: ${message}`);
      return mcpError(message);
    }
  }

  @Tool({
    name: PROPOSAL_TOOL_NAMES.GET_PROPOSAL,
    description:
      'Fetch the current state of a proposal by ID. Returns status, ' +
      'action, targetEntityType, targetEntityId, conversationId, and ' +
      'timestamps. Use this to resolve a proposal handle to the real ' +
      'materialized entity ID once the proposal has been APPROVED — the ' +
      "proposal's targetEntityId is rewritten at enactment time to match " +
      'the entity actually created. Works for DRAFT, APPROVED, and ' +
      'REJECTED proposals.',
    parameters: getProposalParameters,
    outputSchema: getProposalOutput,
  })
  async getProposal(
    params: z.infer<typeof getProposalParameters>,
    _context: Context,
    request: Request,
  ): Promise<GetProposalOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const projectId = request.headers['x-project-id'] as string | undefined;
    if (!projectId) {
      return mcpError(
        'Missing project context. Ensure X-Project-ID header is set.',
      );
    }

    try {
      const proposal = await this.proposalService.findOne(
        params.proposalId,
        auth.organizationId,
        projectId as ProjectId,
      );

      this.logger.log(
        `get_proposal succeeded: ${proposal.id} (${proposal.status}) ` +
          `in project ${projectId}`,
      );

      return {
        id: proposal.id,
        status: proposal.status,
        action: proposal.action,
        targetEntityType: proposal.targetEntityType,
        targetEntityId: proposal.targetEntityId,
        ...(proposal.conversationId
          ? { conversationId: proposal.conversationId }
          : {}),
        ...(proposal.edges ? { edges: proposal.edges } : {}),
        createdAt: proposal.createdAt,
        updatedAt: proposal.updatedAt,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`get_proposal failed: ${message}`);
      return mcpError(message);
    }
  }

  @Tool({
    name: PROPOSAL_TOOL_NAMES.GET_FUTURE_REVISION,
    description:
      'Read one reviewed future revision by its futureId: the reviewed ' +
      'result, baseline, history, completion dependencies, and ' +
      'completionEligibility with blockers. Other reads (get_context, ' +
      'get_full_entity) return live content only; this is the only way to ' +
      'see a future, and it never merges independent futures.',
    parameters: getFutureRevisionParameters,
    outputSchema: getFutureRevisionOutput,
  })
  async getFutureRevision(
    params: z.infer<typeof getFutureRevisionParameters>,
    _context: Context,
    request: Request,
  ): Promise<GetFutureRevisionOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const projectId = request.headers['x-project-id'] as string | undefined;
    if (!projectId) {
      return mcpError(
        'Missing project context. Ensure X-Project-ID header is set.',
      );
    }

    try {
      const future = await readFutureRevision(
        this.prisma.db,
        this.workItemTypeRegistry,
        params.futureId,
        auth.organizationId,
        projectId,
      );
      this.logger.log(
        `get_future_revision succeeded: ${future.id} (revision ` +
          `${future.revision}, eligible ` +
          `${future.completionEligibility.eligible}) in project ${projectId}`,
      );
      return { future: future as unknown as Record<string, unknown> };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`get_future_revision failed: ${message}`);
      return mcpError(message);
    }
  }
}
