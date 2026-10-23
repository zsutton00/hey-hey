import type { RepositoryImportFlowContext } from '../../../types/flow-internal.types';

export function shouldCollectRepositoryPlacement(
  context: Readonly<RepositoryImportFlowContext>,
): boolean {
  return (
    context.repositoryGroundingCompletion?.outcome === 'success' &&
    context.repositoryGrounding?.prerequisites.entryMode === 'existing_project'
  );
}
