import type {
  FeatureRequirementRecord,
  FeatureRequirementStoredCitation,
  FeatureRequirementsSection,
} from '../../generated';
import { validateFeatureRequirementsSection } from './feature-requirements-section.validator';

export type FeatureRequirementsReadState =
  | 'absent'
  | 'empty'
  | 'present'
  | 'malformed';

export type FeatureRequirementsReadResult =
  | {
      state: 'absent';
      section?: undefined;
      canonicalContent?: undefined;
      error?: undefined;
    }
  | {
      state: 'empty' | 'present';
      section: FeatureRequirementsSection;
      canonicalContent: string;
      error?: undefined;
    }
  | {
      state: 'malformed';
      section?: undefined;
      canonicalContent?: undefined;
      error: FeatureRequirementsReadError;
    };

export type FeatureRequirementsReadErrorCode =
  | 'empty_content'
  | 'invalid_content';

/** Canonical empty collection used when a new FEATURE has no records yet. */
export const EMPTY_FEATURE_REQUIREMENTS_CONTENT = '{"records":[]}';

/**
 * A stored requirements section failed the schema-backed read boundary.
 *
 * The error deliberately contains only a diagnostic and never the source
 * payload. Callers can safely include its code and message in boundary logs.
 */
export class FeatureRequirementsReadError extends Error {
  constructor(
    readonly code: FeatureRequirementsReadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FeatureRequirementsReadError';
  }
}

/**
 * Inspect a persisted requirements section without doing any I/O or legacy
 * markdown parsing. `undefined` and `null` mean the section is absent. A
 * schema-valid collection with no records is explicitly `empty`; blank text
 * is malformed because it is not a canonical JSON section.
 */
export function inspectFeatureRequirementsSection(
  content: unknown,
): FeatureRequirementsReadResult {
  if (content === undefined || content === null) {
    return { state: 'absent' };
  }

  if (typeof content === 'string' && content.trim().length === 0) {
    return {
      state: 'malformed',
      error: new FeatureRequirementsReadError(
        'empty_content',
        'Feature requirements section content is empty; expected canonical JSON.',
      ),
    };
  }

  const validation = validateFeatureRequirementsSection(content);
  if (!validation.success) {
    return {
      state: 'malformed',
      error: new FeatureRequirementsReadError(
        'invalid_content',
        `Feature requirements section is invalid: ${validation.message}`,
      ),
    };
  }

  return {
    state: validation.value.records.length === 0 ? 'empty' : 'present',
    section: validation.value,
    canonicalContent: validation.canonicalContent,
  };
}

/**
 * Read a schema-backed section at a consumer boundary.
 *
 * Missing sections stay absent. Empty collections are returned as an object;
 * malformed or blank materialized content fails fast so a caller cannot
 * silently fall back to legacy markdown.
 */
export function readFeatureRequirementsSection(
  content: unknown,
): FeatureRequirementsSection | undefined {
  const result = inspectFeatureRequirementsSection(content);
  if (result.state === 'malformed') {
    throw result.error;
  }
  return result.section;
}

/**
 * Return the canonical JSON envelope for a present section while preserving
 * the record and citation order validated by the shared OpenAPI schema.
 */
export function readCanonicalFeatureRequirementsContent(
  content: unknown,
): string | undefined {
  const result = inspectFeatureRequirementsSection(content);
  if (result.state === 'malformed') {
    throw result.error;
  }
  return result.canonicalContent;
}

function formatCitation(citation: FeatureRequirementStoredCitation): string {
  return `${citation.entityTitle} (${citation.entityType}:${citation.entityId})`;
}

function formatCitationRole(
  label: string,
  citations: readonly FeatureRequirementStoredCitation[],
): string | undefined {
  if (citations.length === 0) return undefined;
  return `${label}: ${citations.map(formatCitation).join(', ')}`;
}

function formatRecord(record: FeatureRequirementRecord): string {
  const lines = [`Statement: ${record.statement}`];
  if (record.group !== undefined) {
    lines.push(`Group: ${record.group}`);
  }

  const roles = [
    formatCitationRole('Designed by', record.designedBy),
    formatCitationRole('Fulfilled by', record.fulfilledBy),
    formatCitationRole('Contracts', record.contracts),
  ];
  lines.push(...roles.filter((role): role is string => role !== undefined));
  return lines.join('\n');
}

/**
 * Format the validated collection for lexical discovery. The output keeps
 * record order, names groups explicitly, labels citation roles separately,
 * and never exposes JSON punctuation or reconstructs legacy markdown.
 *
 * An absent or valid empty collection contributes no lexical text. That lets
 * a cleared collection disappear from search content instead of leaving a
 * serialized projection behind.
 */
export function formatFeatureRequirementsForDiscovery(
  content: unknown,
): string | undefined {
  const section = readFeatureRequirementsSection(content);
  if (!section || section.records.length === 0) return undefined;
  return section.records.map(formatRecord).join('\n\n');
}

// Search callers historically use both names while the read boundary is being
// migrated. Keep the aliases pure and pointed at the same implementation.
export const formatFeatureRequirementsForSearch =
  formatFeatureRequirementsForDiscovery;
export const readFeatureRequirements = readFeatureRequirementsSection;
