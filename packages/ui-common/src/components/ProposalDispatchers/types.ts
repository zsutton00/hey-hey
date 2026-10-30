import type { ReactNode } from "react";
import {
  AgentEdgeCategory,
  AgentEdgeDirection,
  AgentEdgeType,
  ProposalAction,
  ProposalStatus,
  TargetEntityType,
  WorkItemChangeSetMaterializationState,
  WorkItemTypeRole,
} from "../../api";
import type {
  ProposalResponseDto,
  CreateTaskDto,
  UpdateTaskDto,
  CreateDesignDocDto,
  UpdateDesignDocDto,
  WorkItemTypeDefinitionDto,
  WorkItemTypeArchiveRequestDto,
  WorkItemChangeSetValidationRequest,
  WorkItemChangeSetOperation,
  ProposalApprovalFailureDiagnostic,
  UpdateProposalDto,
} from "../../api";
import type { DiffViewMode } from "../SuggestedContent";

/**
 * Application state for an individual proposal item.
 * Distinct from ProposalStatus (DRAFT/PENDING/APPROVED/REJECTED) which
 * tracks the approval lifecycle. This tracks the UI application lifecycle
 * after the user clicks "Apply".
 */
export type ProposalItemState =
  "pending" | "applying" | "applied" | "rejected" | "failed";

export interface ProposalItemStatus {
  /** Approval can precede application for a future revision. */
  reviewAccepted?: boolean;
  state: ProposalItemState;
  error?: string;
  diagnostic?: ProposalApprovalFailureDiagnostic;
}

/**
 * Code change item from a reconciliation report. Not a TargetEntityType,
 * so handled as a separate rendering path.
 */
export interface CodeChangeProposal {
  id: string;
  filePath: string;
  currentSnippet: string;
  proposedSnippet: string;
  reasoning: string;
  severity: "low" | "medium" | "high";
}

/**
 * Task proposals can author the complete task-to-service relation set. This is
 * proposal-envelope metadata: the approval service removes it before passing
 * the remaining fields to the task create/update DTO.
 */
interface TaskServiceAssignmentUpdates {
  serviceIds?: string[];
}

export type CreateTaskProposalUpdates = CreateTaskDto &
  TaskServiceAssignmentUpdates;

export type UpdateTaskProposalUpdates = UpdateTaskDto &
  TaskServiceAssignmentUpdates;

/**
 * Callback invoked when the user applies a proposal item.
 * Returns a promise that resolves on success or rejects on failure.
 */
export type ProposalApprovalRequest = Pick<
  UpdateProposalDto,
  "reviewedReconciliationRevisionId"
>;

export type OnApplyProposal = (
  proposalId: string,
  approvalRequest?: ProposalApprovalRequest,
) => Promise<void | ProposalResponseDto>;

/** Called after a proposal has been durably applied by the server. */
export type OnAppliedProposal = (proposalId: string) => void | Promise<void>;

/**
 * Callback invoked when the user rejects a proposal item.
 * The reason is empty when a CREATE proposal is rejected without one.
 * Returns a promise so the UI can track loading/error state.
 */
export type OnRejectProposal = (
  proposalId: string,
  reason: string,
) => Promise<void>;

/**
 * "evaluation-output" shows a saved eval attempt's proposal read-only: no
 * approve, reject or apply control, and diffs come from the content retained
 * when the attempt ran. Display only; the server refuses to apply it.
 */
export type ProposalRenderMode =
  | "standalone"
  | "group-member"
  | "detail"
  | "future-review"
  | "reconciliation-refinement"
  | "evaluation-output";

/**
 * Props for the CreateProposal dispatcher component.
 */
export interface CreateProposalProps {
  proposals: ProposalResponseDto[];
  onApply: OnApplyProposal;
  onApplied?: OnAppliedProposal;
  onReject?: OnRejectProposal;
  disabled?: boolean;
  /** All proposals from the same message/session, used for edge resolution. */
  allProposals?: ProposalResponseDto[];
  renderMode?: ProposalRenderMode;
}

/**
 * Props for the UpdateProposal dispatcher component.
 */
export interface UpdateProposalProps {
  /** Places the existing future controls outside the comparison scroll area. */
  renderFutureFooter?: (footer: ReactNode) => ReactNode;
  proposals: ProposalResponseDto[];
  onApply: OnApplyProposal;
  onApplied?: OnAppliedProposal;
  onReject?: OnRejectProposal;
  organizationId: string;
  projectId: string;
  disabled?: boolean;
  /** All proposals from the same message/session, used for edge resolution. */
  allProposals?: ProposalResponseDto[];
  /**
   * Default view mode applied to the DiffRenderer inside each update
   * proposal card. When omitted, renderers fall back to "split".
   */
  diffDefaultViewMode?: DiffViewMode;
  renderMode?: ProposalRenderMode;
}

