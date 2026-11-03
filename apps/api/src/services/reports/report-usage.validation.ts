import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { ReportUsageMeasurement } from '@hey-hey/contracts/api/models';
import { REPORT_USAGE_SCHEMA } from 'src/mcp/tools/report-schemas.generated';

const validate = addFormats(
  new Ajv({ allErrors: true, strict: false }),
).compile<ReportUsageMeasurement>(REPORT_USAGE_SCHEMA);

/** Validate untrusted HTTP input and stored JSON against the versioned OpenAPI shape. */
export function readReportUsage(value: unknown): ReportUsageMeasurement | null {
  if (!validate(value)) {
    return null;
  }
  return value;
}
