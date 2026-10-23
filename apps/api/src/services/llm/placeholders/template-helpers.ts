import { PlaceholderDefinition } from './base/placeholder-definition';
import { PlaceholderRegistry } from './base/placeholder-registry';

export interface TemplateValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  usedPlaceholders: string[];
}

/**
 * Builds a template string with type-safe placeholder validation
 * @param strings Template literal strings
 * @param placeholders Placeholder definitions to insert
 * @returns Complete template string
 */
export function buildTemplate(
  strings: TemplateStringsArray,
  ...placeholders: PlaceholderDefinition[]
): string {
  const initial = strings[0];
  if (initial === undefined) {
    throw new Error('Template literal missing initial segment');
  }
  let result = initial;

  for (let i = 0; i < placeholders.length; i++) {
    const placeholder = placeholders[i];
    if (!placeholder) {
      throw new Error('Missing placeholder definition');
    }
    const next = strings[i + 1];
    if (next === undefined) {
      throw new Error('Template literal missing segment');
    }
    // Insert the placeholder key wrapped in the template format
    result += `{{${placeholder.key}}}` + next;
  }

  return result;
}

/**
 * Validates a template against a placeholder registry
 * @param template Template string to validate
 * @param registry Placeholder registry to check against
 * @returns Validation result with errors and warnings
 */
export function validateTemplate(
  template: string,
  registry: PlaceholderRegistry,
): TemplateValidationResult {
  const result: TemplateValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
    usedPlaceholders: [],
  };

  // Find all placeholder patterns in template
  const doubleBraceMatches = template.match(/\{\{([^}]+)\}\}/g) || [];
  const singleBraceMatches = template.match(/\{([^{}]+)\}/g) || [];

  const allMatches = [
    ...doubleBraceMatches.map((match) => match.slice(2, -2)), // Remove {{ }}
    ...singleBraceMatches.map((match) => match.slice(1, -1)), // Remove { }
  ];

  for (const placeholderKey of allMatches) {
    result.usedPlaceholders.push(placeholderKey);

    if (!registry.has(placeholderKey)) {
      result.errors.push(`Unknown placeholder: ${placeholderKey}`);
      result.isValid = false;
    }
  }

  // Check for potential issues
  if (doubleBraceMatches.length > 0 && singleBraceMatches.length > 0) {
    result.warnings.push(
      'Template uses mixed placeholder formats ({{ }} and { }). Consider standardizing on double braces.',
    );
  }

  return result;
}

/**
 * Checks if a template uses the new type-safe format
 * @param template Template string to check
 * @returns True if template uses ${StandardPlaceholders.*} format
 */
export function usesNewFormat(template: string): boolean {
  return (
    template.includes('${StandardPlaceholders.') ||
    template.includes('${InitiativeRefinementPlaceholders.')
  );
}

/**
 * Extracts placeholder keys from a template
 * @param template Template string
 * @returns Array of placeholder keys found in the template
 */
export function extractPlaceholderKeys(template: string): string[] {
  const doubleBraceMatches = template.match(/\{\{([^}]+)\}\}/g) || [];
  const singleBraceMatches = template.match(/\{([^{}]+)\}/g) || [];

  return [
    ...doubleBraceMatches.map((match) => match.slice(2, -2)), // Remove {{ }}
    ...singleBraceMatches.map((match) => match.slice(1, -1)), // Remove { }
  ];
}

/**
 * Creates a template migration report
 * @param oldTemplate Original template
 * @param newTemplate Migrated template
 * @param registry Registry to validate against
 * @returns Migration report
 */
export function createMigrationReport(
  oldTemplate: string,
  newTemplate: string,
  registry: PlaceholderRegistry,
): {
  oldPlaceholders: string[];
  newPlaceholders: string[];
  validation: TemplateValidationResult;
  migrated: boolean;
} {
  const oldPlaceholders = extractPlaceholderKeys(oldTemplate);
  const newPlaceholders = extractPlaceholderKeys(newTemplate);
  const validation = validateTemplate(newTemplate, registry);

  return {
    oldPlaceholders,
    newPlaceholders,
    validation,
    migrated: usesNewFormat(newTemplate),
  };
}