/**
 * Props for the DeleteProposal dispatcher component.
 */
export interface DeleteProposalProps {
  proposals: ProposalResponseDto[];
  onApply: OnApplyProposal;
  onApplied?: OnAppliedProposal;
  onReject?: OnRejectProposal;
  organizationId: string;
  projectId: string;
  disabled?: boolean;
  /** All proposals from the same message/session, used for edge resolution. */
  allProposals?: ProposalResponseDto[];
  renderMode?: ProposalRenderMode;
}

/**
 * Props for the CodeChangeReviewSurface component.
 */
export interface CodeChangeReviewSurfaceProps {
  codeChanges: CodeChangeProposal[];
}

/**
 * Type guard helpers for narrowing ProposalResponseDto.updates
 * based on action and targetEntityType.
 */
export const isCreateTaskUpdates = (
  proposal: ProposalResponseDto,
): proposal is ProposalResponseDto & { updates: CreateTaskProposalUpdates } =>
  proposal.action === ProposalAction.Create &&
  proposal.targetEntityType === TargetEntityType.Task;

export const isUpdateTaskUpdates = (
  proposal: ProposalResponseDto,
): proposal is ProposalResponseDto & { updates: UpdateTaskProposalUpdates } =>
  proposal.action === ProposalAction.Update &&
  proposal.targetEntityType === TargetEntityType.Task;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Relationship declarations are proposal-envelope content. An UPDATE with
 * no ordinary fields must still render when its top-level edge set is nonempty.
 */
export const isEdgeOnlyUpdateProposal = (
  proposal: ProposalResponseDto,
): boolean =>
  proposal.action === ProposalAction.Update &&
  isRecord(proposal.updates) &&
  Object.keys(proposal.updates).length === 0 &&
  (proposal.edges?.length ?? 0) > 0;

const isChangeSetIdentity = (
  value: unknown,
): value is WorkItemChangeSetValidationRequest["root"] => {
  if (!isRecord(value)) return false;
  return (
    (value.refType === "existing" && typeof value.id === "string") ||
    (value.refType === "temporary" && typeof value.tempId === "string")
  );
};

const isWorkItemChangeSetOperation = (
  value: unknown,
): value is WorkItemChangeSetOperation => {
  if (!isRecord(value)) return false;
  switch (value.op) {
    case "layout.clear":
    case "layout.replace":
    case "relationship.create":
    case "relationship.delete":
    case "relationship.update":
    case "section.clear":
    case "section.replace":
    case "workItem.create":
    case "workItem.delete":
    case "workItem.update":
      return true;
    default:
      return false;
  }
};

export const isWorkItemGraphProposal = (
  proposal: ProposalResponseDto,
): proposal is ProposalResponseDto & {
  updates: WorkItemChangeSetValidationRequest;
} => {
  if (
    (proposal.action !== ProposalAction.Create &&
      proposal.action !== ProposalAction.Update) ||
    proposal.targetEntityType !== TargetEntityType.Task ||
    !isRecord(proposal.updates)
  ) {
    return false;
  }

  return (
    isChangeSetIdentity(proposal.updates.root) &&
    Array.isArray(proposal.updates.operations) &&
    proposal.updates.operations.every(isWorkItemChangeSetOperation)
  );
};

export const getProposalMaterializationStatus = (
  proposal: ProposalResponseDto,
): ProposalItemStatus | undefined => {
  const progress = proposal.materialization;
  if (!progress) {
    return isWorkItemGraphProposal(proposal) &&
      proposal.status === ProposalStatus.Approved
      ? { state: "applying" }
      : undefined;
  }

  switch (progress.state) {
    case WorkItemChangeSetMaterializationState.Published:
      return { state: "applied" };
    case WorkItemChangeSetMaterializationState.Queued:
    case WorkItemChangeSetMaterializationState.Applying:
      return { state: "applying" };
    case WorkItemChangeSetMaterializationState.RecoverableFailure:
      return {
        state: "failed",
        ...(progress.lastError ? { error: progress.lastError } : {}),
        ...(progress.diagnostic ? { diagnostic: progress.diagnostic } : {}),
      };
  }
};

