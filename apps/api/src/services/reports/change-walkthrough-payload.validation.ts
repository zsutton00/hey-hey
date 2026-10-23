import { BadRequestException } from '@nestjs/common';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { ReportType, type ChangeWalkthroughReportPayload } from 'src/generated';
import { REPORT_SCHEMAS } from 'src/mcp/tools/report-schemas.generated';

const validate = addFormats(
  new Ajv({ allErrors: true, strict: false }),
).compile<ChangeWalkthroughReportPayload>(
  REPORT_SCHEMAS.CHANGE_WALKTHROUGH.schema,
);

/** HTTP and MCP submissions share this persistence boundary. */
export function validateChangeWalkthroughPayload(
  reportType: string,
  payload: unknown,
): ChangeWalkthroughReportPayload | undefined {
  if (
    reportType !== ReportType.ChangeWalkthrough &&
    typeof payload === 'object' &&
    payload !== null &&
    'reportType' in payload &&
    payload.reportType === ReportType.ChangeWalkthrough
  ) {
    throw new BadRequestException(
      'CHANGE_WALKTHROUGH payload requires CHANGE_WALKTHROUGH envelope type',
    );
  }
  if (reportType === ReportType.ChangeWalkthrough && !validate(payload)) {
    throw new BadRequestException('Invalid CHANGE_WALKTHROUGH payload');
  }
  return reportType === ReportType.ChangeWalkthrough
    ? (payload as ChangeWalkthroughReportPayload)
    : undefined;
}
