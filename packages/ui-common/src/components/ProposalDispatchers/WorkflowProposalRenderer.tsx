import AccountTreeIcon from "@mui/icons-material/AccountTree";
import {
  AgentEdgeCategory,
  AgentEdgeDirection,
  AgentEdgeType,
  ProposalAction,
  TaskSource,
  WorkStatus,
  type AgentEdgeResponseDto,
  type CreateTaskDto,
  type MaterializedWorkItemSection,
  type ProposalResponseDto,
  type TaskResponseDto,
  type UpdateTaskDto,
  type WorkItemTypeDefinitionDto,
} from "../../api";
import {
  Alert,
  Box,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import React, { useEffect, useMemo, useState } from "react";
import { usePathService } from "../../contexts/PathServiceContext";
import { proposalsClient } from "../../clients/serviceClients";
import { formatWorkflowCompactDescription } from "../../utils/workflowDescriptionFormatting";
import { isBuiltInTaskSectionKey } from "../../utils/workItemSections";
import { getEntityColors } from "../../utils/entityIcons";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import { renderInlineMentions } from "../SmarterTextAreaCard/renderInlineMentions";
import { WorkflowGraphSurface } from "../shared/WorkflowMentionInlineRenderer";
import type { WorkflowGraphSurfaceData } from "../shared/WorkflowMentionInlineRenderer";
import { ProposalEdges } from "./ProposalEdges";
import { ProposalStateIndicator } from "./ProposalStateIndicator";
import type { ApprovalProgress } from "../../permissions";
import type { ProposalRenderOverrides } from "./proposalRenderOverrides";
import { updateProposalTitleLinkSx } from "./updateProposalTitleLinkSx";
import { ProposalTitle } from "./ProposalTitle";
import { getEntry, setNewEntityId } from "./proposalSelectedStateCache";
import {
  staticProposalTypePresentation,
  useProposalHeaderTypeResolution,
} from "./proposalHeaderType";
import {
  resolveProposalWorkItemSections,
  type ProposalWorkItemSection,
} from "./workItemProposalSections";
import type {
  ProposedWorkflowFlowLink,
  ProposedWorkflowStep,
  WorkflowCreateProposalUpdates,
  WorkflowUpdateProposalUpdates,
  ProposalItemStatus,
} from "./types";
import { isPlaceholderEntityId } from "./types";

const WORKFLOW_PROPOSAL_NOW = "1970-01-01T00:00:00.000Z";

const FLOW_EDGE_TYPES = [
  AgentEdgeType.Standard,
  AgentEdgeType.Conditional,
  AgentEdgeType.Loop,
] as const;

const AGENT_EDGE_TYPES: ReadonlySet<AgentEdgeType> = new Set(
  Object.values(AgentEdgeType),
);

const isRenderableTaskSectionKey = (key: string): boolean =>
  isBuiltInTaskSectionKey(key) || key === "graphPresentation";

const sectionContentToMaterializedMarkdown = (content: unknown): string =>
  typeof content === "string"
    ? content
    : content === null || content === undefined
      ? ""
      : JSON.stringify(content);

const isAgentEdgeType = (value: unknown): value is AgentEdgeType =>
  typeof value === "string" && AGENT_EDGE_TYPES.has(value as AgentEdgeType);

const isFlowEdgeType = (value: AgentEdgeType): boolean =>
  FLOW_EDGE_TYPES.includes(value as (typeof FLOW_EDGE_TYPES)[number]);

const sectionInputsToMaterializedSections = (
  sections: CreateTaskDto["sections"] | UpdateTaskDto["sections"] | undefined,
): MaterializedWorkItemSection[] =>
  (sections ?? []).flatMap((section, index) =>
    isRenderableTaskSectionKey(section.key)
      ? [
          {
            id: `${section.key}-${index}`,
            key: section.key,
            order: section.order ?? index,
            materializedMarkdown: sectionContentToMaterializedMarkdown(
              section.content,
            ),
            materializedProposalId: "",
          },
        ]
      : [],
  );

const projectedSectionsToMaterializedSections = (
  sections: readonly ProposalWorkItemSection[],
): MaterializedWorkItemSection[] =>
  sections.flatMap((section, index) =>
    isRenderableTaskSectionKey(section.key)
      ? [
          {
            id: `${section.key}-${index}`,
            key: section.key,
            order: index,
            materializedMarkdown: section.proposedContent,
            materializedProposalId: "",
          },
        ]
      : [],
  );

const proposedStepSections = (
  step: ProposedWorkflowStep,
): MaterializedWorkItemSection[] => {
  const sections = sectionInputsToMaterializedSections(step.sections);
  if (sections.length > 0 || !step.description) {
    return sections;
  }
  return [
    {
      id: `${"description"}-0`,
      key: "description",
      materializedMarkdown: step.description,
      materializedProposalId: "",
      order: 0,
    },
  ];
};

const getSectionContent = (
  sections: TaskResponseDto["sections"] | undefined,
  key: string,
): string =>
  sections
    ?.find((section) => section.key === key)
    ?.materializedMarkdown.trim() ?? "";

const getBodySections = (
  updates: WorkflowCreateProposalUpdates | WorkflowUpdateProposalUpdates,
  existing: TaskResponseDto | undefined,
  definition: WorkItemTypeDefinitionDto | undefined,
): MaterializedWorkItemSection[] => {
  if (updates.sections !== undefined && definition) {
    return projectedSectionsToMaterializedSections(
      resolveProposalWorkItemSections({
        definition,
        proposedSections: updates.sections,
        existingSections: existing?.sections,
      }),
    );
  }
  return existing?.sections ?? [];
};

const makeWorkflowTask = <T extends "workflow" | "workflow_step">({
  id,
  name,
  type,
  organizationId,
  projectId,
  parentTaskId,
  sections,
  edges,
}: {
  id: string;
  name: string;
  type: T;
  organizationId: string;
  projectId: string;
  parentTaskId?: string | null;
  sections?: TaskResponseDto["sections"];
  edges?: AgentEdgeResponseDto[];
}): TaskResponseDto & { type: T } => ({
  id,
  name,
  type,
  sections,
  organizationId,
  projectId,
  status: WorkStatus.Backlog,
  source: TaskSource.Agent,
  parentTaskId: parentTaskId ?? undefined,
  edges,
  createdAt: WORKFLOW_PROPOSAL_NOW,
  updatedAt: WORKFLOW_PROPOSAL_NOW,
});

const stepTitle = (step: ProposedWorkflowStep): string =>
  step.name ?? step.title ?? "";

const nonEmptyString = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const proposedStepNodeId = (step: ProposedWorkflowStep): string | null =>
  nonEmptyString(step.id) ?? nonEmptyString(step.tempId);

const proposedStepToTask = (
  step: ProposedWorkflowStep,
  stepNodeId: string,
  workflowId: string,
  organizationId: string,
  projectId: string,
  edges: AgentEdgeResponseDto[],
): TaskResponseDto & { type: "workflow_step" } =>
  makeWorkflowTask({
    id: stepNodeId,
    name: stepTitle(step),
    type: "workflow_step",
    organizationId,
    projectId,
    parentTaskId: workflowId,
    sections: proposedStepSections(step),
    edges,
  });

const proposedLinkEndpoint = (
  link: ProposedWorkflowFlowLink,
  keys: Array<
    | "sourceNodeId"
    | "targetNodeId"
    | "sourceStepId"
    | "targetStepId"
    | "sourceStepTempId"
    | "targetStepTempId"
    | "targetTaskId"
  >,
): string | null => {
  for (const key of keys) {
    const endpoint = nonEmptyString(link[key]);
    if (endpoint) {
      return endpoint;
    }
  }

  return null;
};

const proposedLinkToEdge = (
  link: ProposedWorkflowFlowLink,
  index: number,
): AgentEdgeResponseDto | null => {
  if (!isAgentEdgeType(link.type)) {
    return null;
  }

  const sourceNodeId = proposedLinkEndpoint(link, [
    "sourceNodeId",
    "sourceStepId",
    "sourceStepTempId",
  ]);
  const targetNodeId = proposedLinkEndpoint(link, [
    "targetNodeId",
    "targetStepId",
    "targetStepTempId",
    "targetTaskId",
  ]);
  if (!sourceNodeId || !targetNodeId) {
    return null;
  }

  return {
    id:
      link.id ??
      `proposed-workflow-edge-${sourceNodeId}-${targetNodeId}-${link.type}-${index}`,
    sourceNodeId,
    targetNodeId,
    type: link.type,
    category:
      link.category ??
      (isFlowEdgeType(link.type)
        ? AgentEdgeCategory.Flow
        : AgentEdgeCategory.Meta),
    direction:
      link.direction ??
      (link.type === AgentEdgeType.Standard ||
      link.type === AgentEdgeType.Conditional
        ? AgentEdgeDirection.Forward
        : undefined),
    predicate: link.predicate,
    reasoning: link.reasoning ?? "",
    createdAt: WORKFLOW_PROPOSAL_NOW,
    updatedAt: WORKFLOW_PROPOSAL_NOW,
  };
};

const workflowStepsFromUpdates = (
  updates: WorkflowCreateProposalUpdates | WorkflowUpdateProposalUpdates,
): ProposedWorkflowStep[] => {
  if (updates.type !== "workflow") {
    return [];
  }
  return updates.workflowSteps ?? updates.steps ?? updates.initialSteps ?? [];
};

const workflowLinksFromUpdates = (
  updates: WorkflowCreateProposalUpdates | WorkflowUpdateProposalUpdates,
): ProposedWorkflowFlowLink[] => {
  if (updates.type !== "workflow") {
    return [];
  }
  return (
    updates.workflowLinks ??
    updates.flowLinks ??
    updates.links ??
    updates.edges ??
    []
  );
};

const buildProposedGraphData = (
  proposal: ProposalResponseDto & {
    updates: WorkflowCreateProposalUpdates | WorkflowUpdateProposalUpdates;
  },
  existing: TaskResponseDto | undefined,
  definition: WorkItemTypeDefinitionDto | undefined,
): WorkflowGraphSurfaceData | null => {
  if (proposal.updates.type !== "workflow") {
    return null;
  }

  const proposedSteps = workflowStepsFromUpdates(proposal.updates)
    .map((step) => ({ step, nodeId: proposedStepNodeId(step) }))
    .filter(
      (
        stepWithNodeId,
      ): stepWithNodeId is {
        step: ProposedWorkflowStep;
        nodeId: string;
      } => stepWithNodeId.nodeId !== null,
    );
  if (proposedSteps.length === 0) {
    return null;
  }

  const edges = workflowLinksFromUpdates(proposal.updates)
    .map(proposedLinkToEdge)
    .filter((edge): edge is AgentEdgeResponseDto => edge !== null);

  const workflow = makeWorkflowTask({
    id: proposal.targetEntityId || proposal.id,
    name: proposal.updates.name ?? existing?.name ?? "Proposed workflow",
    type: "workflow",
    organizationId: proposal.organizationId,
    projectId: proposal.projectId,
    sections: getBodySections(proposal.updates, existing, definition),
    edges: [],
  });

  const edgesBySource = new Map<string, AgentEdgeResponseDto[]>();
  edges.forEach((edge) => {
    edgesBySource.set(edge.sourceNodeId, [
      ...(edgesBySource.get(edge.sourceNodeId) ?? []),
      edge,
    ]);
  });

  return {
    workflow,
    steps: proposedSteps.map(({ step, nodeId }) =>
      proposedStepToTask(
        step,
        nodeId,
        workflow.id,
        proposal.organizationId,
        proposal.projectId,
        edgesBySource.get(nodeId) ?? [],
      ),
    ),
    edges,
    participation: null,
  };
};

interface WorkflowProposalRendererCommonProps {
  proposal: ProposalResponseDto & {
    updates: WorkflowCreateProposalUpdates | WorkflowUpdateProposalUpdates;
  };
  status: ProposalItemStatus;
  onApply: () => void;
  onReject?: (reason: string) => Promise<void>;
  disabled?: boolean;
  siblingProposals?: Map<string, ProposalResponseDto>;
  approvalProgress?: ApprovalProgress;
  overrides?: ProposalRenderOverrides;
}

type WorkflowProposalRendererProps =
  | (WorkflowProposalRendererCommonProps & {
      mode: "create";
      existing?: never;
    })
  | (WorkflowProposalRendererCommonProps & {
      mode: "update";
      existing: TaskResponseDto;
      workItemTypeDefinition: WorkItemTypeDefinitionDto;
      typeLabel?: never;
    });

type ResolvedWorkflowProposalRendererProps =
  WorkflowProposalRendererCommonProps & {
    mode: "create" | "update";
    existing?: TaskResponseDto;
    workItemTypeDefinition: WorkItemTypeDefinitionDto;
  };

const ResolvedWorkflowProposalRenderer: React.FC<
  ResolvedWorkflowProposalRendererProps
> = (props) => {
  const {
    proposal,
    status,
    onApply,
    onReject,
    disabled,
    siblingProposals,
    approvalProgress,
    overrides,
  } = props;
  const existing = props.mode === "update" ? props.existing : undefined;
  const workItemTypeDefinition = props.workItemTypeDefinition;
  const typeLabel = workItemTypeDefinition.name;
  const pathService = usePathService();
  const [cachedEntityId, setCachedEntityId] = useState(
    () => getEntry(proposal.id)?.newEntityId ?? proposal.targetEntityId,
  );
  const resolvedEntityId = isPlaceholderEntityId(proposal.targetEntityId)
    ? cachedEntityId
    : proposal.targetEntityId;
  const [pollAttempt, setPollAttempt] = useState(0);
  const shouldResolveLegacyPlaceholder =
    props.mode === "create" &&
    isPlaceholderEntityId(proposal.targetEntityId) &&
    isPlaceholderEntityId(resolvedEntityId);

  useEffect(() => {
    if (status.state !== "applied" || !shouldResolveLegacyPlaceholder) {
      return;
    }
    if (pollAttempt >= 5) return;

    const timer = setTimeout(async () => {
      try {
        const response = await proposalsClient.getProposal({
          organizationId: proposal.organizationId,
          projectId: proposal.projectId,
          proposalId: proposal.id,
        });
        const updated = response.data.data;
        if (
          updated?.targetEntityId &&
          !isPlaceholderEntityId(updated.targetEntityId)
        ) {
          setCachedEntityId(updated.targetEntityId);
          setNewEntityId(proposal.id, updated.targetEntityId);
          return;
        }
      } catch {
        // Fall through to schedule the next attempt.
      }
      setPollAttempt((attempt) => attempt + 1);
    }, 3000);

    return () => clearTimeout(timer);
  }, [
    pollAttempt,
    proposal.id,
    proposal.organizationId,
    proposal.projectId,
    resolvedEntityId,
    shouldResolveLegacyPlaceholder,
    status.state,
  ]);

  const graphData = useMemo(
    () => buildProposedGraphData(proposal, existing, workItemTypeDefinition),
    [proposal, existing, workItemTypeDefinition],
  );
  const workflowType =
    proposal.updates.type === "workflow" ? "workflow" : "workflow_step";
  const title =
    proposal.updates.name ?? existing?.name ?? "Proposed workflow item";
  const sections = getBodySections(
    proposal.updates,
    existing,
    workItemTypeDefinition,
  );
  const proposedSections = workItemTypeDefinition
    ? resolveProposalWorkItemSections({
        definition: workItemTypeDefinition,
        proposedSections: proposal.updates.sections,
        existingSections: existing?.sections,
      })
    : [];
  const proposedDescriptionSection = proposedSections.find(
    (section) => section.key === "description",
  );
  const description = getSectionContent(sections, "description");
  const compactDescription = formatWorkflowCompactDescription(
    proposedDescriptionSection?.proposedContent ?? description,
  );
  const descriptionLabel =
    proposedDescriptionSection?.label ??
    workItemTypeDefinition.sections.find(({ key }) => key === "description")
      ?.label;
  const shouldRenderDescription =
    proposedDescriptionSection !== undefined || compactDescription.length > 0;
  const additionalSections = proposedSections.filter(
    (section) => section.key !== "description",
  );

  const paperSx: Record<string, unknown> =
    overrides?.maxWidth !== undefined
      ? { p: 2, width: "100%", maxWidth: overrides.maxWidth }
      : { p: 2 };
  if (overrides?.border) {
    paperSx.border = overrides.border;
  }

  const titleSx = overrides?.titleFontSize
    ? { fontSize: overrides.titleFontSize }
    : undefined;
  const titleHref = useMemo(
    () =>
      status.state === "applied" && !isPlaceholderEntityId(resolvedEntityId)
        ? pathService.task({
            projectId: proposal.projectId,
            taskId: resolvedEntityId,
          })
        : null,
    [pathService, proposal.projectId, resolvedEntityId, status.state],
  );
  const typeIcon = AccountTreeIcon;

  const content = (
    <Stack spacing={1.5}>
      {!overrides?.hideHeader && (
        <ProposalTitle
          proposal={proposal}
          resolvedTargetName={title}
          typePresentation={staticProposalTypePresentation(
            typeLabel,
            typeIcon,
            getEntityColors(workflowType),
          )}
          target={
            titleHref
              ? {
                  entityId: resolvedEntityId,
                  href: titleHref,
                  sx:
                    proposal.action === ProposalAction.Update
                      ? updateProposalTitleLinkSx
                      : {
                          textDecoration: "none",
                          color: "inherit",
                          "&:hover": { textDecoration: "underline" },
                        },
                }
              : undefined
          }
          hideTypeChip={overrides?.hideTypeChip}
          titleSx={titleSx}
        />
      )}

      {shouldRenderDescription && (
        <Stack spacing={0.5}>
          {descriptionLabel && (
            <Typography variant="caption" color="text.secondary">
              {descriptionLabel}
            </Typography>
          )}
          <Typography
            variant="body2"
            color="text.secondary"
            component="div"
            data-testid="workflow-proposal-description"
            sx={{
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              overflowWrap: "anywhere",
              whiteSpace: "pre-wrap",
            }}
          >
            {compactDescription
              ? renderInlineMentions(compactDescription, "minimal", {
                  disableLinks: true,
                })
              : "(empty)"}
          </Typography>
        </Stack>
      )}
      {additionalSections.map((section) => (
        <Stack
          key={section.key}
          spacing={0.5}
          data-testid="workflow-proposal-section"
          data-section-key={section.key}
        >
          <Typography variant="caption" color="text.secondary">
            {section.label}
          </Typography>
          <Typography variant="body2" color="text.secondary" component="div">
            <MarkdownRenderer allowMentionEscapes disableMentionLinks>
              {section.proposedContent || "(empty)"}
            </MarkdownRenderer>
          </Typography>
        </Stack>
      ))}

      {graphData && (
        <Box data-testid="workflow-proposal-graph">
          <WorkflowGraphSurface graphData={graphData} disableLinks />
        </Box>
      )}

      {siblingProposals && (
        <ProposalEdges
          edges={proposal.edges}
          siblingProposals={siblingProposals}
          organizationId={proposal.organizationId}
          projectId={proposal.projectId}
          ownerApplied={status.state === "applied"}
        />
      )}

      {!overrides?.hideStateIndicator && (
        <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
          <ProposalStateIndicator
            status={status}
            action={proposal.action}
            onApply={onApply}
            onReject={onReject}
            disabled={disabled}
            approvalProgress={approvalProgress}
            applyLabel={overrides?.applyLabel}
          />
        </Box>
      )}
    </Stack>
  );

  return overrides?.hideCard ? (
    content
  ) : (
    <Paper
      variant="outlined"
      sx={paperSx}
      data-testid="workflow-proposal-card"
      data-workflow-proposal-type={workflowType}
    >
      {content}
    </Paper>
  );
};

const WorkflowCreateProposalRenderer: React.FC<
  Extract<WorkflowProposalRendererProps, { mode: "create" }>
> = (props) => {
  const typeResolution = useProposalHeaderTypeResolution(
    props.proposal.organizationId,
    props.proposal.projectId,
    { kind: "task", taskType: props.proposal.updates.type },
  );
  const paperSx: Record<string, unknown> =
    props.overrides?.maxWidth !== undefined
      ? { p: 2, width: "100%", maxWidth: props.overrides.maxWidth }
      : { p: 2 };
  if (props.overrides?.border) {
    paperSx.border = props.overrides.border;
  }
  const wrapResolutionContent = (
    content: React.ReactElement,
  ): React.ReactElement =>
    props.overrides?.hideCard ? (
      content
    ) : (
      <Paper variant="outlined" sx={paperSx}>
        {content}
      </Paper>
    );

  if (typeResolution.isLoading) {
    return wrapResolutionContent(
      <Box
        sx={{ display: "flex", justifyContent: "center", py: 3 }}
        data-testid="workflow-create-work-item-type-loading"
      >
        <CircularProgress size={24} />
      </Box>,
    );
  }

  if (typeResolution.error) {
    return wrapResolutionContent(
      <Alert
        severity="error"
        data-testid="workflow-create-work-item-type-error"
      >
        Failed to load the work-item type registry:{" "}
        {typeResolution.error.message}
      </Alert>,
    );
  }

  if (
    !typeResolution.definition ||
    typeResolution.definition.key !== props.proposal.updates.type
  ) {
    return wrapResolutionContent(
      <Alert
        severity="warning"
        data-testid="workflow-create-work-item-type-unavailable"
      >
        The work-item type definition is unavailable for this proposal.
      </Alert>,
    );
  }

  return (
    <ResolvedWorkflowProposalRenderer
      {...props}
      workItemTypeDefinition={typeResolution.definition}
    />
  );
};

export const WorkflowProposalRenderer: React.FC<
  WorkflowProposalRendererProps
> = (props) =>
  props.mode === "create" ? (
    <WorkflowCreateProposalRenderer {...props} />
  ) : (
    <ResolvedWorkflowProposalRenderer {...props} />
  );
