import type { UIHints } from '../../generated';
import type { ConversationNode, Flow } from '../../types/flow-internal.types';

export function getWorkflowEntryUiHints(
  flow: Pick<Flow, 'nodes' | 'startNode'>,
): UIHints | undefined {
  return flow.nodes[flow.startNode]?.uiHints;
}

export function getWorkflowNodeUiHints(
  node: Pick<ConversationNode, 'uiHints'>,
): UIHints | undefined {
  return node.uiHints;
}
