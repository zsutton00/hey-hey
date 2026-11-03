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
