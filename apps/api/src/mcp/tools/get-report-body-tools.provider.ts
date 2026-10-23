import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Request } from 'express';
import { ReportService } from '../../services/reports/report.service';
import { extractAuthContext, isAuthContext, mcpError } from './mcp-tool.utils';

const getReportBodyParameters = z.object({
  reportId: z
    .string()
    .uuid()
    .describe(
      'UUID of the Report to fetch. Typically obtained from a ' +
        '@[report:<id>|<title>] mention or a prior search result.',
    ),
});

@Injectable()
export class GetReportBodyToolsProvider {
  private readonly logger = new Logger(GetReportBodyToolsProvider.name);

  constructor(private readonly reportService: ReportService) {}

  @Tool({
    name: 'get_report_body',
    description:
      'Resolve a Report mention to its full body. Returns the complete ' +
      'ReportPayload along with metadata (audience, createdAt, ' +
      'sourceExecutionId, parentReportId, related entities, etc.). ' +
      'Read-only: this tool does not terminate the turn, so it can be ' +
      'called inline when an agent encounters an @[report:<id>|<title>] ' +
      'reference and needs the underlying content. Returns an authorization-' +
      'shaped error if the report is not visible to the caller.',
    parameters: getReportBodyParameters,
  })
  async getReportBody(
    params: z.infer<typeof getReportBodyParameters>,
    _context: Context,
    request: Request,
  ): Promise<CallToolResult> {
    const { reportId } = params;

    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const agentSessionHeader = request.headers?.['x-agent-session-id'] as
      | string
      | undefined;

    this.logger.debug('get_report_body called', {
      organizationId: auth.organizationId,
      reportId,
      agentSessionId: agentSessionHeader ?? null,
    });

    try {
      const report = await this.reportService.findOne(
        auth.organizationId,
        reportId,
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(report, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        this.logger.warn('get_report_body lookup miss', {
          organizationId: auth.organizationId,
          reportId,
        });
        return mcpError(`Report ${reportId} not found or not accessible.`);
      }

      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.warn(`get_report_body failed: ${message}`, stack);
      return mcpError(`Failed to fetch report ${reportId}: ${message}`);
    }
  }
}
