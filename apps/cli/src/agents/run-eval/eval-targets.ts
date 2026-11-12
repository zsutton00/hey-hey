import type { RunEntityReference } from '@hey-hey/contracts/agent-bridge';
import {
  EvalConsumerHandlerKey,
  EvalTargetHandlerKey,
  type EvalCaseTarget,
} from '@hey-hey/contracts/api/models';
import { runEntityReferenceSchema } from '../../run/run-entity';
/** Resolve the canonical focal identity once for both prompt preparation and launch. */
export const resolveEvalTargetEntity = (target: EvalCaseTarget): RunEntityReference | null => {
  if (!target.focalItemId) {
    return null;
  }

  return runEntityReferenceSchema.parse({
    entityType: target.focalItemType,
    entityId: target.focalItemId,
  });
};

export const EVAL_TARGET_HANDLER_IDS: readonly string[] = Object.values(EvalTargetHandlerKey);
export const EVAL_CONSUMER_HANDLER_IDS: readonly string[] = Object.values(EvalConsumerHandlerKey);

/**
 * The text of the one message a case runs and is judged on. Multi-message
 * execution belongs to the multi-turn work; until then the final input is the
 * only one that matters, and a one-message case has no other. The API reads
 * runs recorded before inputs existed as a one-message list.
 */
export const finalEvalInputText = (target: EvalCaseTarget): string =>
  target.inputs.inputs[target.inputs.inputs.length - 1]!.text;
