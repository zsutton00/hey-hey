import {
  DiscussCapsuleAction,
  DependentFutures,
  PlanViewer,
  PlanGenerationChat,
  PlanWorktreeEditor,
  PlanAutomationTab,
  PlanArchiveDeleteDialog,
  type ConversationScrollPolicy,
} from "@hey-hey/ui-common/components";
import { createNavigationLineageEntry } from "@hey-hey/ui-common";
import {
  CanonicalPageBoundary,
  createCanonicalPageDescriptor,
  TrackingProvider,
} from "@hey-hey/ui-common/context";
import {
  useCanonicalPlanAggregate,
  useFeatureLookup,
  useProject,
  useWorkItem,
  usePlatformAdminAccess,
} from "@hey-hey/ui-common/data";
import { TargetEntityType, WorkStatus } from "@hey-hey/ui-common/api";
import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import {
  DetailPageContainer,
  DetailPageHeader,
  PageBreadcrumbs,
} from "../../components/Layout";
import { getPlanStatusLabel } from "@hey-hey/ui-common/utils";
import { DataDebugTab } from "../../components/Tabs/DataDebugTab";
import { DesignDocsTab } from "../../components/Tabs/DesignDocsTab";
import { useRemainingViewportHeight } from "../../hooks/useRemainingViewportHeight";
import { useSuppressLayoutMainBottomSpacing } from "../../components/Layout/LayoutMainBottomSpacingContext";
import { useLayoutMainScrollOwner } from "../../components/Layout/LayoutMainScrollOwnerContext";
import { PlanConversationTab } from "./PlanConversationTab";
import {
  buildPlanTabPath,
  buildPlanTaskMonitorPath,
  buildPlanTaskMonitorSetupPath,
  type PlanTab,
} from "./planSessionRoutes";

export interface PlanPageProps {
  organizationId: string;
  projectId: string;
  planId: string;
  stageId?: string;
  preview?: boolean;
  view?: "plan" | "automation";
  automationContent?: ReactNode;
  automationHeightMode?: "auto" | "remaining-viewport";
}

