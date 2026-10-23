import { Injectable } from '@nestjs/common';
import { Client } from '@temporalio/client';
import { InjectTemporalClient } from '../../prisma/temporal.module';
import { WorkflowId } from '../../types';
import {
  AgentExecutionResultPayload,
  FlowUserMessage,
} from '../../types/flow-internal.types';
import { WorkflowSignals } from '../../utils/workflow-signals.util';
import { ContextAwareLogger } from '../../core/logging/context-aware-logger.service';

/**
 * Service for handling initiative refinement workflow operations
 * Replaces direct service calls with workflow signal-based communication
 */
@Injectable()
export class InitiativeRefinementWorkflowService {
  private readonly logger = ContextAwareLogger.createServiceLogger(
    InitiativeRefinementWorkflowService.name,
  );

  constructor(
    @InjectTemporalClient() private readonly temporalClient: Client,
  ) {}

  /**
   * Send agent execution result to workflow
   */
  async sendAgentExecutionResult(
    workflowId: WorkflowId,
    payload: AgentExecutionResultPayload,
  ): Promise<void> {
    try {
      const workflowHandle = this.temporalClient.workflow.getHandle(workflowId);
      const signalName =
        WorkflowSignals.getAgentExecutionResultSignalName(workflowId);

      await workflowHandle.signal(signalName, payload);

      this.logger.log(
        `Sent agent execution result signal to workflow ${workflowId}`,
        {
          agentId: payload.agentId,
          executionId: payload.executionId,
          status: payload.status,
          signalName,
          organizationId: payload.organizationId,
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to send agent execution result signal to workflow ${workflowId}`,
        {
          error: error instanceof Error ? error.message : error,
          agentId: payload.agentId,
          executionId: payload.executionId,
          status: payload.status,
          organizationId: payload.organizationId,
        },
      );
      throw error;
    }
  }

  /**
   * Check if workflow is running and responsive
   */
  async isWorkflowRunning(workflowId: WorkflowId): Promise<boolean> {
    try {
      const workflowHandle = this.temporalClient.workflow.getHandle(workflowId);
      const description = await workflowHandle.describe();

      return description.status.name === 'RUNNING';
    } catch (error) {
      this.logger.warn(`Failed to check workflow status for ${workflowId}`, {
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }

  /**
   * Get workflow execution status and metadata
   */
  async getWorkflowInfo(workflowId: WorkflowId): Promise<{
    status: string;
    startTime?: Date;
    runTime?: number;
    metadata?: Record<string, unknown>;
  }> {
    try {
      const workflowHandle = this.temporalClient.workflow.getHandle(workflowId);
      const description = await workflowHandle.describe();

      return {
        status: description.status.name,
        startTime: description.startTime
          ? new Date(description.startTime)
          : undefined,
        runTime: description.startTime
          ? Date.now() - new Date(description.startTime).getTime()
          : undefined,
        metadata: (description.memo?.fields as Record<string, unknown>) || {},
      };
    } catch (error) {
      this.logger.error(`Failed to get workflow info for ${workflowId}`, {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Send user message to initiative refinement workflow
   */
  async sendUserMessage(
    workflowId: WorkflowId,
    message: FlowUserMessage,
  ): Promise<void> {
    try {
      const workflowHandle = this.temporalClient.workflow.getHandle(workflowId);
      const signalName =
        WorkflowSignals.getWorkflowUserMessageSignalName(workflowId);

      await workflowHandle.signal(signalName, message);

      this.logger.log(`Sent user message signal to workflow ${workflowId}`, {
        messageType: message.type,
        signalName,
        timestamp: message.timestamp,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send user message signal to workflow ${workflowId}`,
        {
          error: error instanceof Error ? error.message : error,
          messageType: message.type,
        },
      );
      throw error;
    }
  }

  /**
   * Send skip to node signal to initiative refinement workflow
   */
  async sendSkipToNode(workflowId: WorkflowId, nodeId: string): Promise<void> {
    try {
      const workflowHandle = this.temporalClient.workflow.getHandle(workflowId);
      const signalName = WorkflowSignals.getSkipToNodeSignalName(workflowId);

      await workflowHandle.signal(signalName, {
        nodeId,
        systemMessageComplete: false,
      });

      this.logger.log(`Sent skip to node signal to workflow ${workflowId}`, {
        targetNodeId: nodeId,
        signalName,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send skip to node signal to workflow ${workflowId}`,
        {
          error: error instanceof Error ? error.message : error,
          targetNodeId: nodeId,
        },
      );
      throw error;
    }
  }
}
