export interface WorkflowState {
  status:
    | "waiting_for_user"
    | "system_processing"
    | "completed"
    | "failed"
    | "ready"
    | "loading";
  message: string;
  canSubmit: boolean;
  showLoader: boolean;
  processingUser?: string;
}

export interface WorkflowMetadata {
  currentProcessor?: string;
  submittedAt?: string;
  processingTimeout?: string;
}
