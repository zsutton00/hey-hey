import { Injectable, Logger } from '@nestjs/common';
import { SystemMessageResponseType, UIElement } from 'src/generated';
import { ProjectService } from 'src/services/project.service';
import {
  NodeResult,
  NodeType,
  OpenerNodeBase,
  ProjectConversationFlowContext,
} from 'src/types/flow-internal.types';
import { OrganizationId } from 'src/types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { v4 as uuidv4 } from 'uuid';
import { PROJECT_CONVERSATION_NODES } from '../../constants';

@Injectable()
export class ProjectConversationWelcomeNode extends OpenerNodeBase<ProjectConversationFlowContext> {
  readonly id = PROJECT_CONVERSATION_NODES.WELCOME;
  readonly title = 'Project Conversation';

  private readonly logger = new Logger(ProjectConversationWelcomeNode.name);

  constructor(private readonly projectService: ProjectService) {
    super();
  }

  async execute(
    tracker: MutableContextHandle<ProjectConversationFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    const { workflowAboutId, workflowAboutType, organizationId } = context.core;

    if (!workflowAboutId || !workflowAboutType) {
      this.logger.warn('Missing workflow context for project conversation', {
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

    if (workflowAboutType !== 'project') {
      this.logger.warn(
        'Unsupported workflow about type for project conversation',
        {
          workflowAboutId,
          workflowAboutType,
          organizationId,
        },
      );
      return {
        type: NodeType.ERROR,
        message: 'Unsupported workflow context. Please try again.',
        data: {
          errorType: 'missing_data',
          context: 'workflow_context_invalid',
          temporary: true,
          detectedIntent: 'workflow_context_invalid',
          intentConfidence: 1,
        },
      };
    }

    try {
      const project = await this.resolveProjectLabel(
        workflowAboutId,
        organizationId,
      );

      const uiElements: UIElement[] = [
        {
          id: uuidv4(),
          type: 'textarea',
          label: 'What do you want to ask about this project?',
          placeholder: '',
          multiline: true,
          required: false,
          influences: [],
        },
      ];

      return {
        type: NodeType.QUESTIONS,
        message: `Let's talk about "${project}". What should we focus on?`,
        uiElements,
        data: {
          detectedIntent: 'project_conversation_started',
          intentConfidence: 1,
          reasoning: 'Initial project conversation prompt',
        },
      };
    } catch (error) {
      this.logger.error('Failed to resolve project for conversation', {
        workflowAboutId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        type: NodeType.ERROR,
        message: 'Project not found. Please try again.',
        data: {
          errorType: 'missing_data',
          context: 'project_not_found',
          temporary: true,
          detectedIntent: 'project_not_found',
          intentConfidence: 1,
        },
      };
    }
  }

  private async resolveProjectLabel(
    workflowAboutId: string,
    organizationId: OrganizationId,
  ): Promise<string> {
    const project = await this.projectService.findOne(
      workflowAboutId,
      organizationId,
    );
    if (!project) {
      throw new Error(`Project ${workflowAboutId} not found`);
    }
    return project.name ?? 'Untitled Project';
  }
}
