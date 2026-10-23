import { UIElement } from '../../generated';
import { RepositoryImportReplyFormValidator } from '../repository-import-reply-form-validator';

describe('RepositoryImportReplyFormValidator', () => {
  const validator = new RepositoryImportReplyFormValidator();

  it('accepts complete repository runtime selection without the retired usage class', () => {
    const repositoryField: UIElement[] = [
      {
        id: 'repository_grounding',
        type: 'repository_grounding',
        label: 'Repository analysis',
        required: true,
      },
    ];

    expect(() =>
      validator.assertCompleteAnswers(repositoryField, {
        repository_prerequisites: {
          entryMode: 'new_project',
          serviceId: 'service-1',
          confirmedServiceBrief: 'Owns the public API.',
          machineId: 'machine-1',
        },
        repository_analysis_configuration: {
          scope: { scope: 'comprehensive' },
          provider: 'codex',
          resolvedFrontierModel: 'gpt-5.4',
          reasoningEffort: 'high',
          fastMode: true,
          bounds: {
            maxFiles: 5000,
            maxTotalBytes: 25000000,
            maxFileBytes: 1000000,
            maxDepth: 12,
            maxGeneratedFiles: 1000,
            maxIgnoredFiles: 1000,
            maxUnsupportedFiles: 1000,
            maxBinaryFiles: 1000,
          },
        },
        repository_grounding_action: 'START_ANALYSIS',
      }),
    ).not.toThrow();
  });
});
