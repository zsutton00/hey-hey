import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Request } from 'express';
import { ReportService } from '../../services/reports/report.service';
import { extractAuthContext, isAuthContext, mcpError } from './mcp-tool.utils';

const listReportsByEntityParameters = z.object({
  entityId: z
    .string()
    .uuid()
    .describe(
      'UUID of the entity (task, parent task, plan stage, plan step, etc.) ' +
        'whose attached reports should be listed.',
    ),
  reportType: z
    .string()
    .optional()
    .describe(
      'Optional ReportType filter (free string; the service rejects values ' +
        'it cannot resolve). Omit to list every report on the entity.',
    ),
});

@Injectable()
export class ListReportsByEntityToolsProvider {
  private readonly logger = new Logger(ListReportsByEntityToolsProvider.name);

  constructor(private readonly reportService: ReportService) {}

  @Tool({
    name: 'list_reports_by_entity',
    description:
      'List reports attached to a given entity, optionally filtered to a ' +
      'single ReportType. Returns a compact ReportSummaryDto[] (id, ' +
      'reportType, sourceExecution, createdAt) — pair with get_report_body ' +
      'to read a specific report. Read-only: safe to call inline without ' +
      'terminating the turn.',
    parameters: listReportsByEntityParameters,
  })
  async listReportsByEntity(
    params: z.infer<typeof listReportsByEntityParameters>,
    _context: Context,
    request: Request,
  ): Promise<CallToolResult> {
    const { entityId, reportType } = params;

    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const agentSessionHeader = request.headers?.['x-agent-session-id'] as
      | string
      | undefined;

    this.logger.debug('list_reports_by_entity called', {
      organizationId: auth.organizationId,
      entityId,
      reportType: reportType ?? null,
      agentSessionId: agentSessionHeader ?? null,
    });

    try {
      const summaries = await this.reportService.listSummariesByEntity(
        auth.organizationId,
        entityId,
        reportType,
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(summaries, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        this.logger.warn('list_reports_by_entity rejected', {
          organizationId: auth.organizationId,
          entityId,
          reportType: reportType ?? null,
          message: error.message,
        });
        return mcpError(error.message);
      }

      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.warn(`list_reports_by_entity failed: ${message}`, stack);
      return mcpError(`Failed to list reports for ${entityId}: ${message}`);
    }
  }
}
