import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DeleteIcon from "@mui/icons-material/Delete";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import {
  Alert,
  Box,
  Button,
  Link,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { parseAsString, useQueryState } from "nuqs";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  EvalRunStatus,
  WorkStatus,
  type MaterializedWorkItemSection,
  type TaskResponseDto,
} from "@hey-hey/ui-common/api";
import { CapsuleAction, WorkItemReadView } from "@hey-hey/ui-common/components";
import {
  useEvalRuns,
  useWorkItemTypeByKey,
  useWorkItems,
  type EvalRunReport,
  usePlatformAdminAccess,
} from "@hey-hey/ui-common/data";
import { WebPathService } from "@hey-hey/ui-common/services";

import {
  DetailPageContainer,
  DetailPageHeader,
  DetailPageTabs,
  type DetailPageTab,
} from "../../components/Layout";
import { AdminTab, buildAdminMetadataItems } from "../../components/Tabs";
import { ConversationListTab } from "../../components/Tabs/ConversationListTab";
import { DataDebugTab } from "../../components/Tabs/DataDebugTab";
import { TaskBreadcrumbs } from "../../components/TaskBreadcrumbs";
import { useFeatureAncestors } from "../../components/useFeatureAncestors";
import {
  selectResolvedWorkItemSections,
  WORK_ITEM_TYPE_KEYS,
} from "../../types/workItemTypes";

export interface EvalPageProps {
  organizationId: string;
  projectId: string;
  task: TaskResponseDto;
}

const TAB_EVAL = "eval";
const TAB_RUNS = "runs";
const TAB_CONVERSATIONS = "conversations";
const TAB_ADMIN = "admin";
const TAB_DATA_DEBUG = "data-debug";

const isNavigationModified = (event: React.MouseEvent): boolean =>
  event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0;

const formatStarted = (createdAt: string): string =>
  new Date(createdAt).toLocaleString();

