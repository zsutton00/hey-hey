import {
  findIneligibleProjectModeTypeKeys,
  resolveProjectModeSessionRole,
  parseProjectModeSettingsOrNull,
  PROJECT_MODE_SETTINGS_SCHEMA_REF,
  validateProjectModeSettingsContent,
} from '../project-mode-settings.validator';
import { TaskSectionSchemaValidatorRegistry } from '../task-section-schema-validator.registry';

describe('project MODE settings schema', () => {
  const definition = {
    key: 'settings',
    label: 'Session settings',
    kind: 'json' as const,
    schemaRef: PROJECT_MODE_SETTINGS_SCHEMA_REF,
  };

  it.each(['implementation', 'research', 'planning', 'review'])(
    'retains the %s role and existing settings for multiple modes',
    (sessionRole) => {
      const content = {
        schemaVersion: 'project-mode-settings.v1',
        projectAssistant: { enabled: false },
        eligibleWorkItemTypeKeys: ['BUG'],
        sessionRole,
      };
      for (let mode = 0; mode < 2; mode++) {
        const result = validateProjectModeSettingsContent(content);
        expect(result.success).toBe(true);
        if (!result.success) throw new Error(result.message);
        expect(result.value).toEqual(content);
        expect(resolveProjectModeSessionRole(result.value)).toBe(sessionRole);
        expect(parseProjectModeSettingsOrNull(result.canonicalContent)).toEqual(
          content,
        );
      }
    },
  );

  it.each(['unknown', '', null, 42, false, [], {}])(
    'rejects invalid sessionRole %j at the shared boundary',
    (sessionRole) => {
      expect(
        new TaskSectionSchemaValidatorRegistry().validate(definition, {
          schemaVersion: 'project-mode-settings.v1',
          projectAssistant: { enabled: true },
          sessionRole,
        }),
      ).toMatchObject({ success: false, code: 'invalid_json_section' });
    },
  );

  it('defaults missing roles and settings to implementation without adding a section', () => {
    expect(resolveProjectModeSessionRole(undefined)).toBe('implementation');
    expect(resolveProjectModeSessionRole(null)).toBe('implementation');
    const settings = parseProjectModeSettingsOrNull(
      JSON.stringify({
        schemaVersion: 'project-mode-settings.v1',
        projectAssistant: { enabled: false },
      }),
    );
    expect(resolveProjectModeSessionRole(settings)).toBe('implementation');
    expect(settings).not.toHaveProperty('eligibleWorkItemTypeKeys');
    expect(settings).not.toHaveProperty('sessionRole');
  });

  it.each([true, false])(
    'canonicalizes Project Assistant enabled=%s through the shared registry',
    (enabled) => {
      const result = new TaskSectionSchemaValidatorRegistry().validate(
        definition,
        JSON.stringify({
          projectAssistant: { enabled },
          schemaVersion: 'project-mode-settings.v1',
        }),
      );

      expect(result).toEqual({
        success: true,
        canonicalContent: `{"schemaVersion":"project-mode-settings.v1","projectAssistant":{"enabled":${enabled}}}`,
      });
    },
  );

  it('canonicalizes a per-MODE eligible type list in sorted order', () => {
    const result = new TaskSectionSchemaValidatorRegistry().validate(
      definition,
      JSON.stringify({
        schemaVersion: 'project-mode-settings.v1',
        projectAssistant: { enabled: false },
        eligibleWorkItemTypeKeys: ['STANDARD', 'BUG'],
      }),
    );

    expect(result).toEqual({
      success: true,
      canonicalContent:
        '{"schemaVersion":"project-mode-settings.v1","projectAssistant":{"enabled":false},"eligibleWorkItemTypeKeys":["BUG","STANDARD"]}',
    });
  });

  it('keeps an absent eligible type list absent so legacy eligibility applies', () => {
    const result = validateProjectModeSettingsContent({
      schemaVersion: 'project-mode-settings.v1',
      projectAssistant: { enabled: true },
    });

    expect(result.success && 'eligibleWorkItemTypeKeys' in result.value).toBe(
      false,
    );
  });

  it('reports keys that are not active in the effective registry', () => {
    expect(
      findIneligibleProjectModeTypeKeys(
        { eligibleWorkItemTypeKeys: ['BUG', 'RETIRED', 'STANDARD'] },
        (key) => key !== 'RETIRED',
      ),
    ).toEqual(['RETIRED']);
    expect(findIneligibleProjectModeTypeKeys({}, () => false)).toEqual([]);
  });

  it.each([
    [
      'empty eligible type list',
      {
        schemaVersion: 'project-mode-settings.v1',
        projectAssistant: { enabled: true },
        eligibleWorkItemTypeKeys: [],
      },
    ],
    [
      'duplicate eligible type keys',
      {
        schemaVersion: 'project-mode-settings.v1',
        projectAssistant: { enabled: true },
        eligibleWorkItemTypeKeys: ['BUG', 'BUG'],
      },
    ],
    [
      'blank eligible type key',
      {
        schemaVersion: 'project-mode-settings.v1',
        projectAssistant: { enabled: true },
        eligibleWorkItemTypeKeys: [''],
      },
    ],
    ['missing projectAssistant', { schemaVersion: 'project-mode-settings.v1' }],
    [
      'string enabled',
      {
        schemaVersion: 'project-mode-settings.v1',
        projectAssistant: { enabled: 'true' },
      },
    ],
    [
      'authority flags',
      {
        schemaVersion: 'project-mode-settings.v1',
        projectAssistant: { enabled: true, allowEdgeUpdates: true },
      },
    ],
    [
      'unknown top-level key',
      {
        schemaVersion: 'project-mode-settings.v1',
        projectAssistant: { enabled: true },
        toolGrants: ['Bash'],
      },
    ],
    [
      'unknown version',
      {
        schemaVersion: 'project-mode-settings.v2',
        projectAssistant: { enabled: true },
      },
    ],
    ['invalid JSON', '{"schemaVersion":'],
  ])('rejects %s before persistence', (_label, content) => {
    expect(validateProjectModeSettingsContent(content).success).toBe(false);
    expect(
      new TaskSectionSchemaValidatorRegistry().validate(definition, content),
    ).toMatchObject({ success: false, code: 'invalid_json_section' });
  });
});
