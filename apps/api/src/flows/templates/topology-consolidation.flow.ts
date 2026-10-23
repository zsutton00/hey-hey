import { LocalPromptType } from 'src/generated/local';
import { TOPOLOGY_NODES } from '../constants';
import { createFlow } from './utils';

export const topologyConsolidationFlow = createFlow({
  id: 'topology-consolidation',
  name: 'Topology Consolidation',
  description:
    'Non-conversational flow to consolidate subfacets and categories within topology',
  version: 1,
  startNode: TOPOLOGY_NODES.CONSOLIDATION,
  terminalPromptType: LocalPromptType.free_form,
  nodes: {
    [TOPOLOGY_NODES.CONSOLIDATION]: {},
    [TOPOLOGY_NODES.CATEGORY_CONSOLIDATION]: {},
  },
});
