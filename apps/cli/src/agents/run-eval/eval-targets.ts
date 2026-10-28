import type {
  LocalAgentSearchPromptPayload,
  LocalEntityConversationPromptPayload,
} from '../../shared/agent-bridge-contract/generated/api';
import type { ProjectAssistantConfig } from '../../shared/agent-bridge-contract/contract';
import {
  EvalConsumerHandlerKey,
  EvalTargetHandlerKey,
  type EvalCaseTarget,
  type EvalModelSetting,
} from '../../shared/api/generated/api';
import type { ServerLogger } from '../../server/logger';
import type { AgenticSession } from '../../session/types';
import type { PromptTypeHandler } from '../prompt-type-handler';
import { resolveProjectAssistantBootstrap } from '../project-assistant/proactive-behavior';
import type { ProjectAssistantPromptPayload } from '../project-assistant/project-assistant.handler';

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

/** What a payload builder may read: the attempt's own session and the registered handlers. */
export interface EvalTargetPayloadContext {
  session: AgenticSession;
  resolveHandler: (handlerId: string) => PromptTypeHandler<unknown> | undefined;
  logger: ServerLogger;
}

export type EvalTargetPayload =
  | ProjectAssistantPromptPayload
  | LocalAgentSearchPromptPayload
  | LocalEntityConversationPromptPayload;

type EvalTargetPayloadBuilder = (
  target: EvalCaseTarget,
  context: EvalTargetPayloadContext,
) => EvalTargetPayload;

/**
 * A Project Assistant case runs Project Assistant exactly as its consumer
 * handler's real use prepares it: the consumer's declared policy, narrowed only
 * by the attempt session's Project Assistant config.
 */
const buildProjectAssistantPayload: EvalTargetPayloadBuilder = (target, context) => {
  const { consumerHandler: consumerId, focalItemId } = target;
  if (!consumerId) {
    throw new Error('A Project Assistant case must name its consumer handler.');
  }
  if (!focalItemId) {
    throw new Error('A Project Assistant case needs a focal item.');
  }

  const consumer = context.resolveHandler(consumerId);
  const bootstrap = resolveProjectAssistantBootstrap(
    consumer,
    context.session,
    { entityType: 'TASK', entityId: focalItemId },
    buildEvalTargetMessage(target),
    context.logger,
  );
  if (!bootstrap) {
    throw new Error(`Handler "${consumerId}" does not run Project Assistant for this case.`);
  }

  return bootstrap.payload;
};

/**
 * Handlers an eval case may target, each with the payload its production
 * prompt expects. Keyed by the generated registry keys, so a key cannot join
 * the contract without a builder; the prompt-type registry rejects one that is
 * not a registered handler with a child configuration.
 */
const EVAL_TARGETS: Record<EvalTargetHandlerKey, EvalTargetPayloadBuilder> = {
  [EvalTargetHandlerKey.ProjectAssistant]: buildProjectAssistantPayload,
  [EvalTargetHandlerKey.AgentSearch]: (target): LocalAgentSearchPromptPayload => ({
    payloadVersion: 1,
    userMessage: buildEvalTargetMessage(target),
  }),
  [EvalTargetHandlerKey.EntityConversation]: (target): LocalEntityConversationPromptPayload => {
    if (!target.focalItemId) {
      throw new Error('An entity conversation case needs a focal item.');
    }
    return {
      entity: { entityType: 'TASK', entityId: target.focalItemId },
      userMessage: buildEvalTargetMessage(target),
    };
  },
};

export const EVAL_TARGET_HANDLER_IDS: readonly string[] = Object.values(EvalTargetHandlerKey);
export const EVAL_CONSUMER_HANDLER_IDS: readonly string[] = Object.values(EvalConsumerHandlerKey);

/** Builds the target payload for a recorded case. */
export const buildEvalTargetPayload = (
  target: EvalCaseTarget,
  context: EvalTargetPayloadContext,
): EvalTargetPayload => EVAL_TARGETS[target.targetHandler](target, context);

/**
 * The session an attempt prepares and runs under: the coordinator's session
 * carrying the run setup's Project Assistant config, so the shared bootstrap
 * decision sees the setting the way it sees a real session's. A Project
 * Assistant case is the research itself, so it never takes the on/off choice;
 * other flags still narrow it.
 */
export const buildEvalAttemptSession = (
  session: AgenticSession,
  setting: EvalModelSetting,
  target: EvalCaseTarget,
): AgenticSession => {
  const configured = setting.handlerConfig?.projectAssistant;
  const projectAssistant: ProjectAssistantConfig | undefined =
    configured && target.targetHandler === EvalTargetHandlerKey.ProjectAssistant
      ? { ...configured, enabled: true }
      : configured;

  return {
    ...session,
    config: {
      type: 'ENTITY_CONVERSATION',
      version: 'v1',
      model: setting.model,
      ...(projectAssistant ? { projectAssistant } : {}),
    },
  };
};
