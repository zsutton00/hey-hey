import { LocalPromptType } from 'src/generated/local';
import { TOPOLOGY_NODES } from '../constants';
import { createFlow } from './utils';

export const topologySubfacetSummarizationFlow = createFlow({
  id: 'topology-subfacet-summarization',
  name: 'Topology Subfacet Summarization',
  description:
    'Non-conversational flow to summarize subfacets from entity summaries',
  version: 1,
  startNode: TOPOLOGY_NODES.SUBFACET_SUMMARIZATION,
  terminalPromptType: LocalPromptType.free_form,
  nodes: {
    [TOPOLOGY_NODES.SUBFACET_SUMMARIZATION]: {},
  },
});
