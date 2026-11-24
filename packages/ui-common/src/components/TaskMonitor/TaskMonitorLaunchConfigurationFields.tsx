import { FormControl, InputLabel, Select, Stack } from "@mui/material";
import type {
  TaskMonitorExecutionNodeLaunchConfiguration,
  TaskMonitorLaunchMethod,
} from "../../api";
import { RuntimeModelSelector } from "../AgentSession/RuntimeModelSelector";
import type { RuntimeModelCatalogSource } from "../AgentSession/useRuntimeModelCatalog";
import { taskMonitorLaunchMethodOptions } from "./TaskMonitorLaunchMethodOptions";

function isLaunchMethod(value: string): value is TaskMonitorLaunchMethod {
  return value === "plan" || value === "open" || value === "quick";
}

export type TaskMonitorLaunchConfigurationPatch =
  Partial<TaskMonitorExecutionNodeLaunchConfiguration>;

/**
 * Method, Provider, Favorite, Model, Effort and Fast mode for one task launch.
 * Controlled and render-only: every change, including the model catalog
 * reshaping the shown values, is reported as a patch and nothing is saved here.
 */
export function TaskMonitorLaunchConfigurationFields({
  idPrefix,
  testIdPrefix,
  value,
  allowedLaunchMethods,
  catalogSource,
  disabled,
  onChange,
}: {
  idPrefix: string;
  testIdPrefix: string;
  value: TaskMonitorExecutionNodeLaunchConfiguration;
  allowedLaunchMethods: readonly TaskMonitorLaunchMethod[];
  catalogSource: RuntimeModelCatalogSource | null;
  disabled: boolean;
  onChange: (patch: TaskMonitorLaunchConfigurationPatch) => void;
}) {
  const methodLabelId = `${idPrefix}-method`;

  return (
    <Stack spacing={1.5}>
      <FormControl size="small" fullWidth disabled={disabled}>
        <InputLabel id={methodLabelId}>Method</InputLabel>
        <Select
          labelId={methodLabelId}
          label="Method"
          value={value.method}
          onChange={(event) => {
            const method = event.target.value;
            if (isLaunchMethod(method)) {
              onChange({ method });
            }
          }}
        >
          {taskMonitorLaunchMethodOptions(allowedLaunchMethods, value.method)}
        </Select>
      </FormControl>
      <RuntimeModelSelector
        catalogSource={catalogSource}
        provider={value.provider}
        model={value.model}
        reasoningEffort={value.reasoningEffort}
        fastMode={value.fastMode ?? false}
        onProviderChange={(provider) => onChange({ provider })}
        onModelChange={(model) => onChange({ model })}
        onReasoningEffortChange={(reasoningEffort) => {
          if (!reasoningEffort) {
            return;
          }
          onChange({ reasoningEffort });
        }}
        onFastModeChange={(fastMode) => onChange({ fastMode })}
        disabled={disabled}
        testIdPrefix={testIdPrefix}
      />
    </Stack>
  );
}
