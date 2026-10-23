import { LocalPromptType } from 'src/generated/local';
import { ENTITY_SUMMARIZATION_NODES } from '../constants';
import { createFlow } from './utils';

export const entitySummarizationFlow = createFlow({
  id: 'entity-summarization',
  name: 'Entity Summarization',
  description:
    'Generates a summary for a single entity (Task, Initiative) upon completion',
  version: 1,
  startNode: ENTITY_SUMMARIZATION_NODES.SUMMARIZE,
  terminalPromptType: LocalPromptType.free_form,
  nodes: {
    [ENTITY_SUMMARIZATION_NODES.SUMMARIZE]: {},
  },
});
