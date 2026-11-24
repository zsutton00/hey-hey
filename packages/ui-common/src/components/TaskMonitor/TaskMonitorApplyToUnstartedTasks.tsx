import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import { useState } from "react";
import type {
  ApplyTaskMonitorUnstartedLaunchConfigurationResponseDto,
  TaskMonitorExecutionNodeLaunchConfiguration,
  TaskMonitorLaunchMethod,
} from "../../api";
import type { RuntimeModelCatalogSource } from "../AgentSession/useRuntimeModelCatalog";
import { useRuntimeModelCatalog } from "../AgentSession/useRuntimeModelCatalog";
import { getErrorMessage } from "../../utils/errorUtils";
import { TaskMonitorLaunchConfigurationFields } from "./TaskMonitorLaunchConfigurationFields";
import { launchConfigurationCatalogIssue } from "./taskMonitorLaunchCatalog";
import { normalizeFastMode } from "./taskMonitorRuntimeSelection";

const tasksLabel = (count: number): string =>
  count === 1 ? "1 task" : `${count} tasks`;

const resultMessage = (
  result: ApplyTaskMonitorUnstartedLaunchConfigurationResponseDto,
): string => {
  const updated = `Updated ${tasksLabel(result.updatedTaskIds.length)}.`;
  if (result.skippedTaskIds.length === 0) {
    return updated;
  }
  return `${updated} ${tasksLabel(result.skippedTaskIds.length)} already had a session and ${result.skippedTaskIds.length === 1 ? "was" : "were"} left unchanged.`;
};

/**
 * One session setup chosen once and written to every task that has no Agent
 * Session yet. The choice is a local draft: nothing is saved until the user
 * confirms Apply, so the catalog reshaping the shown values never writes.
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
  const [confirming, setConfirming] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const catalogReady = catalog.status === "ready";

  const apply = async (): Promise<void> => {
    const configuration = normalizeFastMode(draft);
    // Normalizing drops a Fast mode the model doesn't offer. The user confirmed
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
      setError(issue);
      setConfirming(false);
      return;
    }

    setIsApplying(true);
    setError(null);
    try {
      const result = await onApply(configuration);
      setOutcome(resultMessage(result));
    } catch (applyError) {
      setError(
        getErrorMessage(
          applyError,
          "The session setup could not be applied. No task was changed.",
        ),
      );
    } finally {
      setIsApplying(false);
      setConfirming(false);
    }
  };

  return (
    <Stack
      spacing={1.5}
      sx={{ px: 2, py: 1.5 }}
      data-testid="task-monitor-apply-unstarted"
    >
      <Box>
        <Typography variant="subtitle2">
          Apply to tasks that haven&apos;t started
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Choose one session setup for every task whose session hasn&apos;t
          started yet.
        </Typography>
      </Box>
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
      {confirming ? (
        <Alert
          severity="warning"
          data-testid="task-monitor-apply-unstarted-confirm"
          action={
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                data-testid="task-monitor-apply-unstarted-cancel"
                disabled={isApplying}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button
                size="small"
                variant="contained"
                data-testid="task-monitor-apply-unstarted-submit"
                disabled={!catalogReady || isApplying}
                onClick={() => void apply()}
              >
                Apply
              </Button>
            </Stack>
          }
        >
          Replace session settings on {tasksLabel(unstartedTaskCount)} that
          haven&apos;t started. Settings chosen on those tasks are overwritten.
        </Alert>
      ) : (
        <Box>
          <Button
            variant="outlined"
            size="small"
            data-testid="task-monitor-apply-unstarted-open"
            disabled={!catalogReady || isApplying}
            onClick={() => {
              setError(null);
              setOutcome(null);
              setConfirming(true);
            }}
          >
            Apply…
          </Button>
        </Box>
      )}
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
    </Stack>
  );
}
