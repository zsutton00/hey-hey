import { BadRequestException } from '@nestjs/common';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type {
  CreateReportValidationFailure,
  CreateReportValidationIssue,
} from '@hey-hey/contracts/api/models';
import { REPORT_SCHEMAS } from 'src/mcp/tools/report-schemas.generated';

export const REPORT_PAYLOAD_INVALID_CODE = 'REPORT_PAYLOAD_INVALID';

/** Matches the persisted envelope metadata key stripped before schema checks. */
const REPORT_ENVELOPE_METADATA_KEY = '__reportEnvelope';

const MAX_REPORTED_ISSUES = 25;

type SchemaEntry = { schema: Record<string, unknown> };

interface ReportValidators {
  /** Present for versioned unions (e.g. FEATURE_SYNC_DECISION V1/V2). */
  readonly byVersion: ReadonlyMap<number, ValidateFunction> | null;
  /** Used by every non-versioned report type. */
  readonly single: ValidateFunction | null;
}

const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));

const MODEL_VERSION_SUFFIX = /V(\d+)$/u;

function isSchemaRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Versioned unions are generated with `x-schema-candidates` naming each model
 * `...V<n>`, aligned with `oneOf`. The envelope schemaVersion selects one.
 */
function compileVersionedUnion(
  schema: Record<string, unknown>,
): ReadonlyMap<number, ValidateFunction> {
  const candidates = schema['x-schema-candidates'];
  const variants = schema['oneOf'];
  if (!Array.isArray(candidates) || !Array.isArray(variants)) {
    throw new Error('Versioned report schema must list candidates and oneOf');
  }

  const byVersion = new Map<number, ValidateFunction>();
  candidates.forEach((candidate: unknown, index) => {
    const model = isSchemaRecord(candidate) ? candidate['model'] : undefined;
    const version = Number(
      typeof model === 'string'
        ? MODEL_VERSION_SUFFIX.exec(model)?.[1]
        : undefined,
    );
    const variant = variants[index];
    if (!Number.isInteger(version) || !isSchemaRecord(variant)) {
      throw new Error(
        `Versioned report schema candidate ${String(model)} has no version or schema`,
      );
    }
    byVersion.set(version, ajv.compile(variant));
  });
  return byVersion;
}

function compileValidators(entry: SchemaEntry): ReportValidators {
  if (entry.schema['x-schema-union'] === true) {
    return {
      byVersion: compileVersionedUnion(entry.schema),
      single: null,
    };
  }
  return { byVersion: null, single: ajv.compile(entry.schema) };
}

const VALIDATORS: ReadonlyMap<string, ReportValidators> = new Map(
  Object.entries(REPORT_SCHEMAS).map(([reportType, entry]) => [
    reportType,
    compileValidators(entry),
  ]),
);

/** Report types that have a generated payload schema, for coverage checks. */
export const SCHEMA_BACKED_REPORT_TYPES: readonly string[] = [
  ...VALIDATORS.keys(),
];

export class ReportPayloadValidationException extends BadRequestException {
  public readonly failure: CreateReportValidationFailure;

  public constructor(failure: CreateReportValidationFailure) {
    super({
      message: describeFailure(failure),
      code: REPORT_PAYLOAD_INVALID_CODE,
      data: failure,
    });
    this.failure = failure;
  }
}

function describeIssue(issue: CreateReportValidationIssue): string {
  if (issue.keyword === 'required' && issue.missingProperty !== undefined) {
    return `${issue.path}: missing required property "${issue.missingProperty}"`;
  }
  const allowed = issue.allowedValues
    ? ` (${issue.allowedValues.map((value) => JSON.stringify(value)).join(', ')})`
    : '';
  return `${issue.path}: ${issue.message}${allowed}`;
}

