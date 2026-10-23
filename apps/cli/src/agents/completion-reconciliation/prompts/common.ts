import { LocalPromptType } from '../../../shared/agent-bridge-contract/generated/api';

export const changedFileReportingPrompt = `From the start of this turn, keep track of every file you create, modify or delete. Before completion call report_changed_files and correct rejected claims until validated, so record them as you work rather than reconstructing them at the end. List only files you changed in this turn. Do not list files you only read, files another run changed, or files you have already committed. Each entry names the Service ID from the session's Services in scope and the path relative to that Service's repository root. Discussion, research and proposal-only turns submit changedFiles: [] through the tool. Later edits require another report. Supply the active Turn and provider session identities; context rejection returns the expected values.`;

const buildCompletionReconciliationPrompt = (
  suggestion: string,
): string => `## Completion reconciliation

${changedFileReportingPrompt}

After satisfying the user's request, judge the completed work against the prepared canonical task context. Use only your own run-attributed changes and implementation evidence; repository-wide changes, including another concurrent run's edits, are not evidence of your work. Discussion, research, proposal-only work, no material file changes, cosmetic edits, formatting, incidental cleanup, and routine fixes preserving documented behavior need no task update.

When an active task exists, propose one reviewable task update for material divergence in scope, observable behavior, or implementation direction, citing concise implementation evidence. Include active-task fulfillment and the applicable completion groups in this judgment. Without an active task, do not invent one or propose a task update. Do not silently mutate entities. This instruction does not authorize additional code edits.${suggestion}

Reply to the user in ordinary prose and Markdown. Keep required reports and proposals separate from this final response.`;

const FEATURE_SYNC_PROMPT_TYPES: ReadonlySet<string> = new Set([
  LocalPromptType.FeatureSyncAnalyze,
  LocalPromptType.FeatureSyncIterate,
  LocalPromptType.PlanShapingFeatureSyncAnalyze,
  LocalPromptType.PlanShapingFeatureSyncIterate,
]);

/** Whether a Feature Sync handler has started a Turn on the Run, per the Run's own record. */
export const featureSyncRan = (startedPromptTypes: ReadonlySet<string>): boolean =>
  [...startedPromptTypes].some((promptType) => FEATURE_SYNC_PROMPT_TYPES.has(promptType));

const featureSyncRanInstruction = `Feature Sync ran in this session: raise a concern only where the code differs from what the feature, Diagram or Mockup says should exist, or where the user changed direction after the plan; never for anything Feature Sync already updated.`;

const featureSyncDidNotRunInstruction = `Feature Sync did not run in this session. You hold the Project Assistant context and the task's Diagram and Mockup: raise a concern whenever the code diverges from them or Project Assistant already noted issues.`;

const buildFeatureVerificationSuggestionPrompt = (
  startedPromptTypes: ReadonlySet<string>,
): string => `

When material changes diverge from the feature, Diagram or Mockup in the active context, call \`suggest_feature_verification\` with that one feature and the specific discrepancy you observed: what the code does versus what the artifact says. It opens a fresh Verify Feature session on that text, so a vague concern is wasted. Raise a concern once, when you first see it; if your session history shows you already suggested it, do not suggest it again. ${featureSyncRan(startedPromptTypes) ? featureSyncRanInstruction : featureSyncDidNotRunInstruction} A reply never waits on this call.`;

/** The completion instruction for a Turn whose Run has started the given handlers. */
export const buildCompletionReconciliationPromptFor = (
  startedPromptTypes: ReadonlySet<string>,
): string =>
  buildCompletionReconciliationPrompt(buildFeatureVerificationSuggestionPrompt(startedPromptTypes));

/** For the mode that investigates a raised concern: it never raises another. */
export const verifyFeatureCompletionPrompt = buildCompletionReconciliationPrompt('');
