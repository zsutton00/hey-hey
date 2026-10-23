import {
  Alert,
  Box,
  ButtonBase,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import type {
  TaskMonitorExecutionDefinition,
  TaskMonitorExecutionPlanNode,
  TaskMonitorLaunchMethod,
} from "../../api";
import { usePreviewHost } from "../../contexts/PreviewHostContext";
import type {
  ConversationStartRunRequestDtoReasoningEffortEnum,
  ConversationStartRunRequestDtoProviderEnum,
} from "../../api";
import { createOpenItemEntity } from "../../types/openItems";
import { RuntimeModelSelector } from "../AgentSession/RuntimeModelSelector";
import type { RuntimeModelCatalogSource } from "../AgentSession/useRuntimeModelCatalog";
import { ServiceSelector } from "../Selectors/ServiceSelector";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import type { PlanStageTaskMonitorExecutableTask } from "./planStageTaskMonitorSetup";

export interface PlanStageTaskMonitorTaskSelection {
  selectedTaskIds: ReadonlySet<TaskMonitorExecutionPlanNode["taskId"]>;
  onToggleTask: (taskId: TaskMonitorExecutionPlanNode["taskId"]) => void;
}

interface PlanStageTaskMonitorExecutionVisualizationBaseProps {
  definition: TaskMonitorExecutionDefinition;
  executableTasks: readonly PlanStageTaskMonitorExecutableTask[];
  taskSelection?: PlanStageTaskMonitorTaskSelection;
  launchConfigurationEditing?: {
    /** The machine whose CLI offers the model choices; null until one is picked. */
    catalogSource: RuntimeModelCatalogSource | null;
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
  };
}

export type PlanStageTaskMonitorExecutionVisualizationProps =
  PlanStageTaskMonitorExecutionVisualizationBaseProps &
    (
      | {
          serviceSelection: {
            organizationId: string;
            projectId: string;
            updatingTaskServiceIds: readonly string[];
            onChange: (taskId: string, serviceIds: string[]) => void;
          };
        }
      | { serviceSelection?: undefined }
    );

export const PlanStageTaskMonitorExecutionVisualization = ({
  definition,
  executableTasks,
  serviceSelection,
  taskSelection,
  launchConfigurationEditing,
}: PlanStageTaskMonitorExecutionVisualizationProps) => {
  const previewHost = usePreviewHost();
  const tasksById = new Map(executableTasks.map((task) => [task.taskId, task]));
  const nodesByTaskId = new Map(
    definition.executionPlan.map((node) => [node.taskId, node]),
  );
  const orderedTasks = executableTasks
    .map((task) => ({ task, node: nodesByTaskId.get(task.taskId) }))
    .filter(
      (
        item,
      ): item is {
        task: PlanStageTaskMonitorExecutableTask;
        node: TaskMonitorExecutionPlanNode;
      } => item.node !== undefined,
    );

  return (
    <Card data-testid="plan-stage-task-monitor-execution-visualization">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Tasks to execute
        </Typography>
        <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
          This ordered task plan is fixed. Dependencies use canonical Task
          identities.
        </Typography>
        {orderedTasks.length === 0 ? (
          <Alert severity="warning">No executable Tasks are available.</Alert>
        ) : (
          <Stack
            component="ol"
            spacing={1.5}
            sx={{ m: 0, p: 0, listStyle: "none" }}
          >
            {orderedTasks.map(({ task, node }, index) => {
              const isSelected =
                taskSelection?.selectedTaskIds.has(node.taskId) ?? true;
              const dependencyIds = node.dependsOnTaskIds.filter(
                (taskId) => taskSelection?.selectedTaskIds.has(taskId) ?? true,
              );
              return (
                <Box
                  component="li"
                  key={node.taskId}
                  sx={{
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    p: 2,
                  }}
                >
                  <Stack direction="row" spacing={1.5} alignItems="flex-start">
                    {taskSelection ? (
                      <Checkbox
                        checked={isSelected}
                        onChange={() => taskSelection.onToggleTask(node.taskId)}
                        data-testid="plan-stage-task-monitor-task-selection"
                        data-task-id={node.taskId}
                        inputProps={{
                          "aria-label": `Include ${task.label} in execution plan`,
                        }}
                      />
                    ) : null}
                    <Chip label={index + 1} size="small" color="primary" />
                    <Stack spacing={1} sx={{ minWidth: 0, flex: 1 }}>
                      <ButtonBase
                        onClick={() =>
                          previewHost.openPreview(
                            createOpenItemEntity("task", node.taskId),
                          )
                        }
                        aria-label={`Open ${task.label}`}
                        data-testid="plan-stage-task-monitor-task-preview"
                        data-task-id={node.taskId}
                        sx={{ textAlign: "left" }}
                      >
                        <Typography fontWeight={600}>{task.label}</Typography>
                      </ButtonBase>
                      {task.description ? (
                        <Box data-testid="plan-stage-task-monitor-task-description">
                          <MarkdownRenderer
                            mentionMode="minimal"
                            sx={{ fontSize: "0.875rem" }}
                          >
                            {task.description}
                          </MarkdownRenderer>
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          No description provided.
                        </Typography>
                      )}
                    </Stack>
                  </Stack>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: serviceSelection
                        ? {
                            xs: "1fr",
                            sm: "minmax(0, 1fr) minmax(240px, 320px)",
                          }
                        : "1fr",
                      gap: 2,
                      alignItems: "start",
                      mt: 2,
                      ml: { sm: 5.5 },
                    }}
                  >
                    <Stack
                      direction="row"
                      spacing={0.75}
                      useFlexGap
                      flexWrap="wrap"
                      sx={{ minWidth: 0 }}
                    >
                      {dependencyIds.length > 0 ? (
                        dependencyIds.map((taskId) => (
                          <Chip
                            key={taskId}
                            size="small"
                            variant="outlined"
                            label={`Depends on ${
                              tasksById.get(taskId)?.label ?? "unavailable Task"
                            }`}
                          />
                        ))
                      ) : (
                        <Chip
                          size="small"
                          variant="outlined"
                          label="No dependencies"
                        />
                      )}
                    </Stack>
                    {serviceSelection ? (
                      <Box
                        data-testid="plan-stage-task-monitor-task-services"
                        data-task-id={node.taskId}
                        sx={{ justifySelf: "end", width: "100%" }}
                      >
                        <ServiceSelector
                          organizationId={serviceSelection.organizationId}
                          projectId={serviceSelection.projectId}
                          value={task.serviceIds}
                          onChange={(serviceIds) =>
                            serviceSelection.onChange(node.taskId, serviceIds)
                          }
                          label="Services"
                          placeholder="Select one or more services"
                          helperText={
                            !isSelected
                              ? "Task is not selected for this monitor."
                              : task.serviceIds.length === 0
                                ? "Select at least one service before starting."
                                : "Services used to execute this task."
                          }
                          error={isSelected && task.serviceIds.length === 0}
                          disabled={serviceSelection.updatingTaskServiceIds.includes(
                            node.taskId,
                          )}
                          allowEmptySelection={false}
                          multiple
                        />
                      </Box>
                    ) : null}
                  </Box>
                  {launchConfigurationEditing ? (
                    <>
                      <Divider sx={{ my: 2 }} />
                      <Box
                        data-testid="plan-stage-task-monitor-task-launch-configuration"
                        data-task-id={node.taskId}
                      >
                        <Typography
                          variant="subtitle2"
                          color="text.secondary"
                          sx={{ mb: 1.5 }}
                        >
                          Coding session
                        </Typography>
                        <Stack spacing={1.5}>
                          <FormControl size="small" fullWidth>
                            <InputLabel
                              id={`task-monitor-method-${node.taskId}`}
                            >
                              Method
                            </InputLabel>
                            <Select
                              labelId={`task-monitor-method-${node.taskId}`}
                              label="Method"
                              value={node.launchConfiguration.method}
                              onChange={(event) =>
                                launchConfigurationEditing.onChangeMethod(
                                  node.taskId,
                                  event.target.value as TaskMonitorLaunchMethod,
                                )
                              }
                              inputProps={{
                                "data-testid": `plan-stage-task-monitor-method-${node.taskId}`,
                              }}
                            >
                              <MenuItem value="plan">Plan</MenuItem>
                              <MenuItem value="open">Open</MenuItem>
                              <MenuItem value="quick">Quick</MenuItem>
                            </Select>
                          </FormControl>
                          <RuntimeModelSelector
                            catalogSource={
                              launchConfigurationEditing.catalogSource
                            }
                            provider={node.launchConfiguration.provider}
                            model={node.launchConfiguration.model}
                            reasoningEffort={
                              node.launchConfiguration.reasoningEffort
                            }
                            fastMode={
                              node.launchConfiguration.fastMode ?? false
                            }
                            onProviderChange={(provider) =>
                              launchConfigurationEditing.onChangeProvider(
                                node.taskId,
                                provider,
                              )
                            }
                            onModelChange={(model) =>
                              launchConfigurationEditing.onChangeModel(
                                node.taskId,
                                model,
                              )
                            }
                            onReasoningEffortChange={(effort) =>
                              launchConfigurationEditing.onChangeReasoningEffort(
                                node.taskId,
                                effort,
                              )
                            }
                            onFastModeChange={(fastMode) =>
                              launchConfigurationEditing.onChangeFastMode(
                                node.taskId,
                                fastMode,
                              )
                            }
                            testIdPrefix={`plan-stage-task-monitor-runtime-${node.taskId}`}
                          />
                        </Stack>
                      </Box>
                    </>
                  ) : null}
                </Box>
              );
            })}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};
