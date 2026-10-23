import { BadRequestException } from '@nestjs/common';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { ReportType, type ProjectReportPayload } from 'src/generated';
import { REPORT_SCHEMAS } from 'src/mcp/tools/report-schemas.generated';

const validate = addFormats(
  new Ajv({ allErrors: true, strict: false }),
).compile<ProjectReportPayload>(REPORT_SCHEMAS.PROJECT_REPORT.schema);

/** HTTP and MCP submissions share this persistence boundary. */
export function validateProjectReportPayload(
  reportType: string,
  payload: unknown,
): ProjectReportPayload | undefined {
  if (
    reportType !== ReportType.ProjectReport &&
    typeof payload === 'object' &&
    payload !== null &&
    'reportType' in payload &&
    payload.reportType === ReportType.ProjectReport
  ) {
    throw new BadRequestException(
      'PROJECT_REPORT payload requires PROJECT_REPORT envelope type',
    );
  }
  if (reportType === ReportType.ProjectReport && !validate(payload)) {
    throw new BadRequestException('Invalid PROJECT_REPORT payload');
  }
  return reportType === ReportType.ProjectReport
    ? (payload as ProjectReportPayload)
    : undefined;
}
