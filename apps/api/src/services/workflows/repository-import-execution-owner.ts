import { isLocalApplication } from '../../deployment-environment';
import { WorkflowName } from '../../generated';

/** Deployment routing applies only to fresh executions; saved ownership wins on resume. */
export function repositoryImportExecutionOwner(
  workflowName: string,
): 'CLI' | 'TEMPORAL' {
  return workflowName === WorkflowName.RepositoryImport && isLocalApplication()
    ? 'CLI'
    : 'TEMPORAL';
}

/** Pre-cutover import executions did not record an explicit owner. */
export function isLocalRepositoryImportExecutionOwner(
  owner: 'CLI' | 'TEMPORAL' | undefined,
): boolean {
  return owner === 'CLI' || (owner === undefined && isLocalApplication());
}
