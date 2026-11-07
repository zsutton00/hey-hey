import { LocalPromptType, type RunEntityReference } from '@hey-hey/contracts/agent-bridge';
import type { LoadedEntityPromptContext } from '../../entity-context/types';

export const changedFileReportingPrompt = `From the start of this turn, keep track of every file you create, modify or delete. Record them as you work rather than reconstructing them at the end. If you changed files, report them with report_changed_files before you finish. List only files you changed in this turn. Do not list files you only read, files another run changed, or files you have already committed. Each changedFiles entry submitted through report_changed_files names the Service ID from the session's Services in scope and the path relative to that Service's repository root. When no files changed, no submission is required. Correct rejected claims in any submitted report until validated. Later edits require another report. Supply the active Turn and provider session identities; context rejection returns the expected values.`;

/**
 * What a session's changes are judged against at completion, read from its
 * focal entity: a work item other than a Feature (`task`), a Feature
 * (`feature`), or nothing to judge against (`null`, e.g. a Project focus).
 */
export type CompletionSubject = 'task' | 'feature' | null;

/** The session facts that decide which completion duties a prompt carries. */
export interface CompletionReconciliationInput {
  /** Prompt types that started a Turn on the Run, per the Run's own record. */
  readonly startedPromptTypes: ReadonlySet<string>;
  readonly subject: CompletionSubject;
}

interface CompletionSubjectSource {
  /** The session's focal reference; `taskType` names its work-item type when known. */
  readonly entity?: (Pick<RunEntityReference, 'entityType'> & { taskType?: string }) | null;
  readonly loadedEntityContext?: LoadedEntityPromptContext | undefined;
}

/** Reads the completion subject from the session's focal entity. */
export const completionSubjectFor = ({
  entity,
  loadedEntityContext,
}: CompletionSubjectSource): CompletionSubject => {
  const focalEntity = loadedEntityContext?.focalEntity ?? entity;
  if (focalEntity?.entityType !== 'TASK') {
    return null;
  }

  const loadedEntity = loadedEntityContext?.entity;
  const workItemTypeKey =
    loadedEntity && 'type' in loadedEntity ? loadedEntity.type : entity?.taskType;
  return workItemTypeKey === 'FEATURE' ? 'feature' : 'task';
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

const featureSyncRanInstruction = `Feature Sync ran in this session: raise a concern only where the code differs from what the feature, Diagram or Mockup says should exist, or where the user changed direction after the plan; never for anything Feature Sync already updated.`;

const buildFeatureSyncDidNotRunInstruction = (
  subject: 'task' | 'feature',
  projectAssistantRan: boolean,
): string => {
  const held = projectAssistantRan
    ? `the Project Assistant context and the ${subject}'s Diagram and Mockup`
    : `the ${subject}'s Diagram and Mockup`;
  const noted = projectAssistantRan ? ' or Project Assistant already noted issues' : '';
  return `Feature Sync did not run in this session. You hold ${held}: raise a concern whenever the code diverges from them${noted}.`;
};

const buildFeatureVerificationPrompt = (
  subject: 'task' | 'feature',
  startedPromptTypes: ReadonlySet<string>,
): string => {
  const featureSyncInstruction = featureSyncRan(startedPromptTypes)
    ? featureSyncRanInstruction
    : buildFeatureSyncDidNotRunInstruction(
        subject,
        startedPromptTypes.has(LocalPromptType.ProjectAssistant),
      );

  return `When material changes diverge from the feature, Diagram or Mockup in the active context, or change what a governing Mockup or Diagram (one that actively guides what this ${subject} delivers) shows or models, call \`suggest_feature_verification\` with that one feature and the specific discrepancy you observed: what the code does versus what the artifact says. Name the artifact and the specific change that needs review, and list each governing artifact in \`impactedEntities\` with its entity type and ID; a Mockup or Diagram included only as background, history or exploration does not trigger the call. It opens a fresh Verify Feature session on that text, so a vague concern is wasted. Raise a concern once, when you first see it; if your session history shows you already suggested it, do not suggest it again. ${featureSyncInstruction} A reply never waits on this call.`;
};

const replyGuidance = `Reply to the user in ordinary prose and Markdown. Keep required reports and proposals separate from this final response.`;

const joinCompletionSections = (sections: ReadonlyArray<string | null>): string =>
  ['## Completion reconciliation', ...sections, replyGuidance]
    .filter((section): section is string => section !== null)
    .join('\n\n');

/**
 * The completion instruction for a session. Every session reports its changed
 * files; the task judgment needs a focal task, and the feature-verification
 * suggestion needs a focal task or Feature to compare the code against.
 */
export const buildCompletionReconciliationPromptFor = ({
  startedPromptTypes,
  subject,
}: CompletionReconciliationInput): string =>
  joinCompletionSections([
    changedFileReportingPrompt,
    subject === 'task' ? taskReconciliationPrompt : null,
    subject ? buildFeatureVerificationPrompt(subject, startedPromptTypes) : null,
  ]);

/** For the mode that investigates a raised concern: it never raises another. */
export const verifyFeatureCompletionPrompt = joinCompletionSections([
  changedFileReportingPrompt,
  taskReconciliationPrompt,
]);
