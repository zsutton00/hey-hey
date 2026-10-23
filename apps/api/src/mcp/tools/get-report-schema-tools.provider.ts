import { Injectable, Logger } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  REPORT_SCHEMAS,
  type ReportSchemaKey,
} from './report-schemas.generated';
import { mcpError } from './mcp-tool.utils';

const REPORT_TYPE_KEYS = Object.keys(REPORT_SCHEMAS) as [
  ReportSchemaKey,
  ...ReportSchemaKey[],
];

const getReportSchemaParameters = z.object({
  reportType: z
    .enum(REPORT_TYPE_KEYS)
    .describe(
      'Discriminator value identifying which report payload variant to return. ' +
        'Must be one of: ' +
        REPORT_TYPE_KEYS.join(', '),
    ),
});

@Injectable()
export class GetReportSchemaToolsProvider {
  private readonly logger = new Logger(GetReportSchemaToolsProvider.name);

  @Tool({
    name: 'get_report_schema',
    description:
      'Returns the JSON Schema and human-readable description for a single ' +
      'report payload variant, keyed by reportType. Read-only: this tool does ' +
      'not terminate the turn, so it can be called immediately before ' +
      'authoring a report through the approved submission or REST path to ' +
      'look up the exact payload shape required for that report type.',
    parameters: getReportSchemaParameters,
  })
  async getReportSchema(
    params: z.infer<typeof getReportSchemaParameters>,
    _context: Context,
  ): Promise<CallToolResult> {
    const { reportType } = params;
    this.logger.debug('get_report_schema called', { reportType });

    const entry = REPORT_SCHEMAS[reportType as ReportSchemaKey];
    if (!entry) {
      this.logger.warn(
        `get_report_schema lookup miss for reportType=${reportType}`,
      );
      return mcpError(`Unknown reportType: ${reportType}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { schema: entry.schema, description: entry.description },
            null,
            2,
          ),
        },
      ],
    };
  }
}
