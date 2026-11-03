import { LocalPromptType } from '../../shared/agent-bridge-contract/contract';
import { EvalAssessedOutput, type EvalResolvedExecution } from '@hey-hey/contracts/api/models';
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
