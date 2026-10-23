import { LocalPromptType } from 'src/generated/local';
import { AgentSessionType, WorkflowName } from 'src/generated';
import { AgentSessionService } from 'src/services/agent-session.service';
import { deriveAgentSessionTitle } from 'src/services/agent-session-title';
import { ProjectService } from 'src/services/project.service';
import { ProjectConversationFlowContext } from 'src/types/flow-internal.types';
import { PROJECT_CONVERSATION_NODES, SHARED_NODES } from '../constants';
import { createFlow } from './utils';

const SUPPORTED_WORKFLOW_ABOUT_TYPES = new Set(['project']);

export const projectConversationFlow =
  createFlow<ProjectConversationFlowContext>({
    id: WorkflowName.ProjectConversation,
    name: 'Project Conversation',
    description: 'Agentic conversation about an entire project',
    version: 1,
    startNode: PROJECT_CONVERSATION_NODES.WELCOME,
    terminalPromptType: LocalPromptType.free_form,

    nodes: {
      [PROJECT_CONVERSATION_NODES.WELCOME]: {
        nextNode: PROJECT_CONVERSATION_NODES.AGENT,
      },

      [PROJECT_CONVERSATION_NODES.RECOVERY]: {
        nextNode: PROJECT_CONVERSATION_NODES.AGENT,
      },

      [PROJECT_CONVERSATION_NODES.AGENT]: {
        transitions: {
          default: {
            nextNodeId: PROJECT_CONVERSATION_NODES.AGENT,
            description: 'Continue project conversation',
          },
          end: {
            nextNodeId: PROJECT_CONVERSATION_NODES.END,
            description: 'Conversation complete',
          },
        },
      },

      [SHARED_NODES.SUGGESTED_ACTIONS_GENERATE_TASK]: {
        nextNode: PROJECT_CONVERSATION_NODES.AGENT,
      },

      [PROJECT_CONVERSATION_NODES.END]: {},
    },

    async initialContextTransform(
      baseContext,
      workflowAboutId,
      workflowAboutType,
      appContext,
    ): Promise<ProjectConversationFlowContext> {
      if (!workflowAboutId) {
        throw new Error('Project conversation flow requires workflowAboutId');
      }

      if (!workflowAboutType) {
        throw new Error('Project conversation flow requires workflowAboutType');
      }

      if (!SUPPORTED_WORKFLOW_ABOUT_TYPES.has(workflowAboutType)) {
        throw new Error(
          `Unsupported workflowAboutType "${workflowAboutType}" for project conversation flow`,
        );
      }

      const projectService = appContext.get(ProjectService, { strict: false });
      const project = await projectService.findOne(
        workflowAboutId,
        baseContext.core.organizationId,
      );
      const derivedTitle = deriveAgentSessionTitle(
        AgentSessionType.ProjectConversation,
        { projectName: project?.name },
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

      return baseContext;
    },
  });
