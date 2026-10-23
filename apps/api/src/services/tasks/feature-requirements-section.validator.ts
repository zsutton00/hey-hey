import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type {
  FeatureRequirementContractCitation,
  FeatureRequirementDesignCitation,
  FeatureRequirementFulfillmentCitation,
} from '../../generated';
import type { FeatureRequirementsSection } from '../../generated/model/featureRequirementsSection';
import { featureRequirementsJsonSchema } from '../../generated/feature-requirements.schema';
import { canonicalize } from './feature-requirement-authoring.schemas';

export const FEATURE_REQUIREMENTS_SCHEMA_REF =
  '#/components/schemas/FeatureRequirementsSection';

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
addFormats(ajv);

/**
 * A collection between authoring and title resolution: citations taken from
 * authoring input carry no `entityTitle` until the server resolves it.
 */
export interface FeatureRequirementDraftRecord {
  id: string;
  statement: string;
  group?: string;
  designedBy: Array<
    FeatureRequirementDesignCitation & { entityTitle?: string }
  >;
  fulfilledBy: Array<
    FeatureRequirementFulfillmentCitation & { entityTitle?: string }
  >;
  contracts: Array<
    FeatureRequirementContractCitation & { entityTitle?: string }
  >;
}

export interface FeatureRequirementsDraftSection {
  records: FeatureRequirementDraftRecord[];
}

// The draft schema is the persisted schema with only the server-owned title
// relaxed, so every other structural rule stays shared.
const withoutRequiredTitle = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutRequiredTitle);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === 'required' && Array.isArray(child)
        ? child.filter((name) => name !== 'entityTitle')
        : withoutRequiredTitle(child),
    ]),
  );
};

const validateStructure: ValidateFunction<FeatureRequirementsSection> =
  ajv.compile(featureRequirementsJsonSchema);
const validateDraftStructure: ValidateFunction<FeatureRequirementsDraftSection> =
  ajv.compile<FeatureRequirementsDraftSection>(
    withoutRequiredTitle(featureRequirementsJsonSchema) as object,
  );

export type FeatureRequirementsValidationResult<
  T extends FeatureRequirementsDraftSection = FeatureRequirementsSection,
> =
  | {
      success: true;
      value: T;
      canonicalContent: string;
      warnings: string[];
    }
  | { success: false; message: string };

/** Validate a persisted collection; every citation must carry its title. */
export function validateFeatureRequirementsSection(
  content: unknown,
): FeatureRequirementsValidationResult {
  return validateWith(validateStructure, content);
}

/** Validate a collection whose new citations are still awaiting titles. */
export function validateFeatureRequirementsDraft(
  content: unknown,
): FeatureRequirementsValidationResult<FeatureRequirementsDraftSection> {
  return validateWith(validateDraftStructure, content);
}

function validateWith<T extends FeatureRequirementsDraftSection>(
  validateStructure: ValidateFunction<T>,
  content: unknown,
): FeatureRequirementsValidationResult<T> {
  let value: unknown = content;
  if (typeof content === 'string') {
    try {
      value = JSON.parse(content);
    } catch (error) {
      return {
        success: false,
        message: `content is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  if (!validateStructure(value)) {
    return { success: false, message: formatErrors(validateStructure.errors) };
  }
  const ids = new Map<string, number>();
  const statements = new Map<string, number>();
  const issues: string[] = [];
  const warnings: string[] = [];
  value.records.forEach((record, index) => {
    const priorId = ids.get(record.id);
    if (priorId !== undefined)
      issues.push(`/records/${index}/id duplicates /records/${priorId}/id`);
    else ids.set(record.id, index);
    const key = canonicalize(record.statement);
    const priorStatement = statements.get(key);
    if (priorStatement !== undefined) {
      issues.push(
        `/records/${index}/statement duplicates /records/${priorStatement}/statement after canonical comparison`,
      );
    } else statements.set(key, index);
    if (
      record.designedBy.length +
        record.fulfilledBy.length +
        record.contracts.length ===
      0
    ) {
      warnings.push(`/records/${index} has no citations`);
    }
  });
  if (issues.length) return { success: false, message: issues.join('; ') };
  return {
    success: true,
    value,
    canonicalContent: JSON.stringify(value),
    warnings,
  };
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map(
      (error) =>
        `${error.instancePath || '/'}: ${error.message ?? 'is invalid'}`,
    )
    .join('; ');
}
