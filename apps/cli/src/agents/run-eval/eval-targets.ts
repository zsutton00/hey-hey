import type {
  LocalAgentSearchPromptPayload,
  LocalEntityConversationPromptPayload,
} from '../../shared/agent-bridge-contract/generated/api';
import type { EvalCaseTarget } from '../../shared/api/generated/api';

/**
 * The text a target receives: the case's situation, the items it concerns and
 * the single initiating request. Never checks, rubric or expectations — those
 * live on the grading half of the case, which this function cannot see.
 */
export const buildEvalTargetMessage = (target: EvalCaseTarget): string =>
  [
    target.situation,
    ...(target.focalItemId ? [`Focal item: ${target.focalItemId}`] : []),
    ...(target.supportingItemIds && target.supportingItemIds.length > 0
      ? [`Related items: ${target.supportingItemIds.join(', ')}`]
      : []),
    '',
    target.initiatingRequest,
  ].join('\n');

type EvalTargetPayloadBuilder = (target: EvalCaseTarget) => unknown;

/**
 * Handlers an eval case may target, each with the payload its production
 * prompt expects. A handler joins this list only once it declares a child
 * configuration that preserves its production prompt and tools.
 */
const EVAL_TARGETS: ReadonlyMap<string, EvalTargetPayloadBuilder> = new Map<
  string,
  EvalTargetPayloadBuilder
>([
  [
    'agent_search',
    (target): LocalAgentSearchPromptPayload => ({
      payloadVersion: 1,
      userMessage: buildEvalTargetMessage(target),
    }),
  ],
  [
    'entity_conversation',
    (target): LocalEntityConversationPromptPayload => {
      if (!target.focalItemId) {
        throw new Error('An entity conversation case needs a focal item.');
      }
      return {
        entity: { entityType: 'TASK', entityId: target.focalItemId },
        userMessage: buildEvalTargetMessage(target),
      };
    },
  ],
]);

export const EVAL_TARGET_HANDLER_IDS: readonly string[] = [...EVAL_TARGETS.keys()];

/** Builds the target payload, or throws when the case names a handler evals cannot run. */
export const buildEvalTargetPayload = (target: EvalCaseTarget): unknown => {
  const build = EVAL_TARGETS.get(target.targetHandler);
  if (!build) {
    throw new Error(
      `Handler "${target.targetHandler}" cannot be evaluated yet. Evaluable handlers: ${EVAL_TARGET_HANDLER_IDS.join(', ')}.`,
    );
  }
  return build(target);
};