export const PlanPage = ({
  organizationId,
  projectId,
  planId,
  stageId,
  preview = false,
  view = "plan",
  automationContent,
  automationHeightMode = "auto",
}: PlanPageProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isPlatformAdmin } = usePlatformAdminAccess();
  const result = useCanonicalPlanAggregate(organizationId, projectId, planId);
  const aggregate = result.aggregate;
  const plan = aggregate?.plan;
  const { data: project } = useProject(organizationId, projectId, {
    enabled: Boolean(organizationId && projectId),
    preferStale: true,
  });
  const featureLookup = useFeatureLookup(organizationId, projectId);
  const cachedFeature = plan?.parentTaskId
    ? featureLookup.get(plan.parentTaskId)
    : undefined;
  // Read the parent only when the cached hierarchy cannot name it.
  const { workItem: loadedFeature } = useWorkItem(
    organizationId,
    "task",
    plan?.parentTaskId ?? "",
    {
      projectId,
      enabled: Boolean(
        organizationId &&
        plan?.parentTaskId &&
        !featureLookup.isLoading &&
        !cachedFeature,
      ),
    },
  );
  const feature = cachedFeature ?? loadedFeature;
  const [previewTab, setPreviewTab] = useState<PlanTab>("plan");
  const [manageOpen, setManageOpen] = useState(false);
  const layoutMainScrollOwner = useLayoutMainScrollOwner();
  const mainContentRef = layoutMainScrollOwner?.mainContentRef ?? null;
  const planGenerationScrollPolicy = useMemo<ConversationScrollPolicy>(
    () =>
      mainContentRef
        ? { mode: "owned", ownerRef: mainContentRef }
        : { mode: "disabled" },
    [mainContentRef],
  );
  const routeTab = new URLSearchParams(location.search).get("tab");
  const tabs: { value: PlanTab; label: string }[] = [
    { value: "plan", label: "Plan" },
    { value: "documents", label: "Documents" },
    { value: "conversations", label: "Conversations" },
    { value: "automation", label: "Automation" },
    { value: "admin", label: "Admin" },
    ...(isPlatformAdmin
      ? [{ value: "data-debug" as const, label: "Data Debug" }]
      : []),
  ];
  const tab =
    view === "automation"
      ? "automation"
      : preview
        ? previewTab
        : (tabs.find((entry) => entry.value === routeTab)?.value ?? "plan");
  const bounded =
    tab === "automation" &&
    automationHeightMode === "remaining-viewport" &&
    !preview;
  useSuppressLayoutMainBottomSpacing(bounded);
  const { containerRef, height } = useRemainingViewportHeight(bounded, 0);
  const basePath = "/projects/" + projectId + "/plans/" + planId;
  const handleStageChange = useCallback(
    (id: string, options?: { replace?: boolean }) =>
      navigate(basePath + "/stages/" + id, { replace: options?.replace }),
    [basePath, navigate],
  );
  if (!organizationId || !projectId || !planId)
    return <Alert severity="error">Plan scope identifiers are required.</Alert>;
  if (result.status === "loading")
    return (
      <Box sx={{ p: 3 }}>
        <CircularProgress aria-label="Loading plan" />
      </Box>
    );
  if (result.status === "error") {
    if (!result.recovery)
      return <Alert severity="error">{result.error.message}</Alert>;

    return (
      <Stack
        spacing={2}
        sx={{ p: 3 }}
        data-testid="plan-generation-validation-recovery"
      >
        <Alert severity="error" data-testid="plan-generation-validation-error">
          <Stack spacing={0.75}>
            <Typography variant="subtitle2">
              Plan generation failed validation.
            </Typography>
            <Typography variant="body2">{result.error.message}</Typography>
            {result.validationIssues.map((issue, index) => (
              <Stack
                key={`${issue.layer}-${issue.code}-${issue.field}-${index}`}
              >
                <Typography variant="body2">
                  {issue.layer} · {issue.field} · {issue.code}: {issue.reason}
                </Typography>
                {issue.suggestion ? (
                  <Typography variant="caption">{issue.suggestion}</Typography>
                ) : null}
              </Stack>
            ))}
          </Stack>
        </Alert>
        <PlanGenerationChat
          organizationId={organizationId}
          projectId={projectId}
          planId={planId}
          plan={result.recovery.plan}
          configuration={result.recovery.configuration}
          scrollPolicy={planGenerationScrollPolicy}
        />
      </Stack>
    );
  }
  if (!plan || !aggregate)
    return <Alert severity="error">Plan not found.</Alert>;
  const lineage = [
    ...(plan.parentTaskId
      ? [createNavigationLineageEntry("task", plan.parentTaskId)]
      : []),
    createNavigationLineageEntry("task", planId),
  ];
  const automationProps = preview
    ? {}
    : {
        onAutomateStage: (id: string) =>
          navigate(buildPlanTaskMonitorSetupPath(projectId, planId, id)),
        onViewAutomation: () =>
          navigate(buildPlanTabPath(projectId, planId, stageId, "automation")),
      };
  return (
    <TrackingProvider
      context={{
        page: { name: "plan", path: basePath },
        ...(preview
          ? {}
          : {
              attentionEntity: {
                type: "task",
                id: planId,
                lineage,
                name: plan.name,
                status: plan.status,
                projectId,
              },
            }),
      }}
    >
      <CanonicalPageBoundary
        composition={
          preview
            ? { kind: "observational" }
            : {
                kind: "canonical",
                descriptor: createCanonicalPageDescriptor(
                  "task",
                  planId,
                  lineage,
                  { kind: "task", label: plan.name, taskType: plan.type },
                ),
              }
        }
      >
        {!preview && (
          <DiscussCapsuleAction
            entityId={planId}
            entityType={TargetEntityType.Task}
            entityTitle={plan.name}
            organizationId={organizationId}
            projectId={projectId}
          />
        )}
        {!preview && (
          <PageBreadcrumbs
            items={[
              { label: "Projects", to: "/projects" },
              {
                label: project?.name ?? "Project",
                to: "/projects/" + projectId,
                type: "project",
                entityId: projectId,
              },
              ...(plan.parentTaskId
                ? [
                    {
                      label: feature?.name ?? "Feature",
                      to:
                        "/projects/" +
                        projectId +
                        "/features/" +
                        plan.parentTaskId,
                      type: "task" as const,
                      entityId: plan.parentTaskId,
                    },
                  ]
                : []),
              {
                label: "Plans",
                to: plan.parentTaskId
                  ? "/projects/" +
                    projectId +
                    "/features/" +
                    plan.parentTaskId +
                    "?tab=plans"
                  : "/projects/" + projectId + "/plans",
              },
              {
                label: plan.name,
                isCurrent: true,
                type: "task",
                entityId: planId,
              },
            ]}
          />
        )}
        <DetailPageContainer>
          <Box
            ref={bounded ? containerRef : undefined}
            sx={
              bounded
                ? {
                    height: height === null ? undefined : height + "px",
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                    overflow: "hidden",
                  }
                : undefined
            }
          >
            <DetailPageHeader title={plan.name} />
            <DependentFutures
              key={planId}
              organizationId={organizationId}
              projectId={projectId}
              taskId={planId}
            />
            <Chip
              label={getPlanStatusLabel(plan.status)}
              size="small"
              sx={{ alignSelf: "flex-start", my: 1 }}
            />
            <Tabs
              value={tab}
              variant="scrollable"
              onChange={(_, value: PlanTab) => {
                if (preview) setPreviewTab(value);
                else
                  navigate(buildPlanTabPath(projectId, planId, stageId, value));
              }}
            >
              {tabs.map((entry) => (
                <Tab
                  key={entry.value}
                  value={entry.value}
                  label={entry.label}
                />
              ))}
            </Tabs>
            {tab === "plan" && (
              <Box sx={{ mt: 3 }}>
                {plan.status === WorkStatus.Backlog ? (
                  preview ? (
                    <Alert severity="info" data-testid="plan-draft-preview">
                      This Plan is a draft. Open the Plan to generate its stages
                      and tasks.
                    </Alert>
                  ) : (
                    <PlanGenerationChat
                      organizationId={organizationId}
                      projectId={projectId}
                      planId={planId}
                      plan={plan}
                      configuration={aggregate.configuration}
                      scrollPolicy={planGenerationScrollPolicy}
                    />
                  )
                ) : (
                  <PlanViewer
                    organizationId={organizationId}
                    projectId={projectId}
                    planId={planId}
                    disablePreview
                    readOnly={preview}
                    selectedStageId={stageId}
                    onStageChange={preview ? undefined : handleStageChange}
                    {...automationProps}
                  />
                )}
              </Box>
            )}
            {tab === "documents" && (
              <DesignDocsTab
                organizationId={organizationId}
                projectId={projectId}
                planId={planId}
                enableFilters
              />
            )}
            {tab === "conversations" && (
              <PlanConversationTab
                organizationId={organizationId}
                projectId={projectId}
                planId={planId}
                stageId={stageId}
                workflowAboutId={planId}
                workflowAboutType="task"
              />
            )}
            {tab === "data-debug" && isPlatformAdmin && (
              <DataDebugTab
                organizationId={organizationId}
                projectId={projectId}
                entityId={planId}
                entityType="task"
              />
            )}
            {tab === "automation" && (
              <Box
                data-testid="plan-automation-viewport"
                sx={{
                  mt: 3,
                  display: "flex",
                  flexDirection: "column",
                  flex: bounded ? 1 : undefined,
                  minHeight: 0,
                  "& > *": { flex: 1, minHeight: 0, width: "100%" },
                }}
              >
                {automationContent ?? (
                  <PlanAutomationTab
                    organizationId={organizationId}
                    projectId={projectId}
                    planId={planId}
                    buildTaskMonitorPath={(monitorId) =>
                      buildPlanTaskMonitorPath(
                        projectId,
                        planId,
                        stageId,
                        monitorId,
                      )
                    }
                  />
                )}
              </Box>
            )}
            {tab === "admin" && (
              <Stack spacing={3} sx={{ mt: 3 }}>
                <PlanWorktreeEditor
                  plan={plan}
                  configuration={aggregate.configuration}
                />
                {!preview && (
                  <Button color="error" onClick={() => setManageOpen(true)}>
                    Archive or delete Plan
                  </Button>
                )}
              </Stack>
            )}
          </Box>
        </DetailPageContainer>
        <PlanArchiveDeleteDialog
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          organizationId={organizationId}
          projectId={projectId}
          planId={planId}
          planName={plan.name}
          planStatus={plan.status}
          onDeleted={() => navigate("/projects/" + projectId + "/plans")}
        />
      </CanonicalPageBoundary>
    </TrackingProvider>
  );
};
