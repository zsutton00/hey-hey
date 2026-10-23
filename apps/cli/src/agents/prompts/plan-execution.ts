import {
  renderStartupPlanMarkdown,
  renderStartupPlanReviewMarkdown,
  type StartupPlanRenderable,
  type StartupPlanQuestionAnswerEntry,
  type StartupPlanDiscrepancyDispositionEntry,
} from '@hey-hey/ui-common/agents';
import type { LocalPlanExecutionPromptPayload } from '../../shared/agent-bridge-contract/index';
import { parseStartupSessionPlanResponse } from '../response-schemas';

const toQuestionAnswers = (
  review: LocalPlanExecutionPromptPayload['review'],
): StartupPlanQuestionAnswerEntry[] =>
  review.questionAnswers.map((qa) => ({
    question: qa.question,
    answer: qa.answer,
  }));

const toDispositions = (
  review: LocalPlanExecutionPromptPayload['review'],
): StartupPlanDiscrepancyDispositionEntry[] =>
  review.discrepancyDispositions.map((d) => ({
    discrepancyIndex: d.discrepancyIndex,
    disposition: d.disposition,
    ...(d.note ? { note: d.note } : {}),
  }));

export const buildPlanExecutionPrompt = (payload: LocalPlanExecutionPromptPayload): string => {
  const parsedPlan = parseStartupSessionPlanResponse(payload.plan);
  if (!parsedPlan.ok) {
    throw new Error(`Invalid approved startup plan: ${parsedPlan.error}`);
  }
  const plan: StartupPlanRenderable = parsedPlan.value;
  const review = renderStartupPlanReviewMarkdown({
    plan,
    feedback: {
      generalFeedback: payload.feedback ?? null,
      questionAnswers: toQuestionAnswers(payload.review),
      discrepancyDispositions: toDispositions(payload.review),
    },
  });

  return `You are starting a coding agent session with a pre-approved execution plan.

The user has reviewed and approved this plan. Your task is to execute the steps exactly as described — do not re-plan or produce a new startup plan. Begin executing immediately.

${renderStartupPlanMarkdown(plan, { sessionTitlePrefix: 'Approved Session: ' })}

## User Review

${review ?? '(no additional review notes)'}

---

Proceed with executing the plan above. Work through each step in order, using your tools to make the necessary code changes. Report progress as you go.`;
};
