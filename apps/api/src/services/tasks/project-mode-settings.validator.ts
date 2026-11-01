import { Logger } from '@nestjs/common';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import { SessionRole, type ProjectModeSettings } from '../../generated';
import { projectModeSettingsJsonSchema } from '../../generated/project-mode-contract.schema';

export const PROJECT_MODE_SETTINGS_SECTION_KEY = 'settings';
export const PROJECT_MODE_SETTINGS_SCHEMA_REF =
  '#/components/schemas/ProjectModeSettings';

// A MODE authored before the settings section existed keeps Project
// Assistant on, matching the default every new MODE starts with.
export const DEFAULT_PROJECT_MODE_PROJECT_ASSISTANT_ENABLED = true;

const logger = new Logger('ProjectModeSettingsValidator');

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});

const validateSettingsStructure: ValidateFunction<ProjectModeSettings> =
  ajv.compile<ProjectModeSettings>(projectModeSettingsJsonSchema);

export type ProjectModeSettingsValidationResult =
  | { success: true; value: ProjectModeSettings; canonicalContent: string }
  | { success: false; message: string };

export function validateProjectModeSettingsContent(
  content: unknown,
): ProjectModeSettingsValidationResult {
  const parsed = parseJsonContent(content);
  if ('error' in parsed) {
    logger.warn('Rejected project MODE settings: unparseable JSON', {
      reason: parsed.error,
    });
    return { success: false, message: parsed.error };
  }
  if (!validateSettingsStructure(parsed.value)) {
    const message = formatStructuralIssues(validateSettingsStructure.errors);
    logger.warn('Rejected project MODE settings: schema violation', {
      reason: message,
    });
    return { success: false, message };
  }

  const keys = parsed.value.eligibleWorkItemTypeKeys;
  if (keys !== undefined && new Set(keys).size !== keys.length) {
    const message =
      '/eligibleWorkItemTypeKeys: must not contain duplicate keys';
    logger.warn('Rejected project MODE settings: duplicate eligible types', {
      reason: message,
    });
    return { success: false, message };
  }

  const value: ProjectModeSettings = {
    schemaVersion: parsed.value.schemaVersion,
    projectAssistant: { enabled: parsed.value.projectAssistant.enabled },
  };
  if (parsed.value.sessionRole !== undefined) {
    value.sessionRole = parsed.value.sessionRole;
  }
  // Absent stays absent: a MODE without the list keeps its legacy
  // type-level eligibility rather than being widened or narrowed here.
  if (keys !== undefined) {
    value.eligibleWorkItemTypeKeys = [...keys].sort();
  }
  logger.debug('Validated project MODE settings', {
    projectAssistantEnabled: value.projectAssistant.enabled,
    eligibleWorkItemTypeKeys: value.eligibleWorkItemTypeKeys,
  });
  return { success: true, value, canonicalContent: JSON.stringify(value) };
}

function parseJsonContent(
  content: unknown,
): { value: unknown } | { error: string } {
  if (typeof content !== 'string') return { value: content };
  try {
    return { value: JSON.parse(content) };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? `content is not valid JSON: ${error.message}`
          : 'content is not valid JSON',
    };
  }
}

function formatStructuralIssues(
  errors: ErrorObject[] | null | undefined,
): string {
  return (errors ?? [])
    .map((error) => {
      const path = error.instancePath || 'root';
      return `${path}: ${error.message ?? 'is invalid'}`;
    })
    .join('; ');
}

/**
 * Project-aware half of settings validation. The structural validator has no
 * project context, so every write path that knows the project must also call
 * this to reject keys absent from (or inactive in) the effective registry.
 */
export function findIneligibleProjectModeTypeKeys(
  settings: Pick<ProjectModeSettings, 'eligibleWorkItemTypeKeys'>,
  isTypeActive: (typeKey: string) => boolean,
): string[] {
  return (settings.eligibleWorkItemTypeKeys ?? []).filter(
    (typeKey) => !isTypeActive(typeKey),
  );
}

export function parseProjectModeSettingsOrNull(
  content: string | null | undefined,
): ProjectModeSettings | null {
  if (typeof content !== 'string' || content === '') return null;
  const result = validateProjectModeSettingsContent(content);
  return result.success ? result.value : null;
}

/** Resolve a mode's declared role without synthesizing a settings section. */
export function resolveProjectModeSessionRole(
  settings: ProjectModeSettings | null | undefined,
): SessionRole {
  return settings?.sessionRole ?? SessionRole.Implementation;
}
