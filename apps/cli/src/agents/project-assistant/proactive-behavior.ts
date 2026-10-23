import type { ProjectAssistantPolicy } from '../prompt-type-handler';
import type { ProjectAssistantConfig } from '../../shared/agent-bridge-contract/contract';
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
