import {
  Alert,
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { EntityType, FeatureTag, ProposalAction } from "../../api";
import type {
  ProposalResponseDto,
  CreateTaskDto,
  Influence,
  UpdateTaskDto,
} from "../../api";
import { proposalsClient, tasksClient } from "../../clients/serviceClients";
import { useAuth } from "../../contexts/AuthContext";
import { usePathService } from "../../contexts/PathServiceContext";
import { FeatureTagBadge } from "../Features/FeatureTagBadge";
import {
  FEATURE_TAG_PALETTE,
  FEATURE_TAG_VALUES,
} from "../Features/featureTagPalette";
import { TaskTreePicker } from "../Selectors/TaskTreePicker";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import { StructuredRequirementsView } from "../shared/StructuredRequirementsView";
import type { ProposalItemStatus } from "./types";
import { isPlaceholderEntityId } from "./types";
import { ProposalStateIndicator } from "./ProposalStateIndicator";
import { ProposalEdges } from "./ProposalEdges";
import type { ApprovalProgress } from "../../permissions";
import type { ProposalRenderOverrides } from "./proposalRenderOverrides";
import { getEntry, setNewEntityId } from "./proposalSelectedStateCache";
import { ProposalTitle } from "./ProposalTitle";
import { useProposalHeaderTypeResolution } from "./proposalHeaderType";
import { useServices } from "../../data/hooks/useServices";
import type { CreateTaskProposalUpdates } from "./types";
import {
  formatServiceNames,
  resolveServiceNames,
} from "./taskServiceAssignments";
import { resolveProposalWorkItemSections } from "./workItemProposalSections";
import { HtmlCssSectionRenderer } from "../shared/HtmlCssSectionRenderer";
import { StructuredMockupSectionRenderer } from "../shared/StructuredMockupSectionRenderer";
import { JsonSectionRenderer } from "../shared/JsonSectionRenderer";
import { ModeFilesSectionRenderer } from "../shared/ModeFilesSectionRenderer";
import {
  isModeFilesSection,
  isModeSettingsSection,
} from "../shared/modeFilesSection";
import { ModeSettingsSectionRenderer } from "../shared/ModeSettingsSectionRenderer";
import { ImageSectionRenderer } from "../shared/ImageSectionRenderer";
import { isImageSectionDefinition } from "../shared/imageSection";
import { ModeAvailabilitySummary } from "./ModeAvailabilitySummary";
import { useModeAvailability } from "./modeAvailability";
import {
  adaptFeatureRequirementsSection,
  isCanonicalFeatureRequirementsDefinition,
} from "../../utils/featureRequirementsSection";

type PatchState = "idle" | "patching" | "done" | "failed";

const storageKey = (proposalId: string) => `proposal-parent-task:${proposalId}`;

/**
 * Renders a task creation proposal with its registry-declared sections.
 *
 * Includes a parent task selector that defaults to the proposal's parentTaskId.
 * If the user changes the parent, the new parent is persisted by PATCHing the
 * proposal itself (with a USER `user_reason` influence) before approval, so
 * the task is created under the chosen parent. Feature tag overrides are still
 * applied as a post-apply task PATCH.
 */
export const TaskCreateRenderer: React.FC<{
  proposal: ProposalResponseDto & { updates: CreateTaskProposalUpdates };
  status: ProposalItemStatus;
  onApply: () => void;
  onReject?: (reason: string) => Promise<void>;
  disabled?: boolean;
  siblingProposals?: Map<string, ProposalResponseDto>;
  approvalProgress?: ApprovalProgress;
  overrides?: ProposalRenderOverrides;
}> = ({
  proposal,
  status,
  onApply,
  onReject,
  disabled,
  siblingProposals,
  approvalProgress,
  overrides,
}) => {
  const pathService = usePathService();
  const navigate = useNavigate();
  const { user } = useAuth();
  const modeMentionConfig = useMemo(
    () => ({
      organizationId: proposal.organizationId,
      projectId: proposal.projectId,
      navigate,
    }),
    [navigate, proposal.organizationId, proposal.projectId],
  );
  const proposedServiceIds = proposal.updates.serviceIds;
  const modeAvailability = useModeAvailability({
    organizationId: proposal.organizationId,
    projectId: proposal.projectId,
    targetEntityId: proposal.targetEntityId,
    action: ProposalAction.Create,
    modeTypeKey: proposal.updates.type ?? "STANDARD",
    proposalEdges: proposal.edges,
  });
  const servicesQuery = useServices(proposal.organizationId, {
    projectId: proposal.projectId,
    enabled: proposedServiceIds !== undefined,
  });
  const proposedServiceNames = proposedServiceIds
    ? resolveServiceNames(proposedServiceIds, servicesQuery.services)
    : null;
  const {
    presentation: typePresentation,
    definition: workItemTypeDefinition,
    isLoading: isWorkItemTypeLoading,
    error: workItemTypeError,
  } = useProposalHeaderTypeResolution(
    proposal.organizationId,
    proposal.projectId,
    { kind: "task", taskType: proposal.updates.type },
  );

  // Track the real entityId — starts as the proposal's value, updated by
  // delayed reload once the backend has finished creating the entity.
  const [resolvedEntityId, setResolvedEntityId] = useState(
    () => getEntry(proposal.id)?.newEntityId ?? proposal.targetEntityId,
  );

  const proposalParentTaskId = proposal.updates.parentTaskId ?? null;
  const proposedTag = proposal.updates.tag ?? null;
  const isFeatureProposal = proposal.updates.type === "FEATURE";

  const [selectedParentTaskId, setSelectedParentTaskId] = useState<
    string | null
  >(() => {
    const stored = localStorage.getItem(storageKey(proposal.id));
    return stored !== null ? stored : proposalParentTaskId;
  });

  const [selectedTag, setSelectedTag] = useState<FeatureTag | null>(
    proposedTag,
  );

  // Ref so the post-apply tag PATCH effect always reads the latest tag
  // selection without re-registering on every change while pending.
  const selectedTagRef = useRef(selectedTag);
  useEffect(() => {
    selectedTagRef.current = selectedTag;
  });

  // If the proposal was already applied when mounted, skip the patch entirely.
  const [patchState, setPatchState] = useState<PatchState>(() =>
    status.state === "applied" ? "done" : "idle",
  );

  // Tracks the proposal PATCH that persists a user parent override before approval.
  const [proposalPatchState, setProposalPatchState] = useState<
    "idle" | "patching" | "failed"
  >("idle");

  const handleParentChange = useCallback(
    (taskId: string | null) => {
      setSelectedParentTaskId(taskId);
      if (taskId !== null) {
        localStorage.setItem(storageKey(proposal.id), taskId);
      } else {
        localStorage.removeItem(storageKey(proposal.id));
      }
    },
    [proposal.id],
  );

  const handleTagChange = useCallback(
    (event: SelectChangeEvent<FeatureTag>) => {
      setSelectedTag(event.target.value as FeatureTag);
    },
    [],
  );

  const handleApply = useCallback(async () => {
    const parentChanged = selectedParentTaskId !== proposalParentTaskId;
    if (!parentChanged) {
      onApply();
      return;
    }

    const userId = user?.id ?? null;
    const influences: Influence[] = userId
      ? [
          {
            entityId: userId,
            entityType: EntityType.User,
            reasonType: "user_reason",
            reasoning: "user updated parent task",
          },
        ]
      : [];

    const updatedPayload: CreateTaskDto = {
      ...proposal.updates,
      parentTaskId: selectedParentTaskId ?? undefined,
    };

    setProposalPatchState("patching");
    try {
      await proposalsClient.updateProposal({
        organizationId: proposal.organizationId,
        projectId: proposal.projectId,
        proposalId: proposal.id,
        updateProposalDto: {
          updates: updatedPayload,
          ...(influences.length > 0 ? { influences } : {}),
        },
      });
      localStorage.removeItem(storageKey(proposal.id));
      setProposalPatchState("idle");
      onApply();
    } catch {
      setProposalPatchState("failed");
    }
  }, [
    selectedParentTaskId,
    proposalParentTaskId,
    user?.id,
    proposal.updates,
    proposal.organizationId,
    proposal.projectId,
    proposal.id,
    onApply,
  ]);

  const runPatch = useCallback(() => {
    const tag = selectedTagRef.current;
    if (!isFeatureProposal || tag === null || tag === proposedTag) {
      setPatchState("done");
      return;
    }

    const patch: UpdateTaskDto = { tag };
    setPatchState("patching");
    tasksClient
      .organizationsOrganizationIdProjectsProjectIdTasksTaskIdPatch({
        organizationId: proposal.organizationId,
        projectId: proposal.projectId,
        taskId: proposal.targetEntityId,
        updateTaskDto: patch,
      })
      .then(() => setPatchState("done"))
      .catch(() => setPatchState("failed"));
  }, [
    proposal.organizationId,
    proposal.projectId,
    proposal.targetEntityId,
    proposedTag,
    isFeatureProposal,
  ]);

  useEffect(() => {
    if (status.state !== "applied" || patchState !== "idle") return;
    runPatch();
  }, [status.state, patchState, runPatch]);

  // When the proposal is applied but the entityId is still a placeholder,
  // poll every 5s (up to 5 attempts) to pick up the real entity ID.
  const [pollAttempt, setPollAttempt] = useState(0);
  useEffect(() => {
    if (status.state !== "applied" || !isPlaceholderEntityId(resolvedEntityId))
      return;
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
          setResolvedEntityId(updated.targetEntityId);
          setNewEntityId(proposal.id, updated.targetEntityId);
          return;
        }
      } catch {
        // Fall through to schedule next attempt.
      }
      setPollAttempt((n) => n + 1);
    }, 3000);

    return () => clearTimeout(timer);
  }, [
    status.state,
    resolvedEntityId,
    pollAttempt,
    proposal.organizationId,
    proposal.projectId,
    proposal.id,
  ]);

  // Keep the spinner on while the proposal PATCH (parent override) or the
  // post-apply tag PATCH is still in flight.
  const effectiveStatus: ProposalItemStatus =
    proposalPatchState === "patching"
      ? { state: "applying" }
      : status.state === "applied" &&
          (patchState === "idle" || patchState === "patching")
        ? { state: "applying" }
        : status;

  const isTitleLinkAvailable =
    status.state === "applied" && !isPlaceholderEntityId(resolvedEntityId);

  const { updates } = proposal;

  const wrapTypeResolutionContent = (
    content: React.ReactElement,
  ): React.ReactElement =>
    overrides?.hideCard ? (
      content
    ) : (
      <Paper variant="outlined" sx={{ p: 2 }}>
        {content}
      </Paper>
    );

  if (isWorkItemTypeLoading) {
    return wrapTypeResolutionContent(
      <Box
        sx={{ display: "flex", justifyContent: "center", py: 3 }}
        data-testid="task-create-work-item-type-loading"
      >
        <CircularProgress size={24} />
      </Box>,
    );
  }

  if (workItemTypeError) {
    return wrapTypeResolutionContent(
      <Alert
        severity="error"
        data-testid="task-create-work-item-type-load-error"
      >
        Failed to load the work-item type registry: {workItemTypeError.message}
      </Alert>,
    );
  }

  if (!workItemTypeDefinition || workItemTypeDefinition.key !== updates.type) {
    return wrapTypeResolutionContent(
      <Alert
        severity="warning"
        data-testid="task-create-work-item-type-unavailable"
      >
        The work-item type definition is unavailable for this proposal.
      </Alert>,
    );
  }

  const proposedSections = resolveProposalWorkItemSections({
    definition: workItemTypeDefinition,
    proposedSections: updates.sections,
  });
  const proposedRequirementsSection = proposedSections.find(
    (section) => section.key === "requirements",
  );
  const proposedRequirementsState =
    isFeatureProposal &&
    proposedRequirementsSection &&
    isCanonicalFeatureRequirementsDefinition(
      updates.type,
      proposedRequirementsSection.definition,
    )
      ? adaptFeatureRequirementsSection({
          typeKey: updates.type,
          definition: proposedRequirementsSection.definition,
          value: proposedRequirementsSection.proposedValue,
        })
      : undefined;

  const content = (
    <Stack spacing={1.5}>
      {!overrides?.hideHeader && (
        <ProposalTitle
          proposal={proposal}
          resolvedTargetName={updates.name}
          typePresentation={typePresentation}
          target={
            isTitleLinkAvailable
              ? {
                  entityId: resolvedEntityId,
                  entityType: proposal.targetEntityType,
                  href:
                    updates.type === "FEATURE"
                      ? pathService.feature({
                          projectId: proposal.projectId,
                          featureId: resolvedEntityId,
                        })
                      : pathService.task({
                          projectId: proposal.projectId,
                          taskId: resolvedEntityId,
                        }),
                  sx: {
                    textDecoration: "none",
                    color: "primary.main",
                    "&:hover": { textDecoration: "underline" },
                  },
                }
              : undefined
          }
          hideTypeChip={overrides?.hideTypeChip}
          titleSx={
            overrides?.titleFontSize
              ? { fontSize: overrides.titleFontSize }
              : undefined
          }
        />
      )}
      {proposedSections.map((section) => (
        <Stack
          key={section.key}
          spacing={0.5}
          data-testid="task-proposal-section"
          data-section-key={section.key}
        >
          <Typography variant="caption" color="text.secondary">
            {section.label}
          </Typography>
          {section.kind === "json" &&
          isModeFilesSection({
            typeKey: updates.type,
            key: section.key,
            kind: section.kind,
          }) ? (
            <ModeFilesSectionRenderer
              content={section.proposedValue}
              mentionConfig={modeMentionConfig}
            />
          ) : section.kind === "json" &&
            isModeSettingsSection({
              typeKey: updates.type,
              key: section.key,
              kind: section.kind,
            }) ? (
            <ModeSettingsSectionRenderer content={section.proposedValue} />
          ) : isImageSectionDefinition(section.definition) ? (
            <ImageSectionRenderer
              content={section.proposedValue}
              label={section.label}
            />
          ) : section.kind === "json" &&
            !(
              section.key === "requirements" &&
              proposedRequirementsState !== undefined
            ) ? (
            <JsonSectionRenderer content={section.proposedValue} />
          ) : section.kind === "html/css" ? (
            <HtmlCssSectionRenderer
              content={section.proposedValue}
              definition={section.definition}
              context="inline"
              title={`${section.label} proposal preview`}
              organizationId={proposal.organizationId}
              projectId={proposal.projectId}
              mockupSource={{
                kind: "proposal",
                proposalId: proposal.id,
                sectionKey: section.key,
              }}
            />
          ) : section.kind === "structured-mockup" ? (
            <StructuredMockupSectionRenderer
              content={section.proposedValue}
              definition={section.definition}
              context="inline"
            />
          ) : section.key === "requirements" &&
            proposedRequirementsState !== undefined ? (
            proposedRequirementsState.status === "invalid" ? (
              <Alert
                severity="error"
                data-testid="feature-requirements-invalid"
              >
                {proposedRequirementsState.reason}
              </Alert>
            ) : proposedRequirementsState.status === "valid" ? (
              <StructuredRequirementsView
                requirements={proposedRequirementsState.records}
              />
            ) : (
              <Typography variant="body2" color="text.secondary">
                (empty)
              </Typography>
            )
          ) : (
            <Typography variant="body2" color="text.secondary" component="div">
              <MarkdownRenderer allowMentionEscapes>
                {section.proposedContent || "(empty)"}
              </MarkdownRenderer>
            </Typography>
          )}
        </Stack>
      ))}
      {proposedServiceIds !== undefined && (
        <Stack spacing={0.5} data-testid="task-proposal-services">
          <Typography variant="caption" color="text.secondary">
            Services
          </Typography>
          {servicesQuery.isLoading ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">
                Loading service names…
              </Typography>
            </Box>
          ) : servicesQuery.error ? (
            <Alert severity="error">Could not load service names.</Alert>
          ) : proposedServiceNames?.state === "unavailable" ? (
            <Alert severity="warning">
              One or more proposed services are unavailable.
            </Alert>
          ) : proposedServiceNames?.state === "resolved" ? (
            <Typography variant="body2" color="text.secondary">
              {formatServiceNames(proposedServiceNames.names)}
            </Typography>
          ) : null}
        </Stack>
      )}
      <ModeAvailabilitySummary
        availability={modeAvailability}
        organizationId={proposal.organizationId}
        projectId={proposal.projectId}
      />
      {siblingProposals && (
        <ProposalEdges
          edges={proposal.edges}
          siblingProposals={siblingProposals}
          organizationId={proposal.organizationId}
          projectId={proposal.projectId}
          ownerApplied={status.state === "applied"}
        />
      )}
      <TaskTreePicker
        organizationId={proposal.organizationId}
        projectId={proposal.projectId}
        label="Parent"
        value={selectedParentTaskId}
        onChange={handleParentChange}
        disabled={
          disabled ||
          effectiveStatus.state === "applying" ||
          effectiveStatus.state === "applied"
        }
        includeNone
      />
      {isFeatureProposal && (
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Typography
            variant="caption"
            sx={{ color: "text.secondary", minWidth: 64 }}
          >
            Tag
          </Typography>
          <FeatureTagBadge tag={proposedTag} />
          <Select<FeatureTag | "">
            size="small"
            value={selectedTag ?? ""}
            onChange={(event) =>
              handleTagChange(event as unknown as SelectChangeEvent<FeatureTag>)
            }
            disabled={
              disabled ||
              status.state === "applying" ||
              status.state === "applied"
            }
            displayEmpty
            inputProps={{ "aria-label": "Override feature tag" }}
            sx={{ minWidth: 140 }}
          >
            {selectedTag === null && (
              <MenuItem value="" disabled>
                Pick a tag
              </MenuItem>
            )}
            {FEATURE_TAG_VALUES.map((value) => (
              <MenuItem key={value} value={value}>
                <Box
                  component="span"
                  sx={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    backgroundColor: FEATURE_TAG_PALETTE[value].color,
                    mr: 1,
                  }}
                />
                {FEATURE_TAG_PALETTE[value].label}
              </MenuItem>
            ))}
          </Select>
        </Stack>
      )}
      {proposalPatchState === "failed" && (
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                setProposalPatchState("idle");
                void handleApply();
              }}
            >
              Retry
            </Button>
          }
        >
          Could not save the parent override before approval.
        </Alert>
      )}
      {patchState === "failed" && (
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                setPatchState("idle");
                runPatch();
              }}
            >
              Retry
            </Button>
          }
        >
          Task was created but could not apply the requested overrides.
        </Alert>
      )}
      {!overrides?.hideStateIndicator && (
        <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
          <ProposalStateIndicator
            status={effectiveStatus}
            action={ProposalAction.Create}
            onApply={() => void handleApply()}
            onReject={onReject}
            disabled={disabled}
            loading={
              status.state === "applied" &&
              patchState === "done" &&
              isPlaceholderEntityId(resolvedEntityId) &&
              pollAttempt < 5
            }
            approvalProgress={approvalProgress}
          />
        </Box>
      )}
    </Stack>
  );

  return overrides?.hideCard ? (
    content
  ) : (
    <Paper variant="outlined" sx={{ p: 2 }}>
      {content}
    </Paper>
  );
};
