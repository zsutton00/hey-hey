import type { AgentSessionConfig } from '../../shared/agent-bridge-contract/generated/api';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import {
  resolvePromptText,
  type InternalRunPromptRequest,
} from '../../shared/agent-bridge-contract/contract';
import { hasCapturedProjectModeConfig } from './project-mode-snapshot';

/** Ordinary replies belong to the captured mode, including after Run restoration. */
export function resolveProjectModeFollowup(
  config: AgentSessionConfig | null | undefined,
  input: InternalRunPromptRequest,
): InternalRunPromptRequest {
  if (
    input.promptType !== LocalPromptType.CodingFreeform ||
    !hasCapturedProjectModeConfig(config)
  ) {
    return input;
  }

  const userMessage = resolvePromptText(input);
  return {
    ...input,
    promptType: LocalPromptType.ProjectMode,
    payload: {
      promptType: LocalPromptType.ProjectMode,
      ...(userMessage !== null ? { userMessage } : {}),
    },
  };
}
