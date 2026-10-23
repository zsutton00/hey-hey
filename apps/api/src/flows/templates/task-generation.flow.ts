import { LocalPromptType } from 'src/generated/local';
import { DesignDocId, InitiativeId, TaskId } from 'src/types';
import { TASK_GENERATION_NODES } from '../constants';
import { createFlow } from './utils';
import { TaskGenerationFlowContext } from 'src/types/flow-internal.types';
import { WorkflowName } from 'src/generated';
import { TaskService } from 'src/services/tasks/task.service';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';

export const taskGenerationFlow = createFlow({
  id: WorkflowName.TaskGeneration,
  name: 'Task Generation',
  description:
    'Simple interactive task generation workflow with conversational support',
  version: 1,
  startNode: TASK_GENERATION_NODES.WELCOME,
  terminalPromptType: LocalPromptType.free_form,

  nodes: {
    [TASK_GENERATION_NODES.WELCOME]: {
      nextNode: TASK_GENERATION_NODES.STUBS,
    },

    [TASK_GENERATION_NODES.RECOVERY]: {
      nextNode: TASK_GENERATION_NODES.STUBS,
    },

    [TASK_GENERATION_NODES.STUBS]: {
      nextNode: TASK_GENERATION_NODES.STUBS,
      skipToNode: {
        allowed: true,
        validPreviousNodes: [
          TASK_GENERATION_NODES.CONVERSATION,
          TASK_GENERATION_NODES.WELCOME,
          TASK_GENERATION_NODES.RECOVERY,
          TASK_GENERATION_NODES.STUBS,
        ],
        validateState: async () => {
          return { canSkip: true };
        },
      },
    },

    [TASK_GENERATION_NODES.GENERATE]: {
      nextNode: TASK_GENERATION_NODES.END,
      skipToNode: {
        allowed: true,
        validPreviousNodes: [TASK_GENERATION_NODES.STUBS],
        validateState: async () => {
          return { canSkip: true };
        },
      },
    },

    [TASK_GENERATION_NODES.CONVERSATION]: {
      nextNode: TASK_GENERATION_NODES.STUBS,
    },

    [TASK_GENERATION_NODES.END]: {},
  },

  contextTransforms: {},

  async initialContextTransform(
    baseContext,
    workflowAboutId,
    workflowAboutType,
    appContext,
  ) {
    if (!workflowAboutId) {
      throw new Error('Task generation flow requires workflowAboutId');
    }

    const organizationId = baseContext.core.organizationId;
    const taskService = appContext.get(TaskService, { strict: false });
    const designDocService = appContext.get(DesignDocService, {
      strict: false,
    });

    let initiativeId: InitiativeId | undefined;
    let parentTaskId: TaskId | undefined;
    let designDocId: DesignDocId | undefined;

    switch (workflowAboutType) {
      case 'task': {
        parentTaskId = workflowAboutId as TaskId;
        const parentTask = await taskService.findOneForAdapter(
          parentTaskId,
          organizationId,
        );
        if (parentTask?.initiativeId) {
          initiativeId = parentTask.initiativeId as InitiativeId;
        }
        break;
      }
      case 'design-doc': {
        designDocId = workflowAboutId as DesignDocId;
        const links = await designDocService.getLinks(
          designDocId,
          organizationId,
        );
        const taskLink = links.find((link) => link.entityType === 'task');

        if (taskLink) {
          parentTaskId = taskLink.entityId as TaskId;
          const task = await taskService.findOneForAdapter(
            taskLink.entityId as TaskId,
            organizationId,
          );
          if (task?.initiativeId) {
            initiativeId = task.initiativeId as InitiativeId;
          }
        }

        if (!initiativeId) {
          throw new Error(
            `Design doc ${designDocId} must be parented by a task whose initiative can be resolved to generate tasks`,
          );
        }
        break;
      }
      case 'initiative':
      case undefined: {
        initiativeId = workflowAboutId as InitiativeId;
        break;
      }
      default: {
        throw new Error(
          `Unsupported workflowAboutType "${workflowAboutType}" for task generation`,
        );
      }
    }

    return {
      ...baseContext,
      initiativeId: initiativeId ?? null,
      parentTaskId,
      designDocId,
    } as TaskGenerationFlowContext;
  },
});