export const getCreatedGraphRootType = (
  updates: WorkItemChangeSetValidationRequest,
): string | undefined => {
  const root = updates.root;
  if (root.refType !== "temporary") return undefined;

  for (const operation of updates.operations) {
    if (
      operation.op === "workItem.create" &&
      operation.ref.tempId === root.tempId
    ) {
      return operation.type;
    }
  }
  return undefined;
};

const taskTypeFromUpdates = (
  updates: CreateTaskDto | UpdateTaskDto | Record<string, unknown>,
): string | undefined => {
  const value = updates.type;
  return typeof value === "string" ? value : undefined;
};

const isWorkflowTaskType = (type: string | undefined): boolean =>
  type === "workflow" || type === "workflow_step";

const hasWorkflowTaskType = (
  updates: CreateTaskDto | UpdateTaskDto | Record<string, unknown>,
): boolean => isWorkflowTaskType(taskTypeFromUpdates(updates));

interface ProposedWorkflowStepFields {
  id?: string;
  tempId?: string;
  name?: string;
  title?: string;
  description?: string;
  sections?: CreateTaskDto["sections"];
}

interface ProposedWorkflowStepWithId extends ProposedWorkflowStepFields {
  id: string;
}

interface ProposedWorkflowStepWithTempId extends ProposedWorkflowStepFields {
  tempId: string;
}

export type ProposedWorkflowStep =
  ProposedWorkflowStepWithId | ProposedWorkflowStepWithTempId;

interface ProposedWorkflowFlowLinkFields {
  id?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  sourceStepId?: string;
  targetStepId?: string;
  sourceStepTempId?: string;
  targetStepTempId?: string;
  targetTaskId?: string;
  type: AgentEdgeType;
  category?: AgentEdgeCategory;
  direction?: AgentEdgeDirection | null;
  predicate?: string | null;
  reasoning?: string;
}

type ProposedWorkflowNodeLink = ProposedWorkflowFlowLinkFields &
  (
    | { sourceNodeId: string; targetNodeId: string }
    | { sourceStepId: string; targetStepId: string }
    | { sourceStepTempId: string; targetStepTempId: string }
  );

type ProposedWorkflowFulfillmentLink = ProposedWorkflowFlowLinkFields &
  (
    | { sourceNodeId: string; targetTaskId: string }
    | { sourceStepId: string; targetTaskId: string }
    | { sourceStepTempId: string; targetTaskId: string }
    | { sourceStepId: string; targetNodeId: string }
  );

export type ProposedWorkflowFlowLink =
  ProposedWorkflowNodeLink | ProposedWorkflowFulfillmentLink;

export interface CreateWorkflowProposalUpdates extends Omit<
  CreateTaskDto,
  "workflowSteps" | "workflowLinks"
> {
  type: "workflow";
  steps?: ProposedWorkflowStep[];
  initialSteps?: ProposedWorkflowStep[];
  workflowSteps?: ProposedWorkflowStep[];
  flowLinks?: ProposedWorkflowFlowLink[];
  links?: ProposedWorkflowFlowLink[];
  edges?: ProposedWorkflowFlowLink[];
  workflowLinks?: ProposedWorkflowFlowLink[];
}

export interface CreateWorkflowStepProposalUpdates extends CreateTaskDto {
  type: "workflow_step";
}

export interface UpdateWorkflowProposalUpdates extends UpdateTaskDto {
  type: "workflow";
  steps?: ProposedWorkflowStep[];
  initialSteps?: ProposedWorkflowStep[];
  workflowSteps?: ProposedWorkflowStep[];
  flowLinks?: ProposedWorkflowFlowLink[];
  links?: ProposedWorkflowFlowLink[];
  edges?: ProposedWorkflowFlowLink[];
  workflowLinks?: ProposedWorkflowFlowLink[];
}

export interface UpdateWorkflowStepProposalUpdates extends UpdateTaskDto {
  type: "workflow_step";
}

export type WorkflowCreateProposalUpdates =
  CreateWorkflowProposalUpdates | CreateWorkflowStepProposalUpdates;

export type WorkflowUpdateProposalUpdates =
  UpdateWorkflowProposalUpdates | UpdateWorkflowStepProposalUpdates;

const isCreateWorkflowUpdatesPayload = (
  updates: unknown,
): updates is WorkflowCreateProposalUpdates =>
  isRecord(updates) && hasWorkflowTaskType(updates);

const isUpdateWorkflowUpdatesPayload = (
  updates: unknown,
): updates is WorkflowUpdateProposalUpdates =>
  isRecord(updates) && hasWorkflowTaskType(updates);

