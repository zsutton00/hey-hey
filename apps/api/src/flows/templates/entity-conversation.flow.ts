import { INestApplicationContext } from '@nestjs/common';
import { LocalPromptType } from 'src/generated/local';
import { AgentSessionType, WorkflowName } from 'src/generated';
import { AgentSessionService } from 'src/services/agent-session.service';
import { deriveAgentSessionTitle } from 'src/services/agent-session-title';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { ProjectService } from 'src/services/project.service';
import { TaskService } from 'src/services/tasks/task.service';
import { OrganizationId, PlanId } from 'src/types';
import { SuggestedActionsFlowContext } from 'src/types/flow-internal.types';
import { ENTITY_CONVERSATION_NODES, SHARED_NODES } from '../constants';
import {
  ENTITY_CONVERSATION_TASK_ABOUT_TYPES,
  isEntityConversationTaskAboutType,
} from '../utils/entity-conversation-about-type.util';
import { createFlow } from './utils';

async function resolveEntityName(
  workflowAboutType: string,
  workflowAboutId: string,
  organizationId: OrganizationId,
  appContext: INestApplicationContext,
): Promise<string | null> {
  if (isEntityConversationTaskAboutType(workflowAboutType)) {
    const taskService = appContext.get(TaskService, { strict: false });
    const task = await taskService.findOneForAdapter(
      workflowAboutId,
      organizationId,
    );
    return task?.name ?? null;
  }

  switch (workflowAboutType) {
    case 'initiative': {
      const initiativeService = appContext.get(InitiativeService, {
        strict: false,
      });
      const initiative = await initiativeService.findOneForAdapter(
        workflowAboutId,
        organizationId,
      );
      return initiative?.name ?? null;
    }
    case 'design-doc': {
      const designDocService = appContext.get(DesignDocService, {
        strict: false,
      });
      const designDoc = await designDocService.findOneForAdapter(
        workflowAboutId,
        organizationId,
      );
      return designDoc?.name ?? null;
    }
    case 'agent-session': {
      const agentSessionService = appContext.get(AgentSessionService, {
        strict: false,
      });
      const session = await agentSessionService.findOne(
        organizationId,
        workflowAboutId,
      );
      return session?.title ?? null;
    }
    case 'project': {
      const projectService = appContext.get(ProjectService, { strict: false });
      const project = await projectService.findOne(
        workflowAboutId,
        organizationId,
      );
      return project?.name ?? null;
    }
    default:
      return null;
  }
}

const SUPPORTED_WORKFLOW_ABOUT_TYPES = new Set([
  ...ENTITY_CONVERSATION_TASK_ABOUT_TYPES,
  'initiative',
  'design-doc',
  'agent-session',
  'project',
  'plan',
  'service',
]);

export const entityConversationFlow = createFlow<SuggestedActionsFlowContext>({
  id: WorkflowName.EntityConversation,
  name: 'Entity Conversation',
  description: 'Agentic conversation about a specific entity',
  version: 1,
  startNode: ENTITY_CONVERSATION_NODES.WELCOME,
  terminalPromptType: LocalPromptType.free_form,

  nodes: {
    [ENTITY_CONVERSATION_NODES.WELCOME]: {
      nextNode: ENTITY_CONVERSATION_NODES.AGENT,
    },

    [ENTITY_CONVERSATION_NODES.RECOVERY]: {
      nextNode: ENTITY_CONVERSATION_NODES.AGENT,
    },

    [ENTITY_CONVERSATION_NODES.AGENT]: {
      transitions: {
        default: {
          nextNodeId: ENTITY_CONVERSATION_NODES.AGENT,
          description: 'Continue entity conversation',
        },
        end: {
          nextNodeId: ENTITY_CONVERSATION_NODES.END,
          description: 'Conversation complete',
        },
      },
    },

    [SHARED_NODES.SUGGESTED_ACTIONS_GENERATE_TASK]: {
      nextNode: ENTITY_CONVERSATION_NODES.AGENT,
    },

    [ENTITY_CONVERSATION_NODES.END]: {},
  },

  async initialContextTransform(
    baseContext,
    workflowAboutId,
    workflowAboutType,
    appContext,
  ): Promise<SuggestedActionsFlowContext> {
    if (!workflowAboutId) {
      throw new Error('Entity conversation flow requires workflowAboutId');
    }

    if (!workflowAboutType) {
      throw new Error('Entity conversation flow requires workflowAboutType');
    }

    if (!SUPPORTED_WORKFLOW_ABOUT_TYPES.has(workflowAboutType)) {
      throw new Error(
        `Unsupported workflowAboutType "${workflowAboutType}" for entity conversation flow`,
      );
    }

    const entityName = await resolveEntityName(
      workflowAboutType,
      workflowAboutId,
      baseContext.core.organizationId,
      appContext,
    );
    const derivedTitle = deriveAgentSessionTitle(
      AgentSessionType.EntityConversation,
      { entityName },
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
