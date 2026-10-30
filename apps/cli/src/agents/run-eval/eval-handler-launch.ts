import {
  LocalPromptType,
  type LocalCreateRunRequest,
} from '../../shared/agent-bridge-contract/contract';
import type { RunEntityReference } from '../../shared/agent-bridge-contract/generated/api';
import { EvalTargetHandlerKey, type EvalResolvedExecution } from '../../shared/api/generated/api';

/** The first turn an attempt's Run starts with, built from the attempt's recorded execution. */
export interface EvalFirstTurn {
  payload: NonNullable<LocalCreateRunRequest['payload']>;
  /** Set when Project Assistant research is the whole attempt and runs under this consumer's policy. */
  projectAssistantConsumerHandlerId?: string;
}

/**
 * Starts the recorded handler directly on the case's initiating request, the
 * way the normal workflow would have, without the workflow. A handler that
 * needs an input this attempt cannot supply throws here, which fails only this
 * attempt with the reason.
 */
export const buildEvalFirstTurn = (
  execution: EvalResolvedExecution,
  userMessage: string,
  entity: RunEntityReference,
): EvalFirstTurn => {
  switch (execution.handler) {
    case EvalTargetHandlerKey.AgentSearch:
      return {
        payload: {
          promptType: LocalPromptType.AgentSearch,
          payloadVersion: 1,
          entity,
          userMessage,
        },
      };

    case EvalTargetHandlerKey.EntityConversation:
      return { payload: { promptType: LocalPromptType.EntityConversation, entity, userMessage } };

    case EvalTargetHandlerKey.ProjectAssistant:
      if (!execution.consumerHandler) {
        throw new Error('Project Assistant research must name the consumer policy it runs under.');
      }
      return {
        payload: { promptType: LocalPromptType.Research, entity, userMessage },
        projectAssistantConsumerHandlerId: execution.consumerHandler,
      };

    case EvalTargetHandlerKey.FeatureSyncAnalyze:
      if (entity.entityType !== 'TASK') {
        throw new Error(
          `${execution.handler} cannot start as the first agent: it analyzes a work item, and this case's focal item is ${entity.entityType === 'PROJECT' ? 'the project' : entity.entityType}.`,
        );
      }
      return {
        payload: {
          promptType: LocalPromptType.FeatureSyncAnalyze,
          entity,
          taskId: entity.entityId,
          userMessage,
        },
      };
  }
};