export const isCreateWorkflowTaskUpdates = (
  proposal: ProposalResponseDto,
): proposal is ProposalResponseDto & {
  updates: WorkflowCreateProposalUpdates;
} =>
  isCreateTaskUpdates(proposal) &&
  isCreateWorkflowUpdatesPayload(proposal.updates);

export const isUpdateWorkflowTaskUpdates = (
  proposal: ProposalResponseDto,
): proposal is ProposalResponseDto & {
  updates: WorkflowUpdateProposalUpdates;
} =>
  isUpdateTaskUpdates(proposal) &&
  isUpdateWorkflowUpdatesPayload(proposal.updates);

export const isCreateDesignDocUpdates = (
  proposal: ProposalResponseDto,
): proposal is ProposalResponseDto & { updates: CreateDesignDocDto } =>
  proposal.action === ProposalAction.Create &&
  proposal.targetEntityType === TargetEntityType.DesignDoc;

export const isCreateWorkItemTypeUpdates = (
  proposal: ProposalResponseDto,
): proposal is ProposalResponseDto & { updates: WorkItemTypeDefinitionDto } =>
  proposal.action === ProposalAction.Create &&
  proposal.targetEntityType === TargetEntityType.WorkItemType &&
  isWorkItemTypeDefinition(proposal.updates);

export interface WorkItemTypeEditProposalUpdates {
  definition: WorkItemTypeDefinitionDto;
}

const isWorkItemTypeDefinition = (
  value: unknown,
): value is WorkItemTypeDefinitionDto =>
  isRecord(value) &&
  typeof value.key === "string" &&
  typeof value.name === "string" &&
  typeof value.role === "string" &&
  Object.values<string>(WorkItemTypeRole).includes(value.role) &&
  Array.isArray(value.sections) &&
  Array.isArray(value.allowedStatuses);

const isWorkItemTypeEditPayload = (
  value: unknown,
): value is WorkItemTypeEditProposalUpdates =>
  isRecord(value) && isWorkItemTypeDefinition(value.definition);

export const isUpdateWorkItemTypeUpdates = (
  proposal: ProposalResponseDto,
): proposal is ProposalResponseDto & {
  updates: WorkItemTypeEditProposalUpdates;
} =>
  proposal.action === ProposalAction.Update &&
  proposal.targetEntityType === TargetEntityType.WorkItemType &&
  isWorkItemTypeEditPayload(proposal.updates);

const isWorkItemTypeArchivePayload = (
  value: unknown,
): value is WorkItemTypeArchiveRequestDto => {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "reason")) {
    return false;
  }

  return (
    value.reason === undefined ||
    value.reason === null ||
    typeof value.reason === "string"
  );
};

export const isArchiveWorkItemTypeUpdates = (
  proposal: ProposalResponseDto,
): proposal is ProposalResponseDto & {
  updates: WorkItemTypeArchiveRequestDto;
} =>
  proposal.action === ProposalAction.Delete &&
  proposal.targetEntityType === TargetEntityType.WorkItemType &&
  isWorkItemTypeArchivePayload(proposal.updates);

/**
 * The nil UUID used as a placeholder targetEntityId before the backend
 * has finished creating the actual entity.
 */
export const PLACEHOLDER_ENTITY_ID = "00000000-0000-0000-0000-000000000000";

export const isPlaceholderEntityId = (id: string): boolean =>
  !id || id === PLACEHOLDER_ENTITY_ID;

export const isUpdateDesignDocUpdates = (
  proposal: ProposalResponseDto,
): proposal is ProposalResponseDto & { updates: UpdateDesignDocDto } =>
  proposal.action === ProposalAction.Update &&
  proposal.targetEntityType === TargetEntityType.DesignDoc;

/**
 * Updates payload carried by a plan-creation conversation proposal. Plans
 * are materialized via a `plan-from-design-doc` workflow conversation, so
 * the proposal's targetEntityType is CONVERSATION and the updates payload
 * carries the workflow name plus the rendered design-doc markdown that
 * seeds the new plan.
 */
export interface CreatePlanProposalUpdates {
  workflowName: string;
  designDocMarkdown: string;
  planTitle?: string;
  parentFeatureId?: string;
}

export const isCreatePlanProposal = (
  proposal: ProposalResponseDto,
): proposal is ProposalResponseDto & { updates: CreatePlanProposalUpdates } => {
  if (
    proposal.action !== ProposalAction.Create ||
    proposal.targetEntityType !== TargetEntityType.Conversation
  ) {
    return false;
  }
  const updates = proposal.updates as Partial<CreatePlanProposalUpdates>;
  return (
    typeof updates?.workflowName === "string" &&
    typeof updates?.designDocMarkdown === "string"
  );
};
