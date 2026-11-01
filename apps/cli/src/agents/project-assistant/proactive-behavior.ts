import type { PromptTypeHandler, ProjectAssistantPolicy } from '../prompt-type-handler';
import type { ProjectAssistantConfig } from '../../shared/agent-bridge-contract/contract';
import {
  LocalPromptType,
  type RunEntityReference,
} from '../../shared/agent-bridge-contract/generated/api';
import type { ServerLogger } from '../../server/logger';
import type { AgenticSession } from '../../session/types';
import type { ProjectAssistantPromptPayload } from './project-assistant.handler';
import {
  PROJECT_ASSISTANT_CREATE_WORK_ITEM_MCP_TOOL,
  PROJECT_ASSISTANT_EDGE_MCP_TOOLS,
  PROJECT_ASSISTANT_EDIT_WORK_ITEM_MCP_TOOL,
  PROJECT_ASSISTANT_WORK_ITEM_GUIDANCE_MCP_TOOL,
} from '../mcp-server-config';

/**
 * Resolves durable session intent against the handler-owned participation and
 * capability ceiling. Config can only narrow the declaration; omission preserves it.
 */
export const resolveProjectAssistantPolicy = (
  declaration: ProjectAssistantPolicy | undefined,
  config?: ProjectAssistantConfig,
): ProjectAssistantPolicy | undefined => {
  if (!declaration || config?.enabled === false) return undefined;

  return {
    allowEdgeUpdates: declaration.allowEdgeUpdates && config?.allowEdgeUpdates !== false,
    notifyDiscrepancies: declaration.notifyDiscrepancies && config?.notifyDiscrepancies !== false,
    workItemProposalMode:
      config?.allowUpdateProposals === false ? 'none' : declaration.workItemProposalMode,
  };
};

/**
 * Reads Project Assistant intent only from session-config variants that own
 * that setting. The Entity Conversation variant is part of the same durable
 * config boundary even when an older generated client has not emitted its
 * discriminator yet, so the runtime check remains deliberately structural.
 */
export const resolveProjectAssistantConfig = (
  config: AgenticSession['config'],
): ProjectAssistantConfig | undefined => {
  if (!config) return undefined;

  const configType: string = config.type;
  if (configType !== 'CODING_SESSION' && configType !== 'ENTITY_CONVERSATION') {
    return undefined;
  }

  return 'projectAssistant' in config ? config.projectAssistant : undefined;
};

export interface ProjectAssistantBootstrap {
  policy: ProjectAssistantPolicy;
  payload: ProjectAssistantPromptPayload;
}

/**
 * Decides whether and how Project Assistant prepares a consumer handler's
 * first turn. Returns undefined when the consumer does not take part: no
 * handler, no focal entity, no declared policy, or session config disabling it.
 * Stateless; the caller owns the one-shot gate, queueing and turn start.
 */
export const resolveProjectAssistantBootstrap = (
  consumerHandler: PromptTypeHandler<unknown> | undefined,
  session: AgenticSession,
  focalEntity: RunEntityReference | null,
  userMessage: string,
  logger: ServerLogger,
): ProjectAssistantBootstrap | undefined => {
  if (!consumerHandler) return undefined;
  const policy = resolveProjectAssistantPolicy(
    consumerHandler.resolveProjectAssistant
      ? consumerHandler.resolveProjectAssistant(session, logger)
      : consumerHandler.projectAssistant,
    resolveProjectAssistantConfig(session.config),
  );
  if (!policy || !focalEntity) return undefined;

  return {
    policy,
    payload: {
      promptType: LocalPromptType.Research,
      entity: focalEntity,
      userMessage,
      projectAssistantHandoff: { consumerHandlerId: consumerHandler.id, policy },
    },
  };
};

export const resolveProjectAssistantAdditionalTools = (
  policy: ProjectAssistantPolicy,
): readonly string[] => {
  const proposalTools =
    policy.workItemProposalMode === 'none'
      ? []
      : [
          PROJECT_ASSISTANT_WORK_ITEM_GUIDANCE_MCP_TOOL,
          ...(policy.workItemProposalMode === 'create' || policy.workItemProposalMode === 'all'
            ? [PROJECT_ASSISTANT_CREATE_WORK_ITEM_MCP_TOOL]
            : []),
          ...(policy.workItemProposalMode === 'edit' || policy.workItemProposalMode === 'all'
            ? [PROJECT_ASSISTANT_EDIT_WORK_ITEM_MCP_TOOL]
            : []),
        ];
  return [...(policy.allowEdgeUpdates ? PROJECT_ASSISTANT_EDGE_MCP_TOOLS : []), ...proposalTools];
};
