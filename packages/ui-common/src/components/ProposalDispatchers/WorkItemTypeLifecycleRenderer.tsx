import {
  Alert,
  AlertTitle,
  Box,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import React, { useMemo } from "react";
import type {
  ProposalResponseDto,
  WorkItemTypeArchiveRequestDto,
  WorkItemTypeDefinitionDto,
} from "../../api";
import { ProposalAction } from "../../api";
import {
  useWorkItemTypeSectionContentImpact,
  useWorkItemTypeTrackingLinkRevocationImpact,
} from "../../data/hooks/useWorkItemTypeLifecycle";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import { useProjectCapabilities } from "../../hooks";
import type { ApprovalProgress } from "../../permissions";
import { ProposalEdges } from "./ProposalEdges";
import type { ProposalRenderOverrides } from "./proposalRenderOverrides";
import { ProposalTitle } from "./ProposalTitle";
import { staticProposalTypePresentation } from "./proposalHeaderType";
import { ProposalStateIndicator } from "./ProposalStateIndicator";
import type {
  ProposalItemStatus,
  WorkItemTypeEditProposalUpdates,
} from "./types";

import { WorkItemTypeDefinitionDiff } from "./WorkItemTypeDefinitionDiff";
import { compareWorkItemTypeDefinitions } from "./workItemTypeDefinitionComparison";
import type { DiffViewMode } from "../SuggestedContent/DiffRenderer";

interface WorkItemTypeEditLifecycleProps {
  mode: "edit";
  proposal: ProposalResponseDto & {
    updates: WorkItemTypeEditProposalUpdates;
  };
}

interface WorkItemTypeArchiveLifecycleProps {
  mode: "archive";
  proposal: ProposalResponseDto & {
    updates: WorkItemTypeArchiveRequestDto;
  };
}

type WorkItemTypeLifecycleRendererProps = (
  WorkItemTypeEditLifecycleProps | WorkItemTypeArchiveLifecycleProps
) & {
  diffDefaultViewMode?: DiffViewMode;
  organizationId: string;
  projectId: string;
  status: ProposalItemStatus;
  onApply: () => void;
  onReject?: (reason: string) => Promise<void>;
  disabled?: boolean;
  siblingProposals?: Map<string, ProposalResponseDto>;
  approvalProgress?: ApprovalProgress;
  overrides?: ProposalRenderOverrides;
};

interface WorkItemTypeLifecycleDiff {
  addedChildTypeKeys: string[];
  addedParentTypeKeys: string[];
  addedSectionKeys: string[];
  removedChildTypeKeys: string[];
  removedParentTypeKeys: string[];
  removedSectionKeys: string[];
  revokedTrackingSourceTypeKeys: string[];
  roleChange: {
    current: WorkItemTypeDefinitionDto["role"];
    proposed: WorkItemTypeDefinitionDto["role"];
  } | null;
}

function difference(
  current: readonly string[],
  proposed: readonly string[],
): string[] {
  const proposedValues = new Set(proposed);
  return Array.from(new Set(current))
    .filter((value) => !proposedValues.has(value))
    .sort();
}

function buildWorkItemTypeLifecycleDiff(
  current: WorkItemTypeDefinitionDto,
  proposed: WorkItemTypeDefinitionDto,
): WorkItemTypeLifecycleDiff {
  const currentSectionKeys = current.sections.map((section) => section.key);
  const proposedSectionKeys = proposed.sections.map((section) => section.key);

  return {
    addedChildTypeKeys: [],
    addedParentTypeKeys: difference(
      proposed.allowedParentTypes ?? [],
      current.allowedParentTypes ?? [],
    ),
    addedSectionKeys: difference(proposedSectionKeys, currentSectionKeys),
    removedChildTypeKeys: [],
    removedParentTypeKeys: difference(
      current.allowedParentTypes ?? [],
      proposed.allowedParentTypes ?? [],
    ),
    removedSectionKeys: difference(currentSectionKeys, proposedSectionKeys),
    revokedTrackingSourceTypeKeys: difference(
      current.tracking?.allowedSourceTaskTypes ?? [],
      proposed.tracking?.allowedSourceTaskTypes ?? [],
    ),
    roleChange:
      current.role === proposed.role
        ? null
        : { current: current.role, proposed: proposed.role },
  };
}

const emptyDiff: WorkItemTypeLifecycleDiff = {
  addedChildTypeKeys: [],
  addedParentTypeKeys: [],
  addedSectionKeys: [],
  removedChildTypeKeys: [],
  removedParentTypeKeys: [],
  removedSectionKeys: [],
  revokedTrackingSourceTypeKeys: [],
  roleChange: null,
};

const PlacementDelta: React.FC<{
  label: string;
  testId: string;
  values: readonly string[];
  color: "success" | "error";
}> = ({ label, testId, values, color }) => {
  if (values.length === 0) return null;

  return (
    <Box data-testid={testId}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
        {values.map((value) => (
          <Chip key={value} label={value} size="small" color={color} />
        ))}
      </Stack>
    </Box>
  );
};

export const WorkItemTypeLifecycleRenderer: React.FC<
  WorkItemTypeLifecycleRendererProps
> = ({
  mode,
  proposal,
  organizationId,
  projectId,
  status,
  onApply,
  onReject,
  disabled,
  siblingProposals,
  approvalProgress,
  overrides,
  diffDefaultViewMode,
}) => {
  const typeKey = proposal.targetEntityId;
  const { manageWorkItemTypes } = useProjectCapabilities(
    organizationId,
    projectId,
  );
  const {
    workItemTypeSummary,
    isLoading: isSummaryLoading,
    error: summaryError,
  } = useWorkItemTypeByKey(organizationId, projectId, typeKey);

  const originalDefinition =
    proposal.retainedOriginalTargetContent?.definition ??
    (proposal.applicationEligible === false
      ? undefined
      : workItemTypeSummary?.definition);
  const proposedDefinition =
    mode === "edit" ? proposal.updates.definition : undefined;
  const comparisonResult = useMemo(() => {
    if (!proposedDefinition || !originalDefinition) return null;
    try {
      return {
        comparison: compareWorkItemTypeDefinitions(
          originalDefinition,
          proposedDefinition,
        ),
      };
    } catch {
      return { comparison: null };
    }
  }, [proposedDefinition, originalDefinition]);
  const lifecycleDiff = useMemo(
    () =>
      proposedDefinition && originalDefinition && comparisonResult?.comparison
        ? buildWorkItemTypeLifecycleDiff(originalDefinition, proposedDefinition)
        : emptyDiff,
    [proposedDefinition, originalDefinition, comparisonResult],
  );

  const sectionImpact = useWorkItemTypeSectionContentImpact(
    organizationId,
    projectId,
    typeKey,
    lifecycleDiff.removedSectionKeys,
    {
      enabled: mode === "edit" && lifecycleDiff.removedSectionKeys.length > 0,
    },
  );
  const trackingImpact = useWorkItemTypeTrackingLinkRevocationImpact(
    organizationId,
    projectId,
    typeKey,
    lifecycleDiff.revokedTrackingSourceTypeKeys,
    {
      enabled:
        mode === "edit" &&
        lifecycleDiff.revokedTrackingSourceTypeKeys.length > 0,
    },
  );

  if (
    isSummaryLoading &&
    proposal.applicationEligible !== false &&
    !originalDefinition
  ) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (
    !originalDefinition ||
    (summaryError && !proposal.retainedOriginalTargetContent?.definition)
  ) {
    return (
      <Alert severity="error" data-testid="work-item-type-lifecycle-load-error">
        {proposal.applicationEligible === false
          ? "The original definition is unavailable."
          : "Could not load the current work-item-type definition."}
      </Alert>
    );
  }

  if (mode === "edit" && !comparisonResult?.comparison) {
    return (
      <Alert severity="error" data-testid="work-item-type-comparison-error">
        Could not compare the work-item-type definitions.
      </Alert>
    );
  }

  const isImpactLoading =
    (lifecycleDiff.removedSectionKeys.length > 0 &&
      (sectionImpact.isLoading || sectionImpact.isFetching)) ||
    (lifecycleDiff.revokedTrackingSourceTypeKeys.length > 0 &&
      (trackingImpact.isLoading || trackingImpact.isFetching));
  const impactError = sectionImpact.error ?? trackingImpact.error;
  const isDestructiveEdit =
    lifecycleDiff.removedSectionKeys.length > 0 ||
    lifecycleDiff.revokedTrackingSourceTypeKeys.length > 0;
  const hasPlacementChanges =
    lifecycleDiff.addedParentTypeKeys.length > 0 ||
    lifecycleDiff.removedParentTypeKeys.length > 0 ||
    lifecycleDiff.addedChildTypeKeys.length > 0 ||
    lifecycleDiff.removedChildTypeKeys.length > 0;
  const action =
    mode === "edit" ? ProposalAction.Update : ProposalAction.Delete;
  const displayName = originalDefinition.name;

  const content = (
    <Stack spacing={1.5}>
      {!overrides?.hideHeader && (
        <ProposalTitle
          proposal={proposal}
          resolvedTargetName={displayName}
          typePresentation={staticProposalTypePresentation("Work Item Type")}
          hideTypeChip={overrides?.hideTypeChip}
          titleSx={
            overrides?.titleFontSize
              ? { fontSize: overrides.titleFontSize }
              : undefined
          }
          endAdornment={
            <Chip label={typeKey} size="small" variant="outlined" />
          }
        />
      )}

      {mode === "archive" ? (
        <Alert severity="warning" data-testid="work-item-type-archive-review">
          <AlertTitle>Archive this work-item type</AlertTitle>
          Existing items and this definition remain readable. Archiving only
          prevents new items from being created or placed as this type.
          {proposal.updates.reason ? (
            <Typography variant="body2" sx={{ mt: 1 }}>
              Reason: {proposal.updates.reason}
            </Typography>
          ) : null}
        </Alert>
      ) : (
        <Stack spacing={1}>
          <Typography variant="body2">
            Review the proposed lifecycle-safe definition changes.
          </Typography>
          {comparisonResult?.comparison && (
            <WorkItemTypeDefinitionDiff
              comparison={comparisonResult.comparison}
              defaultViewMode={diffDefaultViewMode}
            />
          )}
          {lifecycleDiff.roleChange ? (
            <Box data-testid="work-item-type-role-change">
              <Typography variant="caption" color="text.secondary">
                Role
              </Typography>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Chip
                  label={lifecycleDiff.roleChange.current}
                  size="small"
                  variant="outlined"
                />
                <Typography variant="body2">→</Typography>
                <Chip
                  label={lifecycleDiff.roleChange.proposed}
                  size="small"
                  color="primary"
                />
              </Stack>
            </Box>
          ) : null}
          {lifecycleDiff.addedSectionKeys.length > 0 ? (
            <Box data-testid="work-item-type-added-sections">
              <Typography variant="caption" color="text.secondary">
                Added sections
              </Typography>
              <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                {lifecycleDiff.addedSectionKeys.map((key) => (
                  <Chip key={key} label={key} size="small" color="success" />
                ))}
              </Stack>
            </Box>
          ) : null}
          {hasPlacementChanges ? (
            <Stack spacing={1} data-testid="work-item-type-placement-changes">
              <Typography variant="caption" color="text.secondary">
                Placement changes
              </Typography>
              <PlacementDelta
                label="Added parents"
                testId="work-item-type-added-parents"
                values={lifecycleDiff.addedParentTypeKeys}
                color="success"
              />
              <PlacementDelta
                label="Removed parents"
                testId="work-item-type-removed-parents"
                values={lifecycleDiff.removedParentTypeKeys}
                color="error"
              />
              <PlacementDelta
                label="Added children"
                testId="work-item-type-added-children"
                values={lifecycleDiff.addedChildTypeKeys}
                color="success"
              />
              <PlacementDelta
                label="Removed children"
                testId="work-item-type-removed-children"
                values={lifecycleDiff.removedChildTypeKeys}
                color="error"
              />
            </Stack>
          ) : null}
          {isDestructiveEdit ? (
            <Alert severity="warning" data-testid="work-item-type-edit-impact">
              <AlertTitle>Destructive edit impact</AlertTitle>
              {lifecycleDiff.removedSectionKeys.length > 0 ? (
                <Box data-testid="work-item-type-section-impact" sx={{ mb: 1 }}>
                  <Typography variant="body2">
                    Removing sections affects{" "}
                    {sectionImpact.data?.totalAffectedItemCount ?? "..."}{" "}
                    existing items with content in those sections. Existing
                    content remains stored.
                  </Typography>
                  {sectionImpact.data ? (
                    <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
                      {sectionImpact.data.sections.map((section) => (
                        <Typography
                          component="li"
                          variant="body2"
                          key={section.sectionKey}
                        >
                          {section.sectionKey}: {section.affectedItemCount}{" "}
                          items
                        </Typography>
                      ))}
                    </Stack>
                  ) : null}
                </Box>
              ) : null}
              {lifecycleDiff.revokedTrackingSourceTypeKeys.length > 0 ? (
                <Box data-testid="work-item-type-tracking-impact">
                  <Typography variant="body2">
                    Revoking tracking sources affects{" "}
                    {trackingImpact.data?.totalAffectedLinkCount ?? "..."}{" "}
                    existing tracking links. Only links made invalid by this
                    edit are removed.
                  </Typography>
                  {trackingImpact.data ? (
                    <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
                      {trackingImpact.data.sources.map((source) => (
                        <Typography
                          component="li"
                          variant="body2"
                          key={source.sourceTypeKey}
                        >
                          {source.sourceTypeKey}: {source.affectedLinkCount}{" "}
                          links
                        </Typography>
                      ))}
                    </Stack>
                  ) : null}
                </Box>
              ) : null}
            </Alert>
          ) : null}
        </Stack>
      )}

      {impactError ? (
        <Alert severity="error" data-testid="work-item-type-impact-error">
          Failed to load edit impact counts. Retry before applying this
          proposal.
        </Alert>
      ) : null}

      <ProposalEdges
        edges={proposal.edges}
        siblingProposals={siblingProposals ?? new Map()}
        organizationId={proposal.organizationId}
        projectId={proposal.projectId}
        ownerApplied={status.state === "applied"}
      />
      {!overrides?.hideStateIndicator && (
        <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
          <ProposalStateIndicator
            status={status}
            action={action}
            onApply={onApply}
            onReject={onReject}
            disabled={disabled || isImpactLoading || Boolean(impactError)}
            approvalProgress={approvalProgress}
            applyLabel={overrides?.applyLabel}
            canApprove={manageWorkItemTypes}
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
      data-testid="work-item-type-lifecycle-review"
      data-work-item-type-key={typeKey}
      sx={{
        p: 2,
        ...(overrides?.maxWidth ? { maxWidth: overrides.maxWidth } : {}),
        ...(overrides?.border ? { border: overrides.border } : {}),
      }}
    >
      {content}
    </Paper>
  );
};
