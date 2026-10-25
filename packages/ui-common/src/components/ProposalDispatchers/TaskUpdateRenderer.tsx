import { useReconciledUpdate } from "../ProposalReconciliation/useReconciledUpdate";
import { useFeatureLookup } from "../../data/hooks/useFeatureHierarchy";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import { isVisualSectionKind } from "./isVisualProposal";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Alert,
  Box,
  CircularProgress,
  Collapse,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import React, { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ProposalAction } from "../../api";
import type {
  ProposalResponseDto,
  TaskResponseDto,
  WorkItemTypeDefinitionDto,
} from "../../api";
import { usePathService } from "../../contexts/PathServiceContext";
import { useUsers } from "../../data/hooks/useUsers";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import {
  StructuredRequirementsDiffView,
  StructuredRequirementsView,
} from "../shared/StructuredRequirementsView";
import { DiffRenderer } from "../SuggestedContent";
import type { DiffViewMode } from "../SuggestedContent";
import type { ProposalItemStatus } from "./types";
import { ProposalStateIndicator } from "./ProposalStateIndicator";
import { ProposalEdges } from "./ProposalEdges";
import { buildTaskDiff } from "./diffBuilders";
import type { ApprovalProgress } from "../../permissions";
import {
  resolveDiffDefaultViewMode,
  type ProposalRenderOverrides,
} from "./proposalRenderOverrides";
import { updateProposalTitleLinkSx } from "./updateProposalTitleLinkSx";
import { ProposalTitle } from "./ProposalTitle";
import { resolveWorkItemTypePresentation } from "./proposalHeaderType";
import { useServices } from "../../data/hooks/useServices";
import type { UpdateTaskProposalUpdates } from "./types";
import { resolveServiceNames } from "./taskServiceAssignments";
import {
  adaptFeatureRequirementsSection,
  isCanonicalFeatureRequirementsDefinition,
} from "../../utils/featureRequirementsSection";
import { HtmlCssSectionRenderer } from "../shared/HtmlCssSectionRenderer";
import { StructuredMockupSectionRenderer } from "../shared/StructuredMockupSectionRenderer";
import {
  ModeFilesSectionRenderer,
  readModeFilesContent,
} from "../shared/ModeFilesSectionRenderer";
import {
  isModeFilesSection,
  isModeSettingsSection,
  readModeProjectAssistantSetting,
} from "../shared/modeFilesSection";
import { ModeSettingsSectionRenderer } from "../shared/ModeSettingsSectionRenderer";
import { ImageSectionRenderer } from "../shared/ImageSectionRenderer";
import { isImageSectionDefinition } from "../shared/imageSection";
import { resolveProposalWorkItemSections } from "./workItemProposalSections";
import { VisualProposalSectionComparison } from "./VisualProposalSectionComparison";
import { ModeAvailabilitySummary } from "./ModeAvailabilitySummary";
import { useModeAvailability } from "./modeAvailability";

/**
 * Renders a task update proposal with side-by-side diff.
 * When already applied, collapses by default and shows inline
 * content instead of the diff view.
 */
