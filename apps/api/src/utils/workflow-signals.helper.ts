import { WorkflowHandle } from '@temporalio/client';
import { FlowUserMessage } from '../types/flow-internal.types';
import { WorkflowSignals } from './workflow-signals.util';
import { WorkflowId } from '../types';

/**
 * Helper class for sending signals to conversation flow workflows.
 * Signals are dynamically scoped to the specific workflow instance using workflowId.
 */
export class WorkflowSignalHelper {
  /**
   * Send a user message signal to a specific workflow instance
   */
  static async sendUserMessage(
    workflowHandle: WorkflowHandle,
    workflowId: WorkflowId,
    message: FlowUserMessage,
  ): Promise<void> {
    const signalName =
      WorkflowSignals.getWorkflowUserMessageSignalName(workflowId);
    await workflowHandle.signal(signalName, message);
  }

  /**
   * Send a skip to node signal to a specific workflow instance
   */
  static async sendSkipToNode(
    workflowHandle: WorkflowHandle,
    workflowId: WorkflowId,
    nodeId: string,
    systemMessageComplete?: boolean,
  ): Promise<void> {
    const signalPayload = { nodeId, systemMessageComplete };
    const signalName = WorkflowSignals.getSkipToNodeSignalName(workflowId);
    await workflowHandle.signal(signalName, signalPayload);
  }

  /**
   * Send a replay node signal to restart the current node from the questions phase
   */
  static async sendReplayNode(
    workflowHandle: WorkflowHandle,
    workflowId: WorkflowId,
  ): Promise<void> {
    const signalName = WorkflowSignals.getReplayNodeSignalName(workflowId);
    await workflowHandle.signal(signalName);
  }

  /**
   * Send a complete flow signal to a specific workflow instance
   */
  static async sendCompleteFlow(
    workflowHandle: WorkflowHandle,
    workflowId: WorkflowId,
  ): Promise<void> {
    await workflowHandle.signal(`completeFlow-${workflowId}`);
  }

  /**
   * Get the signal names for a specific workflow
   */
  static getSignalNames(workflowId: WorkflowId) {
    return {
      userMessage: WorkflowSignals.getWorkflowUserMessageSignalName(workflowId),
      skipToNode: WorkflowSignals.getSkipToNodeSignalName(workflowId),
      replayNode: WorkflowSignals.getReplayNodeSignalName(workflowId),
      completeFlow: `completeFlow-${workflowId}`,
      llmResponse: WorkflowSignals.getLLMResponseSignalName(workflowId),
    };
  }
}
