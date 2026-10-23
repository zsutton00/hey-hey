import { BadRequestException } from '@nestjs/common';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { ReportType, type CodingResearchReportPayload } from 'src/generated';
import { REPORT_SCHEMAS } from 'src/mcp/tools/report-schemas.generated';

const validate = addFormats(
  new Ajv({ allErrors: true, strict: false }),
).compile<CodingResearchReportPayload>(REPORT_SCHEMAS.CODING_RESEARCH.schema);

/** HTTP, MCP, and internal submissions share this persistence boundary. */
export function validateCodingResearchPayload(
  reportType: string,
  payload: unknown,
): CodingResearchReportPayload | undefined {
  if (
    reportType !== ReportType.CodingResearch &&
    typeof payload === 'object' &&
    payload !== null &&
    'reportType' in payload &&
    payload.reportType === ReportType.CodingResearch
  ) {
    throw new BadRequestException(
      'CODING_RESEARCH payload requires CODING_RESEARCH envelope type',
    );
  }
  if (reportType !== ReportType.CodingResearch) {
    return undefined;
  }
  if (!validate(payload)) {
    const issues = (validate.errors ?? []).map(
      (error) => `${error.instancePath || '/'} ${error.message}`,
    );
    throw new BadRequestException(
      `Invalid CODING_RESEARCH payload: ${issues.join('; ')}. Revise and resubmit the report.`,
    );
  }
  return payload;
}
