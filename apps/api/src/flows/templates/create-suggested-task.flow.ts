import { LocalPromptType } from 'src/generated/local';
import { SUGGESTED_TASK_NODES } from '../constants';
import { createFlow } from './utils';

export const createSuggestedTaskFlow = createFlow({
  id: 'create-suggested-task',
  name: 'Create Suggested Task',
  description: 'Generates a single task from a suggested action selection',
  version: 1,
  startNode: SUGGESTED_TASK_NODES.GENERATE,
  terminalPromptType: LocalPromptType.free_form,
  nodes: {
    [SUGGESTED_TASK_NODES.GENERATE]: {},
  },
});
