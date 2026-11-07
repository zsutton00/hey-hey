import { LocalPromptType, type RunEntityReference } from '@hey-hey/contracts/agent-bridge';
import type { LoadedEntityPromptContext } from '../../entity-context/types';

export const changedFileReportingPrompt = `From the start of this turn, keep track of every file you create, modify or delete. Record them as you work rather than reconstructing them at the end. If you changed files, report them with report_changed_files before you finish. List only files you changed in this turn. Do not list files you only read, files another run changed, or files you have already committed. Each changedFiles entry submitted through report_changed_files names the Service ID from the session's Services in scope and the path relative to that Service's repository root. When no files changed, no submission is required. Correct rejected claims in any submitted report until validated. Later edits require another report. Supply the active Turn and provider session identities; context rejection returns the expected values.`;

/** The session facts that decide which completion duties a prompt carries. */
export interface CompletionReconciliationInput {
  /** Prompt types that started a Turn on the Run, per the Run's own record. */
  readonly startedPromptTypes: ReadonlySet<string>;
  /** Whether the session's focal entity is a work item other than a Feature. */
  readonly focalTask: boolean;
}

interface FocalTaskSource {
  /** The session's focal reference; `taskType` names its work-item type when known. */
  readonly entity?: (Pick<RunEntityReference, 'entityType'> & { taskType?: string }) | null;
  readonly loadedEntityContext?: LoadedEntityPromptContext | undefined;
}

/** Whether the session's focal entity is a work item other than a Feature. */
export const hasFocalTask = ({ entity, loadedEntityContext }: FocalTaskSource): boolean => {
  const focalEntity = loadedEntityContext?.focalEntity ?? entity;
  if (focalEntity?.entityType !== 'TASK') {
    return false;
  }

  const loadedEntity = loadedEntityContext?.entity;
  const workItemTypeKey =
    loadedEntity && 'type' in loadedEntity ? loadedEntity.type : entity?.taskType;
  return workItemTypeKey !== 'FEATURE';
};

const FEATURE_SYNC_PROMPT_TYPES: ReadonlySet<string> = new Set([
  LocalPromptType.FeatureSyncAnalyze,
  LocalPromptType.FeatureSyncIterate,
  LocalPromptType.PlanShapingFeatureSyncAnalyze,
  LocalPromptType.PlanShapingFeatureSyncIterate,
]);

/** Whether a Feature Sync handler has started a Turn on the Run, per the Run's own record. */
export const featureSyncRan = (startedPromptTypes: ReadonlySet<string>): boolean =>
  [...startedPromptTypes].some((promptType) => FEATURE_SYNC_PROMPT_TYPES.has(promptType));

const taskReconciliationPrompt = `After satisfying the user's request, judge the completed work against the prepared canonical task context. Use only your own run-attributed changes and implementation evidence; repository-wide changes, including another concurrent run's edits, are not evidence of your work. Discussion, research, proposal-only work, no material file changes, cosmetic edits, formatting, incidental cleanup, and routine fixes preserving documented behavior need no task update.

When an active task exists, propose one reviewable task update for material divergence in scope, observable behavior, or implementation direction, citing concise implementation evidence. Include active-task fulfillment and the applicable completion groups in this judgment. Without an active task, do not invent one or propose a task update. Do not silently mutate entities. This instruction does not authorize additional code edits.`;

// Mockup, Diagram and Contract duties come from session-role guidance for the
// types actually in context, and the tool's description says how to raise a
// concern. Only the Run's own Feature Sync history is a session fact.
const featureSyncRanInstruction = `Feature Sync ran in this session: do not call \`suggest_feature_verification\` for anything Feature Sync already updated; call it only where the code differs from what the feature, Diagram or Mockup says should exist, or where the user changed direction after the plan.`;

const replyGuidance = `Reply to the user in ordinary prose and Markdown. Keep required reports and proposals separate from this final response.`;

const joinCompletionSections = (sections: ReadonlyArray<string | null>): string =>
  ['## Completion reconciliation', ...sections, replyGuidance]
    .filter((section): section is string => section !== null)
    .join('\n\n');

/**
 * The completion instruction for a session. Every session reports its changed
 * files; the task judgment needs a focal task.
 */
export const buildCompletionReconciliationPromptFor = ({
  startedPromptTypes,
  focalTask,
}: CompletionReconciliationInput): string =>
  joinCompletionSections([
    changedFileReportingPrompt,
    focalTask ? taskReconciliationPrompt : null,
    featureSyncRan(startedPromptTypes) ? featureSyncRanInstruction : null,
  ]);

/** For the mode that investigates a raised concern: it never raises another. */
export const verifyFeatureCompletionPrompt = joinCompletionSections([
  changedFileReportingPrompt,
  taskReconciliationPrompt,
]);
