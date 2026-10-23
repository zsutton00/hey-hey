import {
  InitiativeId,
  OrganizationId,
  ProjectId,
  TaskId,
  WorkflowId,
} from 'src/types';

export type TaskDependencyInferenceWorkflowInput = {
  organizationId: OrganizationId;
  projectId: ProjectId;
  initiativeId: InitiativeId;
  targetTaskIds: TaskId[];
  trigger?: 'task_created' | 'task_updated' | 'batch';
};

export type TaskDependencyInferenceRunResult = {
  workflowId: WorkflowId;
  inferredCount?: number;
  error?: string;
};