export const EvalPage: React.FC<EvalPageProps> = ({
  organizationId,
  projectId,
  task,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isPlatformAdmin } = usePlatformAdminAccess();
  const evalId = task.id;
  const [activeTab, setActiveTab] = useQueryState(
    "tab",
    parseAsString.withDefault(TAB_EVAL),
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const { ancestors: featureAncestors } = useFeatureAncestors({
    organizationId,
    projectId,
    task,
  });

  const { workItemTypeDefinition, isFetched: isWorkItemTypeFetched } =
    useWorkItemTypeByKey(organizationId, projectId, task.type);
  const sectionSelection = useMemo(
    () =>
      selectResolvedWorkItemSections({
        typeKey: task.type,
        definition: workItemTypeDefinition,
        isFetched: isWorkItemTypeFetched,
      }),
    [isWorkItemTypeFetched, task.type, workItemTypeDefinition],
  );

  // Approval is the only runnable marker: unapproved drafts live as
  // proposals in the conversation and never reach this list.
  const {
    workItems: approvedCases,
    isLoading: isCasesLoading,
    remove: removeWorkItem,
  } = useWorkItems(organizationId, "task", projectId, undefined, {
    parentTaskId: evalId,
    taskType: WORK_ITEM_TYPE_KEYS.EvalCase,
    status: WorkStatus.Active,
    enabled: !!organizationId && !!projectId,
  });
  const {
    runs,
    isLoading: isRunsLoading,
    error: runsError,
  } = useEvalRuns(organizationId, projectId, evalId);

  const runSetupPath = WebPathService.evalRunSetup({ projectId, evalId });
  const handleOpenRunSetup = useCallback(() => {
    navigate(runSetupPath);
  }, [navigate, runSetupPath]);

  const handleDelete = useCallback(async () => {
    try {
      setIsDeleting(true);
      await removeWorkItem(evalId);
      navigate(WebPathService.returnToProject(projectId));
    } finally {
      setIsDeleting(false);
    }
  }, [evalId, navigate, projectId, removeWorkItem]);

  const tabs = useMemo<DetailPageTab[]>(() => {
    const built: DetailPageTab[] = [
      { value: TAB_EVAL, label: t("eval.page.tabs.eval") },
      { value: TAB_RUNS, label: t("eval.page.tabs.runs") },
      {
        value: TAB_CONVERSATIONS,
        label: t("eval.page.tabs.conversations"),
      },
      { value: TAB_ADMIN, label: t("eval.page.tabs.admin") },
    ];
    if (isPlatformAdmin) {
      built.push({
        value: TAB_DATA_DEBUG,
        label: t("eval.page.tabs.dataDebug"),
      });
    }
    return built;
  }, [isPlatformAdmin, t]);

  const renderRunRow = (run: EvalRunReport): React.ReactNode => {
    const { status, cases, configurations } = run.payload;
    const runParams = { projectId, evalId, runId: run.id };
    const runHref = WebPathService.evalRun(runParams);
    const resultsHref =
      status === EvalRunStatus.Finished || status === EvalRunStatus.Stopped
        ? WebPathService.evalRunResults(runParams)
        : null;
    const handleLinkClick =
      (href: string) =>
      (event: React.MouseEvent): void => {
        if (isNavigationModified(event)) return;
        event.preventDefault();
        navigate(href);
      };
    return (
      <TableRow key={run.id} data-testid={`eval-run-row-${run.id}`}>
        <TableCell>
          <Link
            href={runHref}
            onClick={handleLinkClick(runHref)}
            data-testid={`eval-run-link-${run.id}`}
          >
            {run.title}
          </Link>
        </TableCell>
        <TableCell>{t(`eval.page.runs.status.${status}`)}</TableCell>
        <TableCell>{`${cases.length} × ${configurations.length}`}</TableCell>
        <TableCell>{formatStarted(run.createdAt)}</TableCell>
        <TableCell>
          {resultsHref && (
            <Link
              href={resultsHref}
              onClick={handleLinkClick(resultsHref)}
              data-testid={`eval-run-results-link-${run.id}`}
            >
              {t("eval.page.runs.results")}
            </Link>
          )}
        </TableCell>
      </TableRow>
    );
  };

  return (
    <>
      <CapsuleAction
        id="run-eval"
        label={t("eval.page.run")}
        icon={PlayArrowIcon}
        actionGroup="page"
        tier="page"
        order={1}
        behavior="click"
        onClick={handleOpenRunSetup}
      />
      <TaskBreadcrumbs
        projectId={projectId}
        task={task}
        featureAncestors={featureAncestors}
      />
      <DetailPageContainer>
        <Box data-testid="eval-page">
          <DetailPageHeader title={task.name} />
          <DetailPageTabs
            value={activeTab}
            onChange={setActiveTab}
            tabs={tabs}
            overflow="menu"
          />

          {activeTab === TAB_EVAL && (
            <Box sx={{ p: 3 }}>
              <Box data-testid="eval-objective" sx={{ mb: 3 }}>
                <WorkItemReadView
                  htmlCssRenderingContext="page"
                  sections={
                    task.sections as MaterializedWorkItemSection[] | undefined
                  }
                  sectionSelection={sectionSelection}
                />
              </Box>
              <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
                {t("eval.page.cases.title")}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t("eval.page.cases.hiddenNote")}
              </Typography>
              {approvedCases.length === 0 && !isCasesLoading ? (
                <Typography
                  data-testid="eval-case-list-empty"
                  variant="body2"
                  color="text.secondary"
                >
                  {t("eval.page.cases.empty")}
                </Typography>
              ) : (
                <Box
                  component="ul"
                  data-testid="eval-case-list"
                  sx={{ listStyle: "none", m: 0, p: 0 }}
                >
                  {approvedCases.map((evalCase) => {
                    const href = WebPathService.task({
                      projectId,
                      taskId: evalCase.id,
                    });
                    return (
                      <Box
                        component="li"
                        key={evalCase.id}
                        sx={{ borderBottom: 1, borderColor: "divider" }}
                      >
                        <Box
                          component="a"
                          href={href}
                          data-testid={`eval-case-${evalCase.id}`}
                          onClick={(event: React.MouseEvent) => {
                            if (isNavigationModified(event)) return;
                            event.preventDefault();
                            navigate(href);
                          }}
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            py: 1.5,
                            color: "text.primary",
                            textDecoration: "none",
                          }}
                        >
                          <Typography variant="body1">
                            {evalCase.name}
                          </Typography>
                          <ChevronRightIcon color="action" />
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Box>
          )}

          {activeTab === TAB_RUNS && (
            <Box data-testid="eval-runs-tab" sx={{ p: 3 }}>
              <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
                <Button
                  variant="contained"
                  startIcon={<PlayArrowIcon />}
                  onClick={handleOpenRunSetup}
                  data-testid="eval-new-run"
                >
                  {t("eval.page.runs.new")}
                </Button>
              </Box>
              {runsError ? (
                <Alert severity="error">{t("eval.page.runs.error")}</Alert>
              ) : runs.length === 0 && !isRunsLoading ? (
                <Typography
                  data-testid="eval-runs-empty"
                  variant="body2"
                  color="text.secondary"
                >
                  {t("eval.page.runs.empty")}
                </Typography>
              ) : (
                <Table size="small" data-testid="eval-runs-table">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t("eval.page.runs.columns.run")}</TableCell>
                      <TableCell>
                        {t("eval.page.runs.columns.status")}
                      </TableCell>
                      <TableCell>
                        {t("eval.page.runs.columns.casesBySetups")}
                      </TableCell>
                      <TableCell>
                        {t("eval.page.runs.columns.started")}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>{runs.map(renderRunRow)}</TableBody>
                </Table>
              )}
            </Box>
          )}

          {activeTab === TAB_CONVERSATIONS && (
            <ConversationListTab
              organizationId={organizationId}
              projectId={projectId}
              entityName={task.name}
              workflowAboutId={evalId}
              workflowAboutType="task"
              conversationPathForId={(conversationId) =>
                `/projects/${projectId}/resolve-agent-session/${conversationId}`
              }
            />
          )}

          {activeTab === TAB_ADMIN && (
            <AdminTab
              metadataItems={buildAdminMetadataItems({
                createdAt: task.createdAt,
                updatedAt: task.updatedAt,
                archivedAt: task.archivedAt,
              })}
              actions={
                <Button
                  startIcon={<DeleteIcon />}
                  onClick={handleDelete}
                  variant="outlined"
                  color="error"
                  disabled={isDeleting}
                  size="small"
                  data-testid="eval-delete-button"
                >
                  {t("eval.page.delete")}
                </Button>
              }
            />
          )}

          {isPlatformAdmin && activeTab === TAB_DATA_DEBUG && (
            <DataDebugTab
              organizationId={organizationId}
              projectId={projectId}
              entityId={evalId}
              entityType="task"
            />
          )}
        </Box>
      </DetailPageContainer>
    </>
  );
};
