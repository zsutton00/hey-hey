import { useModalState } from "../Modals/useModalState";
import { ModalWorkOwner } from "../Modals/ModalWorkOwner";
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import FlagIcon from "@mui/icons-material/Flag";
import TrendingUp from "@mui/icons-material/TrendingUp";
import Warning from "@mui/icons-material/Warning";
import Summarize from "@mui/icons-material/Summarize";
import { type SvgIconComponent } from "@mui/icons-material";
import React, { useCallback, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  EntityType,
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportType,
  TargetEntityType,
  type CreateGoalDto,
  type ReportDto,
  type ReportEntityDto,
  type TaskResponseDto,
} from "../../api";
import { usePathService } from "../../contexts";
import type { PathService } from "../../services";
import { unifiedApiClient } from "../../clients/serviceClients";
import { useWorkItems } from "../../data/hooks/useWorkItems";
import { useTaskHierarchy } from "../../data/hooks/useTaskHierarchy";
import {
  deriveGoalStatus,
  goalStatusChipDescriptor,
} from "../../utils/goalStatus";
import { KEYS } from "../../i18n/keys";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import type { MentionMode } from "../SmarterTextAreaCard/MentionBadge";
import { InteractionComponent } from "../InteractionComponent/InteractionComponent";
import { NewGoalModal, type GoalSourceEntityRef } from "../Goals/NewGoalModal";

const REPORT_TYPE_CONFIG: Record<
  string,
  { label: string; Icon: SvgIconComponent }
> = {
  [ReportType.GoalProgress]: { label: "Goal Progress", Icon: TrendingUp },
  [ReportType.RiskAlert]: { label: "Risk Alert", Icon: Warning },
  [ReportType.SessionSummary]: { label: "Session Summary", Icon: Summarize },
  [ReportType.FeatureTreeAnalysis]: {
    label: "Feature Tree Analysis",
    Icon: AccountTreeIcon,
  },
  [ReportType.CompetitiveAnalysis]: {
    label: "Competitive Analysis",
    Icon: CompareArrowsIcon,
  },
};

function getReportText(report: ReportDto): string | undefined {
  const { payload } = report;
  if (
    payload.reportType === "GOAL_PROGRESS" ||
    payload.reportType === "RISK_ALERT" ||
    payload.reportType === "SESSION_SUMMARY" ||
    payload.reportType === "FEATURE_TREE_ANALYSIS" ||
    payload.reportType === "COMPETITIVE_ANALYSIS"
  ) {
    return payload.text;
  }
  return undefined;
}

function getReportTitle(report: ReportDto): string | undefined {
  const p = report.payload as unknown as Record<string, unknown>;
  if (typeof p.title === "string" && p.title.trim()) {
    return p.title;
  }
  return undefined;
}

function getGoalAnchorId(report: ReportDto): string | undefined {
  const { payload } = report;
  if (payload.reportType !== "GOAL_PROGRESS") return undefined;
  const anchor = payload.goalAnchor;
  if (!anchor) return undefined;
  return anchor.entityId;
}

const formatGoalDueDate = (value?: string | null): string | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const resolveReportEntityHref = (
  entity: ReportEntityDto,
  projectId: string,
  pathService: PathService,
): string | undefined => {
  switch (entity.entityType) {
    case ReportRelatedEntityType.Task:
      return pathService.task({ projectId, taskId: entity.entityId });
    case ReportRelatedEntityType.Goal:
      return pathService.goal({ projectId, taskId: entity.entityId });
    case ReportRelatedEntityType.Initiative:
      return pathService.initiativeDetail({
        projectId,
        initiativeId: entity.entityId,
      });
    case ReportRelatedEntityType.DesignDoc:
      return pathService.designDoc({ projectId, designDocId: entity.entityId });
    case ReportRelatedEntityType.AgentSession:
      return pathService.agentSession({
        projectId,
        agentSessionId: entity.entityId,
      });
    case ReportRelatedEntityType.Service:
      return pathService.service({ projectId, serviceId: entity.entityId });
    case ReportRelatedEntityType.Conversation:
      return pathService.conversation({
        projectId,
        conversationId: entity.entityId,
      });
    default:
      return undefined;
  }
};

