import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import type {
  TaskMonitorExecutionDefinition,
  TaskMonitorLaunchMethod,
  TaskMonitorReviewMode,
} from "../../api";
import type {
  ConversationStartRunRequestDtoReasoningEffortEnum,
  ConversationStartRunRequestDtoProviderEnum,
} from "../../api";
import { WorktreeSetupControls } from "../AgentSession/WorktreeSetupControls";
import type { RuntimeModelCatalogSource } from "../AgentSession/useRuntimeModelCatalog";
import { TaskMonitorReviewModeControl } from "../TaskMonitor/TaskMonitorReviewModeControl";
import {
  MarkdownLexicalEditor,
  type MarkdownLexicalEditorEntitySlashConfig,
  type MarkdownLexicalEditorMentionConfig,
} from "../LexicalEditor/MarkdownLexicalEditor";
import type { PlanStageTaskMonitorTaskSelection } from "./PlanStageTaskMonitorExecutionVisualization";
import type {
  PlanStageTaskMonitorExecutableTask,
  PlanStageTaskMonitorProvenance,
} from "./planStageTaskMonitorSetup";
import { PlanStageTaskMonitorExecutionVisualization } from "./PlanStageTaskMonitorExecutionVisualization";

export interface PlanStageTaskMonitorSetupReviewViewProps {
  /** The machine whose CLI offers the model choices; null until one is picked. */
  catalogSource: RuntimeModelCatalogSource | null;
  definition: TaskMonitorExecutionDefinition;
  executableTasks: readonly PlanStageTaskMonitorExecutableTask[];
  taskSelection: PlanStageTaskMonitorTaskSelection;
  provenance: PlanStageTaskMonitorProvenance;
  userMessage: string;
  userMessageMentionConfig: MarkdownLexicalEditorMentionConfig;
  userMessageEntitySlashConfig: MarkdownLexicalEditorEntitySlashConfig;
  onChangeUserMessage: (userMessage: string) => void;
  onChangeMethod: (taskId: string, method: TaskMonitorLaunchMethod) => void;
  onChangeProvider: (
    taskId: string,
    provider: ConversationStartRunRequestDtoProviderEnum,
  ) => void;
  onChangeModel: (taskId: string, model: string) => void;
  onChangeReasoningEffort: (
    taskId: string,
    effort: ConversationStartRunRequestDtoReasoningEffortEnum | null,
  ) => void;
  onChangeFastMode: (taskId: string, fastMode: boolean) => void;
  onChangeReviewMode: (mode: TaskMonitorReviewMode) => void;
  worktreeBranch: string | null;
  worktreeLocked: boolean;
  onChangeWorktreeBranch: (branch: string | null) => void;
  isRefreshingTaskServices: boolean;
  updatingTaskServiceIds: readonly string[];
  serviceUpdateError: string | null;
  onChangeTaskServices: (taskId: string, serviceIds: string[]) => void;
  onRefreshTaskServices: () => void;
  onConfirm: () => void;
}

