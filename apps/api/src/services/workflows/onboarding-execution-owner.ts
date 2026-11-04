import { isLocalApplication } from '../../deployment-environment';
import { WorkflowName } from '../../generated';

/** Deployment routing applies only to fresh executions; saved ownership wins on resume. */
export function onboardingExecutionOwner(
  workflowName: string,
): 'CLI' | 'TEMPORAL' {
  return workflowName === WorkflowName.Onboarding && isLocalApplication()
    ? 'CLI'
    : 'TEMPORAL';
}