const EntityReference: React.FC<{
  entity: ReportEntityDto;
  projectId: string;
  pathService: PathService;
}> = ({ entity, projectId, pathService }) => {
  const theme = useTheme();
  const isPrimary = entity.relation === ReportEntityRelation.Primary;
  const href = resolveReportEntityHref(entity, projectId, pathService);
  const label =
    entity.displayName ?? `${entity.entityType} ${entity.entityId.slice(0, 8)}`;

  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Typography
        variant="body2"
        sx={{
          fontWeight: isPrimary ? 600 : 400,
          color: isPrimary ? "text.primary" : "text.secondary",
        }}
      >
        {href ? (
          <RouterLink
            to={href}
            style={{
              textDecoration: "none",
              color: theme.palette.primary.main,
            }}
          >
            {label}
          </RouterLink>
        ) : (
          label
        )}
      </Typography>
      <Chip
        label={isPrimary ? "PRIMARY" : "CONTEXT"}
        size="small"
        sx={{
          height: 20,
          fontSize: "0.65rem",
          fontWeight: 600,
          bgcolor: isPrimary
            ? theme.palette.primary.main
            : theme.palette.action.selected,
          color: isPrimary
            ? theme.palette.primary.contrastText
            : theme.palette.text.secondary,
        }}
      />
    </Stack>
  );
};

interface GoalAnchorHeaderProps {
  organizationId: string;
  projectId: string;
  goalTaskId: string;
}

const GoalAnchorHeader: React.FC<GoalAnchorHeaderProps> = ({
  organizationId,
  projectId,
  goalTaskId,
}) => {
  const theme = useTheme();
  const pathService = usePathService();
  const { task } = useTaskHierarchy(organizationId, projectId, goalTaskId, {
    enabled: !!organizationId && !!projectId && !!goalTaskId,
  });

  const goalTask = task as TaskResponseDto | null;
  if (!goalTask) return null;

  const status = deriveGoalStatus({
    dueDate: goalTask.dueDate,
    trackedEntities: goalTask.trackedEntities,
  });
  const chip = goalStatusChipDescriptor(status);
  const formattedDueDate = formatGoalDueDate(goalTask.dueDate);
  const href = pathService.task({ projectId, taskId: goalTaskId });

  return (
    <Stack
      spacing={0.5}
      sx={{
        mb: 1.5,
        pb: 1.5,
        borderBottom: `1px solid ${theme.palette.divider}`,
      }}
      data-testid="report-card-goal-anchor"
    >
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Typography
          variant="subtitle1"
          sx={{ fontWeight: 600, lineHeight: 1.3 }}
          data-testid="report-card-goal-anchor-name"
        >
          <RouterLink
            to={href}
            style={{
              textDecoration: "none",
              color: theme.palette.text.primary,
            }}
          >
            {goalTask.name}
          </RouterLink>
        </Typography>
        <Chip
          label={chip.fallback}
          color={chip.color}
          size="small"
          data-testid="report-card-goal-anchor-status"
        />
      </Stack>
      {formattedDueDate && (
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="report-card-goal-anchor-due-date"
        >
          Due {formattedDueDate}
        </Typography>
      )}
    </Stack>
  );
};

export interface ReportCardProps {
  report: ReportDto;
  organizationId: string;
  projectId: string;
  mentionMode?: MentionMode;
  embeddedInGoalPage?: boolean;
}

const REPORT_ENTITY_TO_GOAL_TARGET: Partial<
  Record<ReportRelatedEntityType, EntityType>
> = {
  [ReportRelatedEntityType.Task]: EntityType.Task,
};

const toGoalSourceEntityRefs = (
  entities: ReportEntityDto[],
): GoalSourceEntityRef[] =>
  entities
    .map((entity) => {
      const targetType = REPORT_ENTITY_TO_GOAL_TARGET[entity.entityType];
      if (!targetType) return null;
      return { entityType: targetType, entityId: entity.entityId };
    })
    .filter((ref): ref is GoalSourceEntityRef => ref !== null);

