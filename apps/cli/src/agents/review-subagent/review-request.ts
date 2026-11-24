import type { LocalRunPromptRequest } from '../../shared/agent-bridge-contract/contract';
import {
  LocalPromptType,
  type AgentSkillSelection,
  type ImplementRuntimeSelection,
} from '@hey-hey/contracts/agent-bridge';
import type { LocalCodeReviewPromptPayload } from '../../shared/agent-bridge-contract/runtime-types';

export const buildCodeReviewRequest = (
  userMessage?: string,
  skillSelection?: AgentSkillSelection,
  runtime?: ImplementRuntimeSelection,
): LocalRunPromptRequest => {
  const payload: LocalCodeReviewPromptPayload = {
    ...(userMessage !== undefined ? { userMessage } : {}),
  };
  return {
    promptType: LocalPromptType.CodeReview,
    payload,
    references: { resolved: [], unresolved: [] },
    ...(skillSelection ? { skillSelection } : {}),
    // Applies to this Review Turn only; the Run's stored runtime is unchanged.
    ...(runtime ? { turnRuntime: runtime } : {}),
  };
};
