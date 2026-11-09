import { LocalPromptType } from '../../shared/agent-bridge-contract/contract';
import {
  EvalAssessedOutput,
  type EvalRecordedChanges,
  type EvalResolvedExecution,
} from '@hey-hey/contracts/api/models';
import type { RunMemo } from '../../session/types';

/**
 * The text the judge assesses for an attempt. A handler's reply is its final
 * message. Research alone is assessed on the research it saved, which the
 * research submission records as the Run's Project Assistant memo; the final
 * message is only a completion note and is never judged in its place.
 */
export const assessedOutputText = (
  execution: EvalResolvedExecution,
  finalMessage: string | undefined,
  memos: readonly RunMemo[] = [],
): string | undefined => {
  if (execution.assessedOutput === EvalAssessedOutput.HandlerReply) {
    return finalMessage;
  }

  return [...memos].reverse().find((memo) => memo.source === LocalPromptType.ProjectAssistant)
    ?.content;
};

const MAX_JUDGED_PATCH_CHARS = 30_000;

/**
 * The judged output for a coding attempt: the saved changes,
 * never the chat reply. Stored as the attempt's judgedOutput, so it is the
 * exact record of what the judge saw.
 */
export const codeChangesOutputText = (changes: EvalRecordedChanges): string => {
  const files =
    changes.files.length === 0
      ? ['The attempt changed no files.']
      : changes.files.map((file) => {
          const patch =
            file.patch.length > MAX_JUDGED_PATCH_CHARS
              ? `${file.patch.slice(0, MAX_JUDGED_PATCH_CHARS)}\n[Patch cut after ${MAX_JUDGED_PATCH_CHARS} characters.]`
              : file.patch;

          return `### ${file.path} (${file.status}, +${file.additions} -${file.deletions})\n${patch}`;
        });
  return ['## Changes made', ...files].join('\n');
};
