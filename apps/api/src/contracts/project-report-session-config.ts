import { BadRequestException } from '@nestjs/common';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { AgentSessionConfigProjectReportV1 } from 'src/generated';
import { projectReportSchemas } from 'src/generated/project-report.schemas';

const validate = addFormats(
  new Ajv({ strict: false, allErrors: true }),
).compile<AgentSessionConfigProjectReportV1>(
  projectReportSchemas.AgentSessionConfigProjectReportV1,
);

export function parseProjectReportSessionConfig(
  value: unknown,
): AgentSessionConfigProjectReportV1 {
  if (!validate(value))
    throw new BadRequestException('Invalid PROJECT_REPORT session config');
  return value;
}
