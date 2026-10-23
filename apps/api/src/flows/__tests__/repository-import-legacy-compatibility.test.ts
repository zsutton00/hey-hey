import {
  isQualifyingLegacyRepositoryImportExecution,
  resolveRepositoryImportFlowIdentity,
} from '../../workflows/repository-import-legacy-compatibility';
import { REPOSITORY_IMPORT_NODES } from '../constants';

describe('repository import legacy compatibility', () => {
  const legacy = {
    conversationWorkflowName: 'onboarding',
    executionFlowId: 'onboarding',
    currentNode: REPOSITORY_IMPORT_NODES.ANALYSIS,
    flowState: { context: { repositoryGrounding: { accepted: true } } },
  };

  it('maps only persisted onboarding executions with import node and state evidence', () => {
    expect(isQualifyingLegacyRepositoryImportExecution(legacy)).toBe(true);
    expect(resolveRepositoryImportFlowIdentity(legacy)).toBe(
      'repository-import',
    );
    expect(
      isQualifyingLegacyRepositoryImportExecution({
        ...legacy,
        currentNode: 'onboarding-clarify-concept',
      }),
    ).toBe(false);
    expect(
      isQualifyingLegacyRepositoryImportExecution({
        ...legacy,
        flowState: { context: {} },
      }),
    ).toBe(false);
  });

  it('accepts dedicated imports without opening the legacy path to new onboarding', () => {
    expect(
      resolveRepositoryImportFlowIdentity({
        conversationWorkflowName: 'repository-import',
        executionFlowId: 'repository-import',
        currentNode: REPOSITORY_IMPORT_NODES.PREREQUISITES,
        flowState: {},
      }),
    ).toBe('repository-import');
    expect(
      resolveRepositoryImportFlowIdentity({ ...legacy, currentNode: null }),
    ).toBeNull();
  });
});
