import type { LocalRunPromptRequest } from '../../shared/agent-bridge-contract/contract';
import { LocalPromptType, type AgentSkillSelection } from '@hey-hey/contracts/agent-bridge';
import type { LocalCodeReviewPromptPayload } from '../../shared/agent-bridge-contract/runtime-types';

export const buildCodeReviewRequest = (
  userMessage?: string,
  skillSelection?: AgentSkillSelection,
): LocalRunPromptRequest => {
  const payload: LocalCodeReviewPromptPayload = {
    ...(userMessage !== undefined ? { userMessage } : {}),
  };
  return {
    promptType: LocalPromptType.CodeReview,
    payload,
    references: { resolved: [], unresolved: [] },
    ...(skillSelection ? { skillSelection } : {}),
  };
};
