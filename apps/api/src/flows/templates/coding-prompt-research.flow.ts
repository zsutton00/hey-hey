import { LocalPromptType } from 'src/generated/local';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { TaskService } from 'src/services/tasks/task.service';
import { InitiativeId, TaskId, WorkflowAboutType } from 'src/types';
import { CodingPromptResearchFlowContext } from 'src/types/flow-internal.types';
import { DesignDocId } from 'src/types/design-doc.types';
import { CODING_PROMPT_RESEARCH_NODES } from '../constants';
import { createFlow } from './utils';

export const CODING_PROMPT_RESEARCH_FLOW_ID = 'coding-prompt-research';

export const codingPromptResearchFlow = createFlow({
  id: CODING_PROMPT_RESEARCH_FLOW_ID,
  name: 'Coding Prompt Research',
  description: 'Single-pass coding prompt research flow that runs one agent',
  version: 1,
  startNode: CODING_PROMPT_RESEARCH_NODES.AGENT,
  terminalPromptType: LocalPromptType.free_form,
  nodes: {
    [CODING_PROMPT_RESEARCH_NODES.AGENT]: {
      nextNode: CODING_PROMPT_RESEARCH_NODES.END,
    },
    [CODING_PROMPT_RESEARCH_NODES.END]: {},
  },

  async initialContextTransform(
    baseContext,
    workflowAboutId,
    workflowAboutType,
    appContext,
  ): Promise<CodingPromptResearchFlowContext> {
    if (!workflowAboutId || !workflowAboutType) {
      throw new Error(
        'Coding prompt research flow requires workflowAboutId and workflowAboutType',
      );
    }

    const type = workflowAboutType as WorkflowAboutType;
    const organizationId = baseContext.core.organizationId;
    const taskService = appContext.get(TaskService, { strict: false });
    const initiativeService = appContext.get(InitiativeService, {
      strict: false,
    });
    const designDocService = appContext.get(DesignDocService, {
      strict: false,
    });

    if (type === 'task') {
      const task = await taskService.findOneForAdapter(
        workflowAboutId as TaskId,
        organizationId,
      );
      if (!task) {
        throw new Error(
          `Task ${workflowAboutId} not found for coding prompt research flow`,
        );
      }

      let initiativeId: InitiativeId | undefined = task.initiativeId
        ? (task.initiativeId as InitiativeId)
        : undefined;
      if (initiativeId) {
        const initiative = await initiativeService.findOneForAdapter(
          initiativeId,
          organizationId,
        );
        if (!initiative) {
          initiativeId = undefined;
        }
      }

      return {
        ...baseContext,
        taskId: task.id as TaskId,
        ...(initiativeId ? { initiativeId } : {}),
        research: {
          status: 'STARTED',
          startedAt: new Date().toISOString(),
        },
      };
    }

    if (type === 'design-doc') {
      const designDoc = await designDocService.findOneForAdapter(
        workflowAboutId,
        organizationId,
      );
      if (!designDoc) {
        throw new Error(
          `Design doc ${workflowAboutId} not found for coding prompt research flow`,
        );
      }

      return {
        ...baseContext,
        designDocId: designDoc.id as DesignDocId,
        research: {
          status: 'STARTED',
          startedAt: new Date().toISOString(),
        },
      };
    }

    throw new Error(
      `Unsupported workflowAboutType for coding prompt research flow: ${type}`,
    );
  },
});
