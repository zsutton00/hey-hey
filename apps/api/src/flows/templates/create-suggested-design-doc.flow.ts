import { LocalPromptType } from 'src/generated/local';
import { SUGGESTED_DESIGN_DOC_NODES } from '../constants';
import { createFlow } from './utils';

export const createSuggestedDesignDocFlow = createFlow({
  id: 'create-suggested-design-doc',
  name: 'Create Suggested Design Doc',
  description: 'Generates a design document from a suggested action selection',
  version: 1,
  startNode: SUGGESTED_DESIGN_DOC_NODES.GENERATE,
  terminalPromptType: LocalPromptType.free_form,
  nodes: {
    [SUGGESTED_DESIGN_DOC_NODES.GENERATE]: {},
  },
});