export const ReportCard: React.FC<ReportCardProps> = ({
  report,
  organizationId,
  projectId,
  mentionMode,
  embeddedInGoalPage = false,
}) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const pathService = usePathService();
  const config = REPORT_TYPE_CONFIG[report.reportType];
  const text = getReportText(report);
  const payloadTitle = getReportTitle(report);
  const goalAnchorId = getGoalAnchorId(report);

  const canCreateGoalFromReport =
    report.reportType === ReportType.GoalProgress &&
    !goalAnchorId &&
    !embeddedInGoalPage;

  const [createGoalOpen, setCreateGoalOpen, createGoalOpenOwnerKey] =
    useModalState(false);
  const [isCreatingGoal, setIsCreatingGoal] = useState(false);
  const [createGoalError, setCreateGoalError] = useState<string | null>(null);

  const { createTask } = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    {
      taskType: "GOAL",
      parentTaskId: null,
      enabled: canCreateGoalFromReport,
      websocketsEnabled: false,
    },
  );

  const initialSourceEntityRefs = useMemo(
    () => toGoalSourceEntityRefs(report.entities),
    [report.entities],
  );

  const handleOpenCreateGoal = useCallback(() => {
    setCreateGoalError(null);
    setCreateGoalOpen(true);
  }, []);

  const handleCloseCreateGoal = useCallback(() => {
    if (isCreatingGoal) return;
    setCreateGoalOpen(false);
  }, [isCreatingGoal]);

  const handleCreateGoalSubmit = useCallback(
    async (
      payload: CreateGoalDto,
      sourceEntityRefs: GoalSourceEntityRef[],
    ): Promise<void> => {
      setIsCreatingGoal(true);
      setCreateGoalError(null);
      try {
        const created = await createTask({
          ...payload,
          type: "GOAL",
        });
        await Promise.all(
          sourceEntityRefs.map((ref) =>
            unifiedApiClient.attachToGoal({
              organizationId,
              projectId,
              taskId: created.id,
              attachToGoalDto: {
                targetEntityId: ref.entityId,
                targetEntityType: ref.entityType,
              },
            }),
          ),
        );
        setCreateGoalOpen(false);
      } catch (err: unknown) {
        const error = err as { message?: string };
        setCreateGoalError(error?.message ?? t(KEYS.common.error));
      } finally {
        setIsCreatingGoal(false);
      }
    },
    [createTask, organizationId, projectId, t],
  );

  if (!text?.trim()) return null;

  const Icon = config?.Icon;

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, pb: 4, display: "flex", flexDirection: "column" }}
      data-testid={`report-card-${report.reportType}`}
    >
      <Box
        sx={{
          flex: 1,
          "& > [data-testid='interaction-component']": { height: "100%" },
        }}
      >
        <InteractionComponent
          entityId={report.id}
          entityType={TargetEntityType.Report}
          hasProposalSupport={true}
          draggable={false}
          entityTitle={payloadTitle ?? report.title}
          organizationId={organizationId}
          projectId={projectId}
          size="small"
          indicatorPlacement="bottom-left"
          indicatorOffsetY={-10}
        >
          {goalAnchorId && (
            <GoalAnchorHeader
              organizationId={organizationId}
              projectId={projectId}
              goalTaskId={goalAnchorId}
            />
          )}

          {config && (
            <Stack spacing={0.5} sx={{ mb: 1.5 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                {Icon && (
                  <Icon
                    sx={{
                      fontSize: "1rem",
                      color: theme.palette.text.secondary,
                    }}
                  />
                )}
                <Typography
                  variant="subtitle2"
                  sx={{
                    fontWeight: 600,
                    color: "text.secondary",
                    textTransform: "uppercase",
                    fontSize: "0.65rem",
                    letterSpacing: "0.05em",
                  }}
                >
                  {config.label}
                </Typography>
              </Stack>
              {payloadTitle && (
                <Typography
                  variant="subtitle1"
                  sx={{ fontWeight: 600, lineHeight: 1.3 }}
                >
                  {payloadTitle}
                </Typography>
              )}
            </Stack>
          )}

          <Box
            sx={{
              "& p:first-of-type": { mt: 0 },
              "& p:last-of-type": { mb: 0 },
            }}
          >
            <MarkdownRenderer mentionMode={mentionMode}>
              {text}
            </MarkdownRenderer>
          </Box>

          {canCreateGoalFromReport && (
            <Stack spacing={1} sx={{ mt: 2 }}>
              {createGoalError && (
                <Alert
                  severity="error"
                  data-testid="report-card-create-goal-error"
                >
                  {createGoalError}
                </Alert>
              )}
              <Box>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<FlagIcon />}
                  onClick={handleOpenCreateGoal}
                  aria-label={t(KEYS.reports.createGoalFromThisAriaLabel)}
                  data-testid="report-card-create-goal-button"
                >
                  {t(KEYS.reports.createGoalFromThis)}
                </Button>
              </Box>
            </Stack>
          )}

          {report.entities.length > 0 &&
            report.reportType !== ReportType.SessionSummary && (
              <Stack
                spacing={0.75}
                sx={{
                  mt: 2,
                  pt: 1.5,
                  borderTop: `1px solid ${theme.palette.divider}`,
                }}
              >
                {report.entities.map((entity) => (
                  <EntityReference
                    key={`${entity.entityType}-${entity.entityId}`}
                    entity={entity}
                    projectId={projectId}
                    pathService={pathService}
                  />
                ))}
              </Stack>
            )}
        </InteractionComponent>
      </Box>
      {canCreateGoalFromReport && (
        <ModalWorkOwner.Provider value={createGoalOpenOwnerKey}>
          <NewGoalModal
            open={createGoalOpen}
            onClose={handleCloseCreateGoal}
            onSubmit={handleCreateGoalSubmit}
            isLoading={isCreatingGoal}
            initialName={payloadTitle}
            initialDescription={text}
            initialSourceEntityRefs={initialSourceEntityRefs}
          />
        </ModalWorkOwner.Provider>
      )}
    </Paper>
  );
};
