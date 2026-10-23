import { LocalPromptType } from 'src/generated/local';
import { WorkflowName } from 'src/generated';
import { TASK_PRIORITIZATION_NODES } from '../constants';
import { createFlow } from './utils';
import { TaskPrioritizationFlowContext } from 'src/types/flow-internal.types';

export const taskPrioritizationFlow = createFlow<TaskPrioritizationFlowContext>(
  {
    id: WorkflowName.TaskPrioritization,
    name: 'Task Prioritization',
    description:
      'Single-pass workflow that ranks the next 10 tasks across all initiatives',
    version: 1,
    startNode: TASK_PRIORITIZATION_NODES.WELCOME,
    terminalPromptType: LocalPromptType.free_form,

    nodes: {
      [TASK_PRIORITIZATION_NODES.WELCOME]: {
        nextNode: TASK_PRIORITIZATION_NODES.GENERATE,
      },
      [TASK_PRIORITIZATION_NODES.GENERATE]: {
        nextNode: TASK_PRIORITIZATION_NODES.GENERATE,
      },
      [TASK_PRIORITIZATION_NODES.END]: {},
    },

    contextTransforms: {},
  },
);
