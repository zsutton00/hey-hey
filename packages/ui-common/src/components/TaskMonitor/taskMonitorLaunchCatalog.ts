import type { TaskMonitorExecutionNodeLaunchConfiguration } from "../../api";
import {
  listEfforts,
  listModels,
  supportsFastMode,
} from "../AgentSession/capabilityCatalog";

/**
 * Why a task's launch configuration is not a combination the active machine's
 * ready catalog offers, or null when it is. `subject` names whose choice it is,
 * for example "The saved Task Monitor".
 */
export const launchConfigurationCatalogIssue = (
  configuration: TaskMonitorExecutionNodeLaunchConfiguration,
  subject: string,
): string | null => {
  if (
    !listModels(configuration.provider).some(
      (model) => model.id === configuration.model,
    )
  ) {
    return `${subject} provider and model are not available in the runtime catalog.`;
  }

  const efforts = listEfforts(configuration.provider, configuration.model);
  if (!efforts.includes(configuration.reasoningEffort)) {
    return `${subject} reasoning effort is not available for the selected provider and model.`;
  }

  const fastModeSupported = supportsFastMode(
    configuration.provider,
    configuration.model,
  );
  if (fastModeSupported && typeof configuration.fastMode !== "boolean") {
    return `${subject} Fast mode choice is missing for the selected provider and model.`;
  }
  if (!fastModeSupported && configuration.fastMode !== undefined) {
    return `${subject} Fast mode choice is not supported for the selected provider and model.`;
  }

  return null;
};
