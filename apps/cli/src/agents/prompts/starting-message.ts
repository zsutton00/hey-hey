import type {
  LocalChildTaskUpdatesPromptPayload,
  LocalCodeReviewPromptPayload,
  LocalFinalAssessmentPromptPayload,
  LocalFreeFormPromptPayload,
  LocalSetSplittingPromptPayload,
  LocalStartupSessionPromptPayload,
  LocalVerificationPlanPromptPayload,
} from '../../shared/agent-bridge-contract/index';
import type { PromptTypeHandlerContext } from '../prompt-type-handler';

/**
 * Local "any in-memory handler payload" union — payload field of
 * `LocalRunPromptRequest` is narrowed wire-side to follow-up-only variants,
 * but this utility runs on the broader in-memory Run/Turn payload.
 */
type AnyStartingMessagePayload =
  | LocalStartupSessionPromptPayload
  | LocalFinalAssessmentPromptPayload
  | LocalVerificationPlanPromptPayload
  | LocalChildTaskUpdatesPromptPayload
  | LocalSetSplittingPromptPayload
  | LocalFreeFormPromptPayload
  | LocalCodeReviewPromptPayload;

const taskTitle = (ctx?: PromptTypeHandlerContext): string | undefined => {
  const entity = ctx?.loadedEntityContext?.entity;
  if (!entity || !('title' in entity)) return undefined;
  return typeof entity.title === 'string' ? entity.title : undefined;
};

const startupMessage = (
  _payload: LocalStartupSessionPromptPayload,
  ctx?: PromptTypeHandlerContext,
): string => {
  const title = taskTitle(ctx);
  return title ? `Getting started on ${title}...` : 'Getting started...';
};

const finalAssessmentMessage = (
  _payload: LocalFinalAssessmentPromptPayload,
  ctx?: PromptTypeHandlerContext,
): string => {
  const title = taskTitle(ctx);
  return title ? `Running final assessment for ${title}...` : 'Running final assessment...';
};

const verificationPlanMessage = (
  _payload: LocalVerificationPlanPromptPayload,
  ctx?: PromptTypeHandlerContext,
): string => {
  const title = taskTitle(ctx);
  return title ? `Creating verification plan for ${title}...` : 'Creating verification plan...';
};

const childTaskUpdatesMessage = (payload: LocalChildTaskUpdatesPromptPayload): string => {
  const title = payload.completedTask.title;
  return title
    ? `Processing updates from completed task ${title}...`
    : 'Processing child task updates...';
};

const setSplittingMessage = (
  payload: LocalSetSplittingPromptPayload,
  ctx?: PromptTypeHandlerContext,
): string => {
  if (payload.splitMode === 'service' && payload.services?.length) {
    const names = payload.services.map((s) => s.name);
    const formatted =
      names.length <= 3
        ? names.join(', ')
        : `${names.slice(0, 3).join(', ')}, and ${names.length - 3} more`;
    return `Splitting into separate tasks for ${formatted}...`;
  }
  const title = taskTitle(ctx);
  return title ? `Splitting ${title} into sub-tasks...` : 'Splitting into sub-tasks...';
};

const reviewMessage = (_payload: LocalCodeReviewPromptPayload): string =>
  'Reviewing the changes made during this session...';

const freeFormMessage = (
  payload: LocalFreeFormPromptPayload,
  ctx?: PromptTypeHandlerContext,
): string => {
  if (payload.userMessage) {
    return `"${payload.userMessage}"\n\nI'll get started...`;
  }
  const title = taskTitle(ctx);
  return title ? `Getting started on ${title}...` : 'Getting started...';
};

/**
 * Build a human-readable starting message based on prompt type and payload.
 * Returns null for unknown/legacy prompt types so the caller can fall back.
 */
export const buildStartingMessage = (
  promptType: string | undefined,
  payload: AnyStartingMessagePayload | undefined,
  ctx?: PromptTypeHandlerContext,
): string | null => {
  if (!promptType || !payload) {
    return null;
  }

  switch (promptType) {
    case 'startup_session':
      return startupMessage(payload as LocalStartupSessionPromptPayload, ctx);
    case 'final_assessment':
      return finalAssessmentMessage(payload as LocalFinalAssessmentPromptPayload, ctx);
    case 'verification_plan':
      return verificationPlanMessage(payload as LocalVerificationPlanPromptPayload, ctx);
    case 'child_task_updates':
      return childTaskUpdatesMessage(payload as LocalChildTaskUpdatesPromptPayload);
    case 'set_splitting':
      return setSplittingMessage(payload as LocalSetSplittingPromptPayload, ctx);
    case 'free_form':
      return freeFormMessage(payload as LocalFreeFormPromptPayload, ctx);
    case 'code_review':
      return reviewMessage(payload as LocalCodeReviewPromptPayload);
    default:
      return null;
  }
};
