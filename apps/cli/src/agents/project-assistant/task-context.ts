import {
  LocalPromptTaskType,
  type LocalPromptTaskType as LocalPromptTaskTypeValue,
} from '../../shared/agent-bridge-contract/generated/api';
import type { RunEntityReference } from '../../shared/agent-bridge-contract/index';
import type { ProjectAssistantPolicy } from '../prompt-type-handler';
import {
  resolveProjectAssistantChildChecks,
  type ProjectAssistantChildChecks,
} from '../prompts/project-assistant';

export const resolveProjectAssistantTaskType = (
  taskType: string | undefined,
): LocalPromptTaskTypeValue => {
  switch (taskType) {
    case LocalPromptTaskType.Bug:
      return LocalPromptTaskType.Bug;
    case LocalPromptTaskType.Feature:
      return LocalPromptTaskType.Feature;
    case LocalPromptTaskType.Goal:
      return LocalPromptTaskType.Goal;
    default:
      return LocalPromptTaskType.Standard;
  }
};

/**
 * The one resolution of a Run's research-child checks. The handler's prompt
 * and `run_subagents` both read the focal task type through
 * `resolveProjectAssistantTaskType`, so the children's gates match the parent's.
 */
export const resolveProjectAssistantChecksForRun = (
  policy: ProjectAssistantPolicy,
  focalEntity: RunEntityReference | null,
  workItemType: string | undefined,
): ProjectAssistantChildChecks =>
  resolveProjectAssistantChildChecks(
    policy,
    focalEntity,
    resolveProjectAssistantTaskType(workItemType),
  );
