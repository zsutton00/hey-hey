import { buildEntityConversationPrompt } from "../InteractionComponent/entityConversationPrompt";

const PLAN_COMPLETION_REVIEW_PROMPT =
  "The plan ‘{plan title}’ has been completed. Review its design document and the resulting implementation, then identify any project features, requirements, decisions, contracts, or other project information that should be updated.";

export const buildPlanCompletionReviewPrompt = (
  planTitle: string,
  guidance = ""
): string => {
  const prompt = PLAN_COMPLETION_REVIEW_PROMPT.replace(
    "{plan title}",
    planTitle
  );
  return buildEntityConversationPrompt(prompt, guidance);
};