export const PlanStageTaskMonitorSetupReviewView = ({
  catalogSource,
  definition,
  executableTasks,
  taskSelection,
  provenance,
  userMessage,
  userMessageMentionConfig,
  userMessageEntitySlashConfig,
  onChangeUserMessage,
  onChangeMethod,
  onChangeProvider,
  onChangeModel,
  onChangeReasoningEffort,
  onChangeFastMode,
  onChangeReviewMode,
  worktreeBranch,
  worktreeLocked,
  onChangeWorktreeBranch,
  isRefreshingTaskServices,
  updatingTaskServiceIds,
  serviceUpdateError,
  onChangeTaskServices,
  onRefreshTaskServices,
  onConfirm,
}: PlanStageTaskMonitorSetupReviewViewProps) => {
  const selectedExecutableTasks = executableTasks.filter((task) =>
    taskSelection.selectedTaskIds.has(task.taskId),
  );
  const tasksMissingServices = selectedExecutableTasks.filter(
    (task) => task.serviceIds.length === 0,
  );
  const canStart =
    !isRefreshingTaskServices &&
    updatingTaskServiceIds.length === 0 &&
    selectedExecutableTasks.length > 0 &&
    tasksMissingServices.length === 0 &&
    (worktreeBranch === null || worktreeBranch.trim().length > 0);

  return (
    <Stack spacing={3} data-testid="plan-stage-task-monitor-setup-review">
      <Box data-testid="plan-stage-task-monitor-provenance">
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="h5">Review Task Monitor setup</Typography>
          <Chip label="Plan stage" size="small" />
        </Stack>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {provenance.planLabel}
        </Typography>
        <Typography color="text.secondary">
          Stage: {provenance.stageLabel}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Prepared {provenance.preparedAt}
        </Typography>
      </Box>

      <PlanStageTaskMonitorExecutionVisualization
        definition={definition}
        executableTasks={executableTasks}
        taskSelection={taskSelection}
        serviceSelection={{
          organizationId: provenance.organizationId,
          projectId: provenance.projectId,
          updatingTaskServiceIds,
          onChange: onChangeTaskServices,
        }}
        launchConfigurationEditing={{
          catalogSource,
          onChangeMethod,
          onChangeProvider,
          onChangeModel,
          onChangeReasoningEffort,
          onChangeFastMode,
        }}
      />

      <Card data-testid="plan-stage-task-monitor-launch-configuration">
        <CardContent>
          <Stack spacing={1.5}>
            <Typography variant="h6">Shared session settings</Typography>
            <Typography color="text.secondary">
              These settings apply across all selected tasks.
            </Typography>
            <TaskMonitorReviewModeControl
              value={definition.launchPolicy.terminalSupervision.mode}
              onChange={onChangeReviewMode}
            />
            <Divider />
            <Box data-testid="plan-stage-task-monitor-worktree-card">
              <Typography variant="subtitle2">Worktree</Typography>
              <Typography variant="body2" color="text.secondary">
                Materialize every selected task session on a shared branch.
              </Typography>
              <WorktreeSetupControls
                branch={worktreeBranch}
                locked={worktreeLocked}
                onChangeBranch={onChangeWorktreeBranch}
                toggleTestId="plan-stage-task-monitor-worktree-toggle"
                controlsTestId="plan-stage-task-monitor-worktree-controls"
                branchTestId="plan-stage-task-monitor-worktree-branch-name"
              />
              {worktreeBranch !== null && worktreeBranch.trim().length === 0 ? (
                <Alert
                  severity="error"
                  sx={{ mt: 1.5 }}
                  data-testid="plan-stage-task-monitor-worktree-branch-error"
                >
                  Enter a branch name before starting the Task Monitor.
                </Alert>
              ) : null}
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {serviceUpdateError ? (
        <Alert
          severity="error"
          data-testid="plan-stage-task-monitor-service-update-error"
        >
          {serviceUpdateError}
        </Alert>
      ) : null}

      {tasksMissingServices.length > 0 ? (
        <Alert
          severity="error"
          data-testid="plan-stage-task-monitor-missing-services"
        >
          <Stack spacing={1.5}>
            <Typography fontWeight={600}>
              Every selected task needs at least one Service before this Task
              Monitor can start.
            </Typography>
            <Typography variant="body2">
              Select Services on each highlighted task above. You can also open
              a task by selecting its title.
            </Typography>
            <Box>
              <Button
                variant="outlined"
                size="small"
                data-testid="plan-stage-task-monitor-refresh-services"
                disabled={isRefreshingTaskServices}
                startIcon={
                  isRefreshingTaskServices ? (
                    <CircularProgress size={16} />
                  ) : undefined
                }
                onClick={onRefreshTaskServices}
              >
                Refresh services
              </Button>
            </Box>
          </Stack>
        </Alert>
      ) : null}

      <Card data-testid="plan-stage-task-monitor-user-message">
        <CardContent>
          <MarkdownLexicalEditor
            value={userMessage}
            onTextChange={onChangeUserMessage}
            isLoading={false}
            placeholder="Add an optional message for the Task Monitor…"
            mentionConfig={userMessageMentionConfig}
            entitySlashConfig={userMessageEntitySlashConfig}
          />
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            This optional message is sent with Start and is not stored in the
            execution definition.
          </Typography>
        </CardContent>
      </Card>

      <Divider />
      <Button
        variant="contained"
        data-testid="plan-stage-task-monitor-confirm"
        disabled={!canStart}
        onClick={onConfirm}
      >
        Start Task Monitor
      </Button>
    </Stack>
  );
};