function describeFailure(failure: CreateReportValidationFailure): string {
  const shown = failure.issues.slice(0, MAX_REPORTED_ISSUES).map(describeIssue);
  const hidden = failure.issues.length - shown.length;
  const more = hidden > 0 ? `; and ${hidden} more` : '';
  return (
    `${failure.reportType} report (schemaVersion ${failure.schemaVersion}) is invalid: ` +
    `${shown.join('; ')}${more}. Correct the listed fields and submit the report again.`
  );
}

function appendPointer(base: string, segment: string): string {
  const escaped = segment.replace(/~/gu, '~0').replace(/\//gu, '~1');
  return `${base}/${escaped}`;
}

function toIssue(error: ErrorObject): CreateReportValidationIssue {
  const base = error.instancePath || '';
  if (error.keyword === 'required') {
    const missingProperty = String(error.params['missingProperty']);
    return {
      path: appendPointer(base, missingProperty),
      keyword: 'required',
      message: `must have required property '${missingProperty}'`,
      missingProperty,
    };
  }
  if (error.keyword === 'additionalProperties') {
    const extra = String(error.params['additionalProperty']);
    return {
      path: appendPointer(base, extra),
      keyword: 'additionalProperties',
      message: 'is not an allowed property',
    };
  }
  const allowedValues = error.params['allowedValues'];
  return {
    path: base || '/',
    keyword: error.keyword,
    message: error.message ?? 'is invalid',
    ...(Array.isArray(allowedValues) ? { allowedValues } : {}),
  };
}

function dedupe(
  issues: CreateReportValidationIssue[],
): CreateReportValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.path}|${issue.keyword}|${issue.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function withoutEnvelopeMetadata(payload: unknown): unknown {
  if (!isSchemaRecord(payload) || !(REPORT_ENVELOPE_METADATA_KEY in payload)) {
    return payload;
  }
  const { [REPORT_ENVELOPE_METADATA_KEY]: _metadata, ...rest } = payload;
  return rest;
}

function reject(
  reportType: string,
  schemaVersion: number,
  issues: CreateReportValidationIssue[],
): never {
  throw new ReportPayloadValidationException({
    reportType,
    schemaVersion,
    issues: dedupe(issues),
  });
}

/**
 * The single structural gate for every report write. Selects the generated
 * OpenAPI payload schema by envelope report type and effective schema version,
 * and throws ReportPayloadValidationException with field-level issues when the
 * payload, discriminator or version is invalid. Semantic rules stay with the
 * caller.
 */
export function validateReportPayload(input: {
  reportType: string;
  payload: unknown;
  schemaVersion: number;
}): void {
  const { reportType, schemaVersion } = input;
  const validators = VALIDATORS.get(reportType);
  if (!validators) {
    return reject(reportType, schemaVersion, [
      {
        path: '/',
        keyword: 'reportType',
        message: `no payload schema is registered for report type ${reportType}`,
      },
    ]);
  }

  const payload = withoutEnvelopeMetadata(input.payload);
  if (
    isSchemaRecord(payload) &&
    typeof payload['reportType'] === 'string' &&
    payload['reportType'] !== reportType
  ) {
    return reject(reportType, schemaVersion, [
      {
        path: '/reportType',
        keyword: 'reportTypeMismatch',
        message: `payload reportType "${payload['reportType']}" must match the envelope reportType "${reportType}"`,
        allowedValues: [reportType],
      },
    ]);
  }

  const validate =
    validators.byVersion?.get(schemaVersion) ?? validators.single;
  if (!validate) {
    const supported = [...(validators.byVersion?.keys() ?? [])];
    return reject(reportType, schemaVersion, [
      {
        path: '/schemaVersion',
        keyword: 'schemaVersion',
        message: `${reportType} supports schemaVersion ${supported.join(' or ')}`,
        allowedValues: supported,
      },
    ]);
  }

  if (!validate(payload)) {
    reject(reportType, schemaVersion, (validate.errors ?? []).map(toIssue));
  }
}
