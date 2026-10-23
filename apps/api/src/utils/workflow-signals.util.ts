/**
 * WorkflowSignals utility for generating workflow-specific signal names
 * Ensures signal isolation between different workflow instances
 */
export class WorkflowSignals {
  // Signal constants for different workflow types
  static readonly ONBOARDING_USER_MESSAGE = 'onboardingUserMessage';
  static readonly SUPPORT_USER_MESSAGE = 'supportUserMessage';
  static readonly ANALYSIS_USER_MESSAGE = 'analysisUserMessage';

  static getAgentExecutionResultSignalName(workflowId: string): string {
    return `agentExecutionResult-${workflowId}`;
  }

  static getWorkflowUserMessageSignalName(workflowId: string): string {
    return `userMessage-${workflowId}`;
  }

  static getWorkflowAnswerSignalName(workflowId: string): string {
    return `workflowAnswer-${workflowId}`;
  }

  static getStartRunKickoffSignalName(workflowId: string): string {
    return `startRunKickoff-${workflowId}`;
  }

  static getLLMResponseSignalName(workflowId: string): string {
    return `llmResponse-${workflowId}`;
  }

  static getWorkflowCompletionSignalName(workflowId: string): string {
    return `workflowCompletion-${workflowId}`;
  }

  static getSkipToNodeSignalName(workflowId: string): string {
    return `skipToNode-${workflowId}`;
  }

  static getReplayNodeSignalName(workflowId: string): string {
    return `replayNode-${workflowId}`;
  }
}
