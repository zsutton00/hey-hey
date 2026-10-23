export class ConversationWorkflowError extends Error {
  constructor(
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ConversationWorkflowError';
  }
}

export class UnsupportedWorkflowTypeError extends ConversationWorkflowError {
  constructor(
    message: string,
    public readonly workflowType?: string,
  ) {
    super(message, { workflowType });
    this.name = 'UnsupportedWorkflowTypeError';
  }
}

export class WorkflowStartError extends ConversationWorkflowError {
  constructor(
    message: string,
    public readonly workflowId?: string,
  ) {
    super(message, { workflowId });
    this.name = 'WorkflowStartError';
  }
}
