import {
  PROJECT_MODE_FILES_SCHEMA_REF,
  validateProjectModeFilesContent,
} from '../project-mode-files.validator';
import { TaskSectionSchemaValidatorRegistry } from '../task-section-schema-validator.registry';

describe('project MODE files schema', () => {
  const definition = {
    key: 'files',
    label: 'Files',
    kind: 'json' as const,
    schemaRef: PROJECT_MODE_FILES_SCHEMA_REF,
  };

  it('canonicalizes safe paths deterministically through the shared registry', () => {
    const result = new TaskSectionSchemaValidatorRegistry().validate(
      definition,
      {
        files: {
          'references/checklist.md': 'Check it',
          'MODE.md': 'Start here',
        },
        schemaVersion: 'project-mode-files.v1',
      },
    );

    expect(result).toEqual({
      success: true,
      canonicalContent:
        '{"schemaVersion":"project-mode-files.v1","files":{"MODE.md":"Start here","references/checklist.md":"Check it"}}',
    });
  });

  it.each([
    [{ schemaVersion: 'project-mode-files.v1', files: {} }],
    [
      {
        schemaVersion: 'project-mode-files.v1',
        files: { 'MODE.md': 'ok', '../escape.md': 'no' },
      },
    ],
    [
      {
        schemaVersion: 'project-mode-files.v1',
        files: { 'MODE.md': '', extra: 42 },
      },
    ],
  ])('rejects malformed file bundles before persistence', (content) => {
    expect(validateProjectModeFilesContent(content).success).toBe(false);
  });
});
