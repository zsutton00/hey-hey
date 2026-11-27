import { Alert, Box, Button } from "@mui/material";
import { useState } from "react";
import type {
  ApplyTaskMonitorUnstartedLaunchConfigurationResponseDto,
  TaskMonitorExecutionNodeLaunchConfiguration,
  TaskMonitorLaunchMethod,
} from "../../api";
import type { RuntimeModelCatalogSource } from "../AgentSession/useRuntimeModelCatalog";
import { useRuntimeModelCatalog } from "../AgentSession/useRuntimeModelCatalog";
import { getErrorMessage } from "../../utils/errorUtils";
import logger from "../../utils/logger";
import { TaskMonitorLaunchConfigurationFields } from "./TaskMonitorLaunchConfigurationFields";
import { launchConfigurationCatalogIssue } from "./taskMonitorLaunchCatalog";
import { TaskMonitorSettingsSection } from "./TaskMonitorPreStartSettings";
import { normalizeFastMode } from "./taskMonitorRuntimeSelection";

const tasksLabel = (count: number): string =>
  count === 1 ? "1 task" : `${count} tasks`;

const resultMessage = (
  result: ApplyTaskMonitorUnstartedLaunchConfigurationResponseDto,
): string => {
  const updated = result.updatedTaskIds.length;
  const skipped = result.skippedTaskIds.length;
  const skippedVerb = skipped === 1 ? "was" : "were";
  return `Updated ${tasksLabel(updated)}. ${tasksLabel(skipped)} already had a session and ${skippedVerb} left unchanged.`;
};

/**
 * One session setup chosen once and written to every task that has no Agent
 * Session yet. The choice is a local draft: nothing is saved until the user
 * presses Apply, so the catalog reshaping the shown values never writes.
 */
export function TaskMonitorApplyToUnstartedTasks({
  seed,
  unstartedTaskCount,
  allowedLaunchMethods,
  catalogSource,
  onApply,
}: {
  /** The starting draft, taken from a task that has not started. */
  seed: TaskMonitorExecutionNodeLaunchConfiguration;
  unstartedTaskCount: number;
  allowedLaunchMethods: readonly TaskMonitorLaunchMethod[];
  catalogSource: RuntimeModelCatalogSource | null;
  onApply: (
    configuration: TaskMonitorExecutionNodeLaunchConfiguration,
  ) => Promise<ApplyTaskMonitorUnstartedLaunchConfigurationResponseDto>;
}) {
  const catalog = useRuntimeModelCatalog(catalogSource);
  const [draft, setDraft] = useState(seed);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const catalogReady = catalog.status === "ready";

  const apply = async (): Promise<void> => {
    setError(null);
    setOutcome(null);
    const configuration = normalizeFastMode(draft);
    // Normalizing drops a Fast mode the model doesn't offer. The user chose
    // "on", so say so instead of silently sending a setup without it.
    const droppedFastMode =
      draft.fastMode === true && configuration.fastMode === undefined;
    const issue = droppedFastMode
      ? "The chosen session setup Fast mode choice is not supported for the selected provider and model."
      : launchConfigurationCatalogIssue(
          configuration,
          "The chosen session setup",
        );
    if (issue) {
      logger.warn("data_hooks", "Default model apply rejected", {
        code: "TASK_MONITOR_DEFAULT_MODEL_UNSUPPORTED",
        cause: issue,
      });
      setError(issue);
      return;
    }

    setIsApplying(true);
    try {
      const result = await onApply(configuration);
      setOutcome(resultMessage(result));
    } catch (applyError) {
      const message = getErrorMessage(
        applyError,
        "The session setup could not be applied. No task was changed.",
      );
      logger.warn("data_hooks", "Default model apply failed", {
        code: "TASK_MONITOR_DEFAULT_MODEL_APPLY_FAILED",
        cause: message,
      });
      setError(message);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Box sx={{ pb: 0.5 }}>
      <TaskMonitorSettingsSection
        title="Default model"
        explanation="Applies to tasks that haven't started."
        testId="task-monitor-apply-unstarted"
      >
        <TaskMonitorLaunchConfigurationFields
          idPrefix="task-monitor-apply-unstarted"
          testIdPrefix="task-monitor-apply-unstarted-runtime"
          value={draft}
          allowedLaunchMethods={allowedLaunchMethods}
          catalogSource={catalogSource}
          disabled={isApplying}
          onChange={(patch) => {
            setDraft((current) => ({ ...current, ...patch }));
            setOutcome(null);
          }}
        />
        <Button
          variant="contained"
          size="small"
          sx={{ alignSelf: "flex-end" }}
          data-testid="task-monitor-apply-unstarted-submit"
          disabled={!catalogReady || isApplying}
          onClick={() => void apply()}
        >
          Apply to {tasksLabel(unstartedTaskCount)}
        </Button>
        {error ? (
          <Alert
            severity="error"
            data-testid="task-monitor-apply-unstarted-error"
          >
            {error}
          </Alert>
        ) : null}
        {outcome ? (
          <Alert
            severity="success"
            data-testid="task-monitor-apply-unstarted-result"
          >
            {outcome}
          </Alert>
        ) : null}
      </TaskMonitorSettingsSection>
    </Box>
  );
}
