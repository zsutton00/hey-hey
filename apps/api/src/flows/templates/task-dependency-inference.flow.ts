import { LocalPromptType } from 'src/generated/local';
import { TASK_DEPENDENCY_INFERENCE_NODES } from '../constants';
import { createFlow } from './utils';

export const taskDependencyInferenceFlow = createFlow({
  id: 'task-dependency-inference',
  name: 'Task Dependency Inference',
  description: 'Non-interactive flow to infer missing task dependencies',
  version: 1,
  startNode: TASK_DEPENDENCY_INFERENCE_NODES.GENERATE,
  terminalPromptType: LocalPromptType.free_form,
  nodes: {
    [TASK_DEPENDENCY_INFERENCE_NODES.GENERATE]: {},
  },
});
