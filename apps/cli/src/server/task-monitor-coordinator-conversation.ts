import type { ApiRuntime } from '../../../../packages/ui-common/src/clients/shared';
import { isAxiosError } from 'axios';

import { AgentSessionType, WorkflowName } from '../shared/api/generated/api';
import type { ServerLogger } from './logger';

export interface TaskMonitorCoordinatorConversationInput {
  organizationId: string;
  projectId: string;
  taskMonitorId: string;
}

/** Resolves or establishes the one canonical conversation owned by a Task Monitor coordinator. */
export class TaskMonitorCoordinatorConversation {
  public constructor(
    private readonly apiRuntime: ApiRuntime,
    private readonly logger: ServerLogger,
  ) {}

  public async resolve(input: TaskMonitorCoordinatorConversationInput): Promise<string> {
    this.logger.debug('task_monitor.coordinator_conversation.resolve.started', { ...input });
    const coordinator = await this.apiRuntime.clients.agentSessions.resolveWorkItemCoordinator({
      organizationId: input.organizationId,
      projectId: input.projectId,
      resolveWorkItemCoordinatorAgentSessionDto: {
        type: AgentSessionType.TaskMonitor,
        workItemType: 'TASK_MONITOR',
        workItemId: input.taskMonitorId,
        sessionDate: new Date().toISOString(),
      },
    });
    const session = coordinator.data.data?.agentSession;
    if (!session?.id) {
      throw new Error('Task Monitor coordinator resolution returned without an Agent Session id.');
    }
    if (session.conversationId) {
      this.logger.debug('task_monitor.coordinator_conversation.resolve.completed', {
        ...input,
        coordinatorAgentSessionId: session.id,
        conversationId: session.conversationId,
        resolution: 'existing',
      });
      return session.conversationId;
    }

    try {
      this.logger.debug('task_monitor.coordinator_conversation.link.started', {
        ...input,
        coordinatorAgentSessionId: session.id,
      });
      const linked = await this.apiRuntime.clients.agentSessions.createAgentSessionConversation({
        organizationId: input.organizationId,
        projectId: input.projectId,
        agentSessionId: session.id,
        createAgentSessionConversationDto: {
          workflowType: WorkflowName.TaskMonitor,
          workflowAboutType: 'TASK_MONITOR',
          workflowAboutId: input.taskMonitorId,
        },
      });
      const conversationId = linked.data.data?.conversation.id;
      if (conversationId) {
        this.logger.info('task_monitor.coordinator_conversation.resolve.completed', {
          ...input,
          coordinatorAgentSessionId: session.id,
          conversationId,
          resolution: 'created',
        });
        return conversationId;
      }
    } catch (error) {
      if (!isAxiosError(error) || error.response?.status !== 409) throw error;
      this.logger.debug('task_monitor.coordinator_conversation.link.conflict', {
        ...input,
        coordinatorAgentSessionId: session.id,
      });
      const recovered = await this.apiRuntime.clients.agentSessions.getAgentSession({
        organizationId: input.organizationId,
        projectId: input.projectId,
        agentSessionId: session.id,
      });
      const conversationId = recovered.data.data?.conversationId;
      if (conversationId) {
        this.logger.info('task_monitor.coordinator_conversation.resolve.completed', {
          ...input,
          coordinatorAgentSessionId: session.id,
          conversationId,
          resolution: 'conflict_recovered',
        });
        return conversationId;
      }
    }
    throw new Error('Task Monitor coordinator conversation resolution returned without an id.');
  }
}
