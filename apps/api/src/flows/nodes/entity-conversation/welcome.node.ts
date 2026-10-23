import { Injectable, Logger } from '@nestjs/common';
import { SystemMessageResponseType, UIElement } from 'src/generated';
import { AgentSessionService } from 'src/services/agent-session.service';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { ProjectService } from 'src/services/project.service';
import { TaskService } from 'src/services/tasks/task.service';
import {
  EntityConversationFlowContext,
  NodeResult,
  NodeType,
  OpenerNodeBase,
} from 'src/types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { v4 as uuidv4 } from 'uuid';
import { ENTITY_CONVERSATION_NODES } from '../../constants';
import { OrganizationId, PlanId } from 'src/types';
import {
  entityConversationTaskLabel,
  isEntityConversationTaskAboutType,
} from '../../utils/entity-conversation-about-type.util';

@Injectable()
export class EntityConversationWelcomeNode extends OpenerNodeBase<EntityConversationFlowContext> {
  readonly id = ENTITY_CONVERSATION_NODES.WELCOME;
  readonly title = 'Entity Conversation';

  private readonly logger = new Logger(EntityConversationWelcomeNode.name);

  constructor(
    private readonly taskService: TaskService,
    private readonly initiativeService: InitiativeService,
    private readonly designDocService: DesignDocService,
    private readonly projectService: ProjectService,
    private readonly agentSessionService: AgentSessionService,
  ) {
    super();
  }

  async execute(
    tracker: MutableContextHandle<EntityConversationFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    const { workflowAboutId, workflowAboutType, organizationId } = context.core;

    if (!workflowAboutId || !workflowAboutType) {
      this.logger.warn('Missing workflow context for entity conversation', {
        workflowAboutId,
        workflowAboutType,
        organizationId,
      });
      return {
        type: NodeType.ERROR,
        message: 'Missing workflow context. Please try again.',
        data: {
          errorType: 'missing_data',
          context: 'workflow_context_missing',
          temporary: true,
          detectedIntent: 'workflow_context_missing',
          intentConfidence: 1,
        },
      };
    }

    try {
      const { label, title } = await this.resolveEntityLabel(
        workflowAboutType,
        workflowAboutId,
        organizationId,
      );

      const uiElements: UIElement[] = [
        {
          id: uuidv4(),
          type: 'textarea',
          label: `What do you want to ask about this ${label}?`,
          placeholder: '',
          multiline: true,
          required: false,
          influences: [],
        },
      ];

      return {
        type: NodeType.QUESTIONS,
        message: `Let's talk about "${title}". What should we focus on?`,
        uiElements,
        data: {
          detectedIntent: 'entity_conversation_started',
          intentConfidence: 1,
          reasoning: 'Initial entity conversation prompt',
          ragEnabled: false,
        },
      };
    } catch (error) {
      this.logger.error('Failed to resolve entity for conversation', {
        workflowAboutType,
        workflowAboutId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        type: NodeType.ERROR,
        message: 'Entity not found. Please try again.',
        data: {
          errorType: 'missing_data',
          context: 'entity_not_found',
          temporary: true,
          detectedIntent: 'entity_not_found',
          intentConfidence: 1,
        },
      };
    }
  }

  private async resolveEntityLabel(
    workflowAboutType: string,
    workflowAboutId: string,
    organizationId: OrganizationId,
  ): Promise<{ label: string; title: string }> {
    if (isEntityConversationTaskAboutType(workflowAboutType)) {
      const task = await this.taskService.findOneForAdapter(
        workflowAboutId,
        organizationId,
      );
      if (!task) {
        throw new Error(`Task ${workflowAboutId} not found`);
      }
      return {
        label: entityConversationTaskLabel(workflowAboutType),
        title: task.name ?? 'Untitled Work Item',
      };
    }

    switch (workflowAboutType) {
      case 'initiative': {
        const initiative = await this.initiativeService.findOneForAdapter(
          workflowAboutId,
          organizationId,
        );
        if (!initiative) {
          throw new Error(`Initiative ${workflowAboutId} not found`);
        }
        return {
          label: 'initiative',
          title: initiative.name ?? 'Untitled Initiative',
        };
      }
      case 'design-doc': {
        const designDoc = await this.designDocService.findOneForAdapter(
          workflowAboutId,
          organizationId,
        );
        if (!designDoc) {
          throw new Error(`Design doc ${workflowAboutId} not found`);
        }
        return {
          label: 'design doc',
          title: designDoc.name ?? 'Untitled Design Doc',
        };
      }
      case 'agent-session': {
        const session = await this.agentSessionService.findOne(
          organizationId,
          workflowAboutId,
        );
        return {
          label: 'agent session',
          title: session.title ?? 'Agent Session',
        };
      }
      case 'project': {
        const project = await this.projectService.findOne(
          workflowAboutId,
          organizationId,
        );
        if (!project) {
          throw new Error(`Project ${workflowAboutId} not found`);
        }
        return {
          label: 'project',
          title: project.name ?? 'Untitled Project',
        };
      }
      default:
        throw new Error(`Unsupported workflowAboutType "${workflowAboutType}"`);
    }
  }
}
