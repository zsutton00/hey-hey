import { LocalPromptType } from 'src/generated/local';
import { TOPOLOGY_NODES } from '../constants';
import { createFlow } from './utils';

export const topologyCategorySummarizationFlow = createFlow({
  id: 'topology-category-summarization',
  name: 'Topology Category Summarization',
  description: 'Non-conversational flow to summarize categories from subfacets',
  version: 1,
  startNode: TOPOLOGY_NODES.CATEGORY_CONSOLIDATION,
  terminalPromptType: LocalPromptType.free_form,
  nodes: {
    [TOPOLOGY_NODES.CATEGORY_CONSOLIDATION]: {},
  },
});
