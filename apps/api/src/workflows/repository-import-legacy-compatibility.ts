import { REPOSITORY_IMPORT_NODES, SHARED_NODES } from '../flows/constants';

const LEGACY_IMPORT_NODES = new Set<string>([
  ...Object.values(REPOSITORY_IMPORT_NODES),
  SHARED_NODES.GENERATE_FEATURES,
]);

export const REPOSITORY_IMPORT_FIRST_WORK_PATCH_ID =
  'repository-import-first-work-stage';

/**
 * Pure routing for the FINALIZE exit. Histories recorded before the patch, and
 * imports materialized before materialized Feature ids were recorded, keep
 * completing at END instead of entering the mandatory first-work stage.
 */
export function routeRepositoryImportAfterFinalize(input: {
  currentNodeId: string;
  nextNodeId: string;
  firstWorkPatched: () => boolean;
  context: unknown;
}): string {
  if (
    input.currentNodeId !== REPOSITORY_IMPORT_NODES.FINALIZE ||
    input.nextNodeId !== REPOSITORY_IMPORT_NODES.FIRST_WORK_QUESTION
  )
    return input.nextNodeId;
  const context = input.context as
    | { repositoryImportMaterializedFeatureIds?: unknown }
    | null
    | undefined;
  const materialized = context?.repositoryImportMaterializedFeatureIds;
  if (!input.firstWorkPatched()) return REPOSITORY_IMPORT_NODES.END;
  return Array.isArray(materialized) && materialized.length > 0
    ? input.nextNodeId
    : REPOSITORY_IMPORT_NODES.END;
}

export function isQualifyingLegacyRepositoryImportExecution(input: {
  conversationWorkflowName: string | null;
  executionFlowId: string;
  currentNode: string | null;
  flowState: unknown;
}): boolean {
  if (
    input.conversationWorkflowName !== 'onboarding' ||
    input.executionFlowId !== 'onboarding' ||
    !input.currentNode ||
    !LEGACY_IMPORT_NODES.has(input.currentNode)
  ) {
    return false;
  }

  const state = input.flowState;
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
  const context =
    'context' in state && state.context && typeof state.context === 'object'
      ? state.context
      : state;
  return (
    !!context &&
    typeof context === 'object' &&
    ('repositoryGrounding' in context ||
      'repositoryGroundingSeed' in context ||
      'repositoryGroundingPrerequisites' in context)
  );
}

export function resolveRepositoryImportFlowIdentity(input: {
  conversationWorkflowName: string | null;
  executionFlowId: string;
  currentNode: string | null;
  flowState: unknown;
}): 'repository-import' | null {
  if (input.conversationWorkflowName === 'repository-import') {
    return 'repository-import';
  }
  return isQualifyingLegacyRepositoryImportExecution(input)
    ? 'repository-import'
    : null;
}
