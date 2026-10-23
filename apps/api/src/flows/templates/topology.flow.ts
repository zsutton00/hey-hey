import { LocalPromptType } from 'src/generated/local';
import { TOPOLOGY_NODES } from '../constants';
import { createFlow } from './utils';

export const topologySummarizationFlow = createFlow({
  id: 'topology-summarization',
  name: 'Topology Summarization',
  description:
    'Non-conversational topology summarization flow for facets/categories',
  version: 1,
  startNode: TOPOLOGY_NODES.SUBFACET,
  terminalPromptType: LocalPromptType.free_form,
  nodes: {
    [TOPOLOGY_NODES.SUBFACET]: {},
    [TOPOLOGY_NODES.CATEGORY]: {},
  },
});