export const TaskUpdateRenderer: React.FC<{
  proposal: ProposalResponseDto & { updates: UpdateTaskProposalUpdates };
  existing: TaskResponseDto;
  status: ProposalItemStatus;
  onApply: () => void;
  onReject?: (reason: string) => Promise<void>;
  disabled?: boolean;
  siblingProposals?: Map<string, ProposalResponseDto>;
  approvalProgress?: ApprovalProgress;
  diffDefaultViewMode?: DiffViewMode;
  overrides?: ProposalRenderOverrides;
  /** Shown above the content, e.g. what a future cancellation does. */
  notice?: React.ReactNode;
  /** Replaces the Approve/Reject indicator, e.g. an approved future's Apply strip. */
  footer?: React.ReactNode;
  workItemTypeDefinition: WorkItemTypeDefinitionDto;
}> = ({
  proposal: inputProposal,
  existing: inputExisting,
  status,
  onApply,
  onReject,
  disabled,
  siblingProposals,
  approvalProgress,
  diffDefaultViewMode,
  overrides,
  notice,
  footer,
  workItemTypeDefinition,
}) => {
  const { proposal, existing, hideDiff, reviewedServiceIds } =
    useReconciledUpdate(inputProposal, inputExisting);
  const presentationRegistry = useWorkItemTypeByKey(
    proposal.organizationId,
    proposal.projectId,
    existing.type,
  );
  const isApplied = status.state === "applied";
  const resolvedDiffMode = resolveDiffDefaultViewMode(
    existing.type,
    diffDefaultViewMode,
  );
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(!isApplied);
  const modeMentionConfig = useMemo(
    () => ({
      organizationId: proposal.organizationId,
      projectId: proposal.projectId,
      navigate,
    }),
    [navigate, proposal.organizationId, proposal.projectId],
  );
  const modeAvailability = useModeAvailability({
    organizationId: proposal.organizationId,
    projectId: proposal.projectId,
    targetEntityId: proposal.targetEntityId,
    action: ProposalAction.Update,
    modeTypeKey: proposal.updates.type ?? existing.type,
    proposalEdges: proposal.edges,
  });
  const proposedServiceIds = proposal.updates.serviceIds;
  const servicesQuery = useServices(proposal.organizationId, {
    projectId: proposal.projectId,
    enabled: proposedServiceIds !== undefined,
  });
  const existingServiceIds = useMemo(
    () =>
      reviewedServiceIds ??
      existing.serviceRelations?.map((relation) => relation.serviceId) ??
      [],
    [existing.serviceRelations, reviewedServiceIds],
  );
  const existingServiceNames = proposedServiceIds
    ? resolveServiceNames(existingServiceIds, servicesQuery.services)
    : null;
  const proposedServiceNames = proposedServiceIds
    ? resolveServiceNames(proposedServiceIds, servicesQuery.services)
    : null;

  const pathService = usePathService();
  const href = useMemo(
    () =>
      existing.type === "FEATURE"
        ? pathService.feature({
            projectId: proposal.projectId,
            featureId: proposal.targetEntityId,
          })
        : pathService.task({
            projectId: proposal.projectId,
            taskId: proposal.targetEntityId,
          }),
    [pathService, proposal.projectId, proposal.targetEntityId, existing.type],
  );

  const { data: members } = useUsers(existing.organizationId);
  const resolveUserName = useCallback(
    (id: string | null | undefined) =>
      id ? (members.find((m) => m.userId === id)?.user?.name ?? id) : undefined,
    [members],
  );

  const lookup = useFeatureLookup(
    existing.organizationId,
    existing.parentTaskId || proposal.updates.parentTaskId
      ? proposal.projectId
      : "",
  );
  const cachedNewParent = proposal.updates.parentTaskId
    ? lookup.get(proposal.updates.parentTaskId)
    : undefined;
  const cachedExistingParent = existing.parentTaskId
    ? lookup.get(existing.parentTaskId)
    : undefined;
  const { workItem: newParentTask } = useWorkItem(
    existing.organizationId,
    "task",
    proposal.updates.parentTaskId ?? "",
    {
      projectId: proposal.projectId,
      enabled:
        !lookup.isLoading &&
        !!proposal.updates.parentTaskId &&
        !cachedNewParent,
    },
  );
  const { workItem: existingParentTask } = useWorkItem(
    existing.organizationId,
    "task",
    existing.parentTaskId ?? "",
    {
      projectId: proposal.projectId,
      enabled:
        !lookup.isLoading && !!existing.parentTaskId && !cachedExistingParent,
    },
  );

  const structuredRequirementsChange = useMemo(() => {
    const requirementsDefinition = workItemTypeDefinition.sections.find(
      (section) => section.key === "requirements",
    );
    const proposedSection = proposal.updates.sections?.find(
      (section) => section.key === "requirements",
    );
    if (
      !isCanonicalFeatureRequirementsDefinition(
        existing.type,
        requirementsDefinition,
      ) ||
      !proposedSection
    ) {
      return undefined;
    }

    const beforeState = adaptFeatureRequirementsSection({
      typeKey: existing.type,
      definition: requirementsDefinition,
      section: existing.sections?.find(
        (section) => section.key === "requirements",
      ),
    });
    const afterState = adaptFeatureRequirementsSection({
      typeKey: existing.type,
      definition: requirementsDefinition,
      value: proposedSection.content,
    });

    if (beforeState.status === "invalid" || afterState.status === "invalid") {
      return {
        status: "invalid" as const,
        reason:
          afterState.status === "invalid"
            ? afterState.reason
            : beforeState.status === "invalid"
              ? beforeState.reason
              : "Requirements content is invalid.",
      };
    }

    return {
      status: "valid" as const,
      before: beforeState.status === "absent" ? [] : beforeState.records,
      after: afterState.status === "absent" ? [] : afterState.records,
    };
  }, [
    existing.sections,
    existing.type,
    proposal.updates.sections,
    workItemTypeDefinition.sections,
  ]);

  const { oldContent, newContent } = useMemo(
    () =>
      buildTaskDiff(
        existing,
        proposal.updates,
        {
          existingAssigneeName: resolveUserName(existing.assigneeId),
          newAssigneeName: resolveUserName(proposal.updates.assigneeId),
          existingParentTaskName: (cachedExistingParent ?? existingParentTask)
            ?.name,
          newParentTaskName: (cachedNewParent ?? newParentTask)?.name,
          existingServiceNames:
            existingServiceNames?.state === "resolved"
              ? existingServiceNames.names
              : undefined,
          newServiceNames:
            proposedServiceNames?.state === "resolved"
              ? proposedServiceNames.names
              : undefined,
          excludedSectionKeys: [
            ...(structuredRequirementsChange ? ["requirements"] : []),
            ...workItemTypeDefinition.sections
              .filter(({ kind }) => isVisualSectionKind(kind))
              .map(({ key }) => key),
            ...workItemTypeDefinition.sections
              .filter(isImageSectionDefinition)
              .map(({ key }) => key),
            ...workItemTypeDefinition.sections
              .filter(
                ({ key, kind }) =>
                  isModeFilesSection({
                    typeKey: workItemTypeDefinition.key,
                    key,
                    kind,
                  }) ||
                  isModeSettingsSection({
                    typeKey: workItemTypeDefinition.key,
                    key,
                    kind,
                  }),
              )
              .map(({ key }) => key),
          ],
        },
        workItemTypeDefinition,
      ),
    [
      existing,
      proposal.updates,
      resolveUserName,
      cachedExistingParent,
      cachedNewParent,
      existingParentTask,
      newParentTask,
      existingServiceNames,
      proposedServiceNames,
      structuredRequirementsChange,
      workItemTypeDefinition,
    ],
  );

  const serviceNamesUnavailable =
    proposedServiceIds !== undefined &&
    !servicesQuery.isLoading &&
    !servicesQuery.error &&
    (existingServiceNames?.state === "unavailable" ||
      proposedServiceNames?.state === "unavailable");
  const hasGeneralChanges =
    oldContent !== "(no changes)" || newContent !== "(no changes)";
  const richPreviewSections = useMemo(
    () =>
      resolveProposalWorkItemSections({
        definition: workItemTypeDefinition,
        proposedSections: proposal.updates.sections,
        existingSections: existing.sections,
      }).filter(({ kind }) => isVisualSectionKind(kind)),
    [existing.sections, proposal.updates.sections, workItemTypeDefinition],
  );
  const htmlCssSections = richPreviewSections.filter(
    ({ kind }) => kind === "html/css",
  );
  const structuredMockupSections = useMemo(
    () =>
      richPreviewSections.filter(
        (section) => section.kind === "structured-mockup",
      ),
    [richPreviewSections],
  );
  const modeFilesSections = useMemo(
    () =>
      resolveProposalWorkItemSections({
        definition: workItemTypeDefinition,
        proposedSections: proposal.updates.sections,
        existingSections: existing.sections,
      }).filter(({ key, kind }) =>
        isModeFilesSection({
          typeKey: workItemTypeDefinition.key,
          key,
          kind,
        }),
      ),
    [existing.sections, proposal.updates.sections, workItemTypeDefinition],
  );
  const modeSettingsSections = useMemo(
    () =>
      resolveProposalWorkItemSections({
        definition: workItemTypeDefinition,
        proposedSections: proposal.updates.sections,
        existingSections: existing.sections,
      }).filter(({ key, kind }) =>
        isModeSettingsSection({
          typeKey: workItemTypeDefinition.key,
          key,
          kind,
        }),
      ),
    [existing.sections, proposal.updates.sections, workItemTypeDefinition],
  );

  const imageSections = useMemo(
    () =>
      resolveProposalWorkItemSections({
        definition: workItemTypeDefinition,
        proposedSections: proposal.updates.sections,
        existingSections: existing.sections,
      }).filter(({ definition }) => isImageSectionDefinition(definition)),
    [existing.sections, proposal.updates.sections, workItemTypeDefinition],
  );
  const modeFilesComparisonUnavailable =
    !isApplied &&
    modeFilesSections.some(
      (section) =>
        readModeFilesContent(section.existingValue).status !== "valid" ||
        readModeFilesContent(section.proposedValue).status !== "valid",
    );
  const modeSettingsComparisonUnavailable =
    !isApplied &&
    modeSettingsSections.some(
      (section) =>
        readModeProjectAssistantSetting(section.existingValue).status ===
          "invalid" ||
        readModeProjectAssistantSetting(section.proposedValue).status ===
          "invalid",
    );
  const modeComparisonUnavailable =
    modeFilesComparisonUnavailable || modeSettingsComparisonUnavailable;
  const availability = (
    <ModeAvailabilitySummary
      availability={modeAvailability}
      organizationId={proposal.organizationId}
      projectId={proposal.projectId}
    />
  );
  const renderImageSection = (
    section: (typeof imageSections)[number],
    showPrevious: boolean,
  ) => (
    <Stack key={section.key} spacing={0.5} data-section-key={section.key}>
      <Typography variant="caption" color="text.secondary">
        {section.label}
      </Typography>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        {showPrevious && (
          <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary">
              Current
            </Typography>
            <ImageSectionRenderer
              content={section.existingValue}
              label={`${section.label} (current)`}
            />
          </Stack>
        )}
        <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
          {showPrevious && (
            <Typography variant="caption" color="text.secondary">
              Proposed
            </Typography>
          )}
          <ImageSectionRenderer
            content={section.proposedValue}
            label={section.label}
            emptyText="Image removed"
          />
        </Stack>
      </Stack>
    </Stack>
  );

  const content = (
    <Stack spacing={1.5}>
      {!overrides?.hideHeader && (
        <ProposalTitle
          proposal={proposal}
          resolvedTargetName={existing.name}
          typePresentation={resolveWorkItemTypePresentation(
            existing.type,
            workItemTypeDefinition,
            presentationRegistry.workItemTypeSummary?.effectiveSource,
          )}
          target={{
            entityId: proposal.targetEntityId,
            href,
            sx: updateProposalTitleLinkSx,
          }}
          hideTypeChip={overrides?.hideTypeChip}
          titleSx={
            overrides?.titleFontSize
              ? { fontSize: overrides.titleFontSize }
              : undefined
          }
          endAdornment={
            isApplied ? (
              <IconButton
                size="small"
                onClick={() => setExpanded((prev) => !prev)}
                sx={{
                  transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s",
                }}
              >
                <ExpandMoreIcon fontSize="small" />
              </IconButton>
            ) : undefined
          }
        />
      )}
      {existing.type !== "MODE" || isApplied ? availability : null}
      {notice}
      <Collapse in={expanded && !hideDiff}>
        <Stack spacing={1.5}>
          {proposedServiceIds !== undefined && servicesQuery.isLoading ? (
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 1, px: 1 }}
              data-testid="task-proposal-services-loading"
            >
              <CircularProgress size={16} />
              Loading service names…
            </Box>
          ) : proposedServiceIds !== undefined && servicesQuery.error ? (
            <Alert severity="error">Could not load service names.</Alert>
          ) : serviceNamesUnavailable ? (
            <Alert severity="warning">
              One or more current or proposed services are unavailable.
            </Alert>
          ) : isApplied ? (
            <Stack spacing={1.5} sx={{ px: 1 }}>
              {hasGeneralChanges ? (
                <MarkdownRenderer allowMentionEscapes>
                  {newContent}
                </MarkdownRenderer>
              ) : null}
              {structuredRequirementsChange?.status === "invalid" ? (
                <Alert
                  severity="error"
                  data-testid="feature-requirements-invalid"
                >
                  {structuredRequirementsChange.reason}
                </Alert>
              ) : structuredRequirementsChange ? (
                <StructuredRequirementsView
                  requirements={structuredRequirementsChange.after}
                />
              ) : null}
              {htmlCssSections.map((section) => (
                <Stack key={section.key} spacing={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    {section.label}
                  </Typography>
                  <HtmlCssSectionRenderer
                    content={section.proposedValue}
                    definition={section.definition}
                    context="inline"
                    title={`${section.label} approved proposal preview`}
                    organizationId={proposal.organizationId}
                    materializedProposalId={proposal.id}
                    projectId={proposal.projectId}
                    mockupSource={{
                      kind: "proposal",
                      proposalId: proposal.id,
                      sectionKey: section.key,
                    }}
                  />
                </Stack>
              ))}
              {structuredMockupSections.map((section) => (
                <Stack key={section.key} spacing={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    {section.label}
                  </Typography>
                  <StructuredMockupSectionRenderer
                    content={section.proposedValue}
                    definition={section.definition}
                    context="inline"
                  />
                </Stack>
              ))}
              {modeFilesSections.map((section) => (
                <Stack key={section.key} spacing={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    {section.label}
                  </Typography>
                  <ModeFilesSectionRenderer
                    content={section.proposedValue}
                    mentionConfig={modeMentionConfig}
                  />
                </Stack>
              ))}
              {modeSettingsSections.map((section) => (
                <Stack key={section.key} spacing={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    {section.label}
                  </Typography>
                  <ModeSettingsSectionRenderer
                    content={section.proposedValue}
                    previousContent={section.existingValue}
                  />
                </Stack>
              ))}
              {imageSections.map((section) =>
                renderImageSection(section, false),
              )}
            </Stack>
          ) : (
            <Stack spacing={1.5}>
              {modeFilesSections.map((section) => (
                <Stack key={section.key} spacing={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    {section.label}
                  </Typography>
                  <ModeFilesSectionRenderer
                    content={section.proposedValue}
                    mentionConfig={modeMentionConfig}
                    comparison={{
                      currentContent: section.existingValue,
                      defaultViewMode: resolvedDiffMode,
                    }}
                  />
                </Stack>
              ))}
              {existing.type === "MODE" ? (
                <Box component="details">
                  <Box component="summary">Where this mode can be used</Box>
                  {availability}
                </Box>
              ) : null}
              {hasGeneralChanges ? (
                <Box component={existing.type === "MODE" ? "details" : "div"}>
                  {existing.type === "MODE" ? (
                    <Box component="summary">Summary and other changes</Box>
                  ) : null}
                  <DiffRenderer
                    oldContent={oldContent}
                    newContent={newContent}
                    defaultViewMode={resolvedDiffMode}
                    showViewModeToggle
                  />
                </Box>
              ) : null}
              {structuredRequirementsChange?.status === "invalid" ? (
                <Alert
                  severity="error"
                  data-testid="feature-requirements-invalid"
                >
                  {structuredRequirementsChange.reason}
                </Alert>
              ) : structuredRequirementsChange ? (
                <StructuredRequirementsDiffView
                  before={structuredRequirementsChange.before}
                  after={structuredRequirementsChange.after}
                  defaultViewMode={resolvedDiffMode}
                />
              ) : null}
              {htmlCssSections.map((section) => (
                <VisualProposalSectionComparison
                  key={section.key}
                  kind="html/css"
                  label={section.label}
                  definition={section.definition}
                  before={section.existingValue}
                  after={section.proposedValue}
                  organizationId={proposal.organizationId}
                  materializedProposalId={section.materializedProposalId}
                  projectId={proposal.projectId}
                  proposedMockupSource={{
                    kind: "proposal",
                    proposalId: proposal.id,
                    sectionKey: section.key,
                  }}
                />
              ))}
              {structuredMockupSections.map((section) => (
                <VisualProposalSectionComparison
                  key={section.key}
                  kind="structured-mockup"
                  label={section.label}
                  definition={section.definition}
                  before={section.existingValue}
                  after={section.proposedValue}
                />
              ))}
              {modeSettingsSections.map((section) => (
                <Stack
                  component="details"
                  open={modeSettingsComparisonUnavailable}
                  key={section.key}
                  spacing={0.5}
                >
                  <Box component="summary">
                    Eligible work-item types and Project Assistant
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {section.label}
                  </Typography>
                  <ModeSettingsSectionRenderer
                    content={section.proposedValue}
                    previousContent={section.existingValue}
                  />
                </Stack>
              ))}
              {imageSections.map((section) =>
                renderImageSection(section, true),
              )}
            </Stack>
          )}
          {siblingProposals && (
            <ProposalEdges
              edges={proposal.edges}
              siblingProposals={siblingProposals}
              organizationId={proposal.organizationId}
              projectId={proposal.projectId}
              ownerApplied={isApplied}
            />
          )}
        </Stack>
      </Collapse>
      {footer && !overrides?.hideStateIndicator ? (
        modeComparisonUnavailable ? (
          <Alert severity="error">
            Approval is unavailable until the complete comparison can be shown.
          </Alert>
        ) : (
          footer
        )
      ) : (
        !overrides?.hideStateIndicator && (
          <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
            <ProposalStateIndicator
              status={status}
              action={ProposalAction.Update}
              onApply={onApply}
              onReject={onReject}
              disabled={disabled || modeComparisonUnavailable}
              approvalProgress={approvalProgress}
            />
          </Box>
        )
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
