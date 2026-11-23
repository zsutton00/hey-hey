import {
  Alert,
  alpha,
  Box,
  ButtonBase,
  Stack,
  Typography,
} from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useState } from "react";
import type { TaskMonitorExecutionNodeLaunchConfiguration } from "../../api";
import {
  useServices,
  type UseServicesReturn,
} from "../../data/hooks/useServices";
import { PROVIDER_LABELS } from "../../utils/providerLabels";
import { listModels } from "../AgentSession/capabilityCatalog";
import { EFFORT_LABELS } from "../AgentSession/ModelSelector";
import { ServiceSelector } from "../Selectors/ServiceSelector";
import { TaskMonitorLaunchConfigurationEditor } from "./TaskMonitorLaunchConfigurationEditor";
import { LAUNCH_METHOD_LABELS } from "./TaskMonitorLaunchMethodOptions";
import {
  needsServiceBeforeStart,
  taskServiceIds,
  type TaskMonitorTaskServicesControl,
} from "./taskMonitorStartReadiness";
import type { TaskMonitorProjectedNode } from "./useTaskMonitorProjection";

/** What every task card needs to show and change its own session setup. */
export interface TaskMonitorTaskSetupContext {
  organizationId: string;
  machineId: string | null;
  monitorKindKey: string;
  /** False once the monitor has finished, since nothing further runs. */
  editable: boolean;
  isSavingLaunchConfiguration: boolean;
  onSaveLaunchConfiguration: (
    taskId: string,
    configuration: TaskMonitorExecutionNodeLaunchConfiguration,
  ) => Promise<void>;
  services: TaskMonitorTaskServicesControl;
}

const serviceSummary = (
  serviceIds: readonly string[],
  serviceList: Pick<UseServicesReturn, "services" | "isFetched" | "error">,
): string => {
  if (serviceIds.length === 0) {
    return "No Service";
  }
  if (serviceList.error) {
    return "Services could not be loaded";
  }
  if (!serviceList.isFetched) {
    return "Loading Services…";
  }

  return serviceIds
    .map(
      (serviceId) =>
        serviceList.services.find((service) => service.id === serviceId)
          ?.name ?? "Unavailable service",
    )
    .join(", ");
};

const launchSummary = (
  configuration: TaskMonitorExecutionNodeLaunchConfiguration,
): string[] => {
  const modelLabel =
    listModels(configuration.provider).find(
      (model) => model.id === configuration.model,
    )?.label ?? configuration.model;

  return [
    PROVIDER_LABELS[configuration.provider],
    modelLabel,
    EFFORT_LABELS[configuration.reasoningEffort],
    LAUNCH_METHOD_LABELS[configuration.method],
    ...(configuration.fastMode ? ["Fast mode"] : []),
  ];
};

/**
 * One task's session setup on its card: a summary starting with its Service,
 * an inline editor until its session exists, and a Service picker right on the
 * card when an unstarted task has no Service of its own.
 */
export function TaskMonitorTaskSetup({
  node,
  projectId,
  setup,
  onOpenSession,
}: {
  node: TaskMonitorProjectedNode;
  projectId: string;
  setup: TaskMonitorTaskSetupContext;
  onOpenSession: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const serviceList = useServices(setup.organizationId, {
    projectId,
    enabled: Boolean(setup.organizationId && projectId),
  });
  const serviceIds = taskServiceIds(node);
  const updating = setup.services.updatingTaskIds.includes(node.taskId);
  const serviceError = setup.services.errorsByTaskId[node.taskId] ?? null;
  const editable = setup.editable && node.session.kind === "none";
  const showsEditor = editable && editing;
  const needsService = setup.editable && needsServiceBeforeStart(node);
  const summary = [
    serviceSummary(serviceIds, serviceList),
    ...launchSummary(node.launchConfiguration),
  ].join(" · ");

  const serviceSelector = (
    <ServiceSelector
      organizationId={setup.organizationId}
      projectId={projectId}
      value={serviceIds}
      onChange={(nextServiceIds) =>
        setup.services.onChange(node.taskId, nextServiceIds)
      }
      label="Service"
      placeholder="Choose a Service"
      disabled={updating}
      allowEmptySelection={false}
      multiple
    />
  );

  return (
    <Stack spacing={1} data-testid="task-monitor-task-setup">
      {needsService ? (
        <Box
          role="alert"
          data-testid="task-monitor-task-missing-service"
          data-task-id={node.taskId}
          sx={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 1.25,
            px: 1.25,
            py: 0.75,
            border: 1,
            borderColor: "warning.light",
            borderRadius: 1,
            bgcolor: (theme) => alpha(theme.palette.warning.main, 0.08),
          }}
        >
          <Typography
            variant="body2"
            fontWeight={600}
            sx={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              color: (theme) =>
                theme.palette.mode === "dark"
                  ? theme.palette.warning.light
                  : theme.palette.warning.dark,
            }}
          >
            <WarningAmberIcon fontSize="small" aria-hidden />
            {updating ? "Saving…" : "Needs a Service before Start"}
          </Typography>
          {showsEditor ? null : (
            <Box
              sx={{ minWidth: 200, flex: 1 }}
              data-testid="task-monitor-task-service-picker"
            >
              {serviceSelector}
            </Box>
          )}
        </Box>
      ) : null}
      {serviceError ? (
        <Alert severity="error" data-testid="task-monitor-task-service-error">
          {serviceError}
        </Alert>
      ) : null}
      {editable || node.session.kind !== "none" ? (
        <ButtonBase
          data-testid="task-monitor-task-setup-summary"
          aria-expanded={editable ? showsEditor : undefined}
          onClick={editable ? () => setEditing(!editing) : onOpenSession}
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 1,
            px: 1.25,
            py: 0.75,
            border: 1,
            borderStyle: "dashed",
            borderColor: "divider",
            borderRadius: 1,
            bgcolor: "action.hover",
            textAlign: "left",
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {summary}
          </Typography>
          <Typography
            component="span"
            variant="caption"
            color="primary"
            fontWeight={600}
            sx={{ flexShrink: 0 }}
          >
            {editable ? (showsEditor ? "Close" : "Edit") : "View session"}
          </Typography>
        </ButtonBase>
      ) : (
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="task-monitor-task-setup-summary"
        >
          {summary}
        </Typography>
      )}
      {showsEditor ? (
        <Stack spacing={1.5} data-testid="task-monitor-task-setup-editor">
          <Box data-testid="task-monitor-task-setup-service">
            {serviceSelector}
          </Box>
          <TaskMonitorLaunchConfigurationEditor
            organizationId={setup.organizationId}
            projectId={projectId}
            machineId={setup.machineId}
            monitorKindKey={setup.monitorKindKey}
            node={node}
            isSavingLaunchConfiguration={setup.isSavingLaunchConfiguration}
            onSaveLaunchConfiguration={setup.onSaveLaunchConfiguration}
          />
        </Stack>
      ) : null}
    </Stack>
  );
}
