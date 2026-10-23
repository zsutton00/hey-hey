import { LocalPromptType } from 'src/generated/local';
import { AgentSessionType } from 'src/generated';
import {
  TaskRefinementFlowContext,
  FlowContext,
} from '../../types/flow-internal.types';
import { AgentSessionService } from '../../services/agent-session.service';
import { deriveAgentSessionTitle } from '../../services/agent-session-title';
import { TaskService } from '../../services/tasks/task.service';
import { InitiativeId, TaskId } from '../../types';
import { INestApplicationContext } from '@nestjs/common';

import { TASK_REFINEMENT_NODES } from '../constants';
import { createFlow } from './utils';

/**
 * Task Refinement Flow
 *
 * This flow implements a unified task refinement system that mirrors the initiative refinement
 * workflow with 90%+ code reuse. The flow guides users through progressive refinement of tasks
 * across task-type-aware levels:
 * - STANDARD: description → acceptanceCriteria
 * - BUG: description → finalize
 *
 * Architecture:
 * - Uses WorkStatus enum unified with initiatives for consistent status progression
 * - Leverages agent-based content generation with specialized AI agents per level
 * - Supports both manual and automated content generation workflows
 * - Operations-based agent responses with preview/apply workflow
 *
 * Key Features:
 * - Progressive refinement with quality gates at each level
 * - Agent-driven conversational editing with operations pattern
 * - Comprehensive error handling with user-friendly messages
 * - Real-time status updates using WorkStatus state machine
 *
 * Flow Progression:
 * BACKLOG → REFINING_* → GENERATING_* → ACTIVE
 */
export const taskRefinementFlow = createFlow({
  id: 'task-refinement',
  name: 'Task Refinement',
  description:
    'Agent-driven conversational refinement of tasks with operations-based editing',
  version: 2,
  startNode: TASK_REFINEMENT_NODES.WELCOME,
  terminalPromptType: LocalPromptType.free_form,

  nodes: {
    // Welcome node - starts the refinement process
    [TASK_REFINEMENT_NODES.WELCOME]: {
      nextNode: TASK_REFINEMENT_NODES.AGENT_EDITOR,
    },

    [TASK_REFINEMENT_NODES.RECOVERY]: {
      nextNode: TASK_REFINEMENT_NODES.AGENT_EDITOR,
    },

    [TASK_REFINEMENT_NODES.AGENT_EDITOR]: {
      transitions: {
        ready_to_finalize: {
          description: 'Ready to finalize task',
          nextNodeId: TASK_REFINEMENT_NODES.FINALIZE_ACTION,
        },
        default: {
          description: 'Present agent feedback to user',
          nextNodeId: TASK_REFINEMENT_NODES.AGENT_EDITOR,
        },
      },
    },

    [TASK_REFINEMENT_NODES.AGENT_NEXT_LEVEL]: {
      transitions: {
        ready_to_finalize: {
          description: 'Ready to finalize task',
          nextNodeId: TASK_REFINEMENT_NODES.FINALIZE_ACTION,
        },
        default: {
          description: 'Present generated content to user for review',
          nextNodeId: TASK_REFINEMENT_NODES.AGENT_EDITOR,
        },
      },
      skipToNode: {
        allowed: true,
        validPreviousNodes: '*',
      },
    },

    [TASK_REFINEMENT_NODES.FINALIZE_ACTION]: {
      transitions: {
        default: {
          description: 'Complete refinement and end flow',
          nextNodeId: TASK_REFINEMENT_NODES.END,
        },
      },
    },

    [TASK_REFINEMENT_NODES.PROMPT_INPUT]: {
      nextNode: TASK_REFINEMENT_NODES.AGENT_EDITOR,
      skipToNode: {
        allowed: true,
        validPreviousNodes: '*',
      },
    },

    [TASK_REFINEMENT_NODES.END]: {},
  },

  // Initial context transformation to populate task-specific fields
  initialContextTransform: async (
    baseContext: FlowContext,
    workflowAboutId: string | undefined,
    workflowAboutType: string | undefined,
    appContext: INestApplicationContext,
  ): Promise<TaskRefinementFlowContext> => {
    // Validate that this is a task refinement workflow
    if (workflowAboutType !== 'task') {
      throw new Error(
        `Task refinement flow requires workflowAboutType="task", got "${workflowAboutType}"`,
      );
    }

    if (!workflowAboutId) {
      throw new Error(
        'Task refinement flow requires workflowAboutId (task ID)',
      );
    }

    // Get task service to fetch task and its initiative ID
    const taskService = appContext.get(TaskService, { strict: false });

    // Find the task to get its initiative ID
    const task = await taskService.findOne(
      baseContext.core.organizationId,
      workflowAboutId as TaskId,
    );

    if (!task) {
      throw new Error(
        `Task ${workflowAboutId} not found for task refinement workflow`,
      );
    }

    const derivedTitle = deriveAgentSessionTitle(
      AgentSessionType.TaskRefining,
      {
        taskName: task.name,
      },
    );
    if (derivedTitle) {
      const agentSessionService = appContext.get(AgentSessionService, {
        strict: false,
      });
      await agentSessionService.applyDerivedTitleByConversation(
        baseContext.core.organizationId,
        baseContext.core.conversationId,
        derivedTitle,
      );
    }

    // Return properly typed TaskRefinementFlowContext
    return {
      ...baseContext,
      taskId: workflowAboutId as TaskId,
      initiativeId: (task.initiativeId ?? null) as InitiativeId | null,
    };
  },

  contextTransforms: {
    finalize_action: async (prev: TaskRefinementFlowContext) => {
      // Final processing will be handled by the action node
      return prev;
    },

    agent_feedback: async (prev: TaskRefinementFlowContext) => {
      // Agent feedback context will be populated by the agent response processing
      return prev;
    },

    finalize: async (prev: TaskRefinementFlowContext) => {
      return prev;
    },

    // Transform triggered when ending the flow
    end: async (prev: TaskRefinementFlowContext) => {
      // All refinement data has been processed and stored by action nodes
      // Database storage follows new architecture: generated data in proper tables
      return prev;
    },
  },
});
