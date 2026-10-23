import { Injectable, Logger } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Request } from 'express';
import { ServiceService } from '../../services/service/service.service';
import { OrganizationId } from '../../types';
import {
  extractAuthContext,
  isAuthContext,
  mcpError,
  paginationFields,
} from './mcp-tool.utils';

const FETCH_LIMIT = 200;

const listServicesParameters = z.object({
  name: z
    .string()
    .optional()
    .describe('Case-insensitive substring match on service name'),
  tag: z
    .string()
    .optional()
    .describe('Filter by tag (returns services that have this tag)'),
  language: z
    .string()
    .optional()
    .describe(
      'Case-insensitive filter by programming language (e.g. "TypeScript", "Python")',
    ),
  // Keep in sync with ServiceDto.serviceType (src/generated/model/serviceDto.ts)
  serviceType: z
    .enum([
      'backend',
      'ui',
      'database',
      'worker',
      'mobile',
      'desktop',
      'library',
      'other',
    ])
    .optional()
    .describe('Filter by service type'),
  status: z
    .enum(['ACTIVE', 'ARCHIVED', 'DEPRECATED'])
    .default('ACTIVE')
    .describe(
      'Filter by status (defaults to ACTIVE; pass ARCHIVED or DEPRECATED to see non-active services)',
    ),
  ...paginationFields,
});

const listServicesOutput = z.object({
  services: z.array(
    z.object({
      id: z.string().describe('Service ID'),
      name: z.string().describe('Service name'),
      description: z.string().optional().describe('Service description'),
      serviceType: z
        .string()
        .optional()
        .describe(
          'Service type: backend, ui, database, worker, mobile, desktop, library, other',
        ),
      language: z.string().optional().describe('Primary programming language'),
      framework: z.string().optional().describe('Primary framework'),
      tags: z
        .array(z.string())
        .default([])
        .describe('Tags associated with this service'),
      status: z
        .string()
        .describe('Service status: ACTIVE, ARCHIVED, DEPRECATED'),
      repositoryUrl: z.string().optional().describe('Repository URL'),
      childCounts: z
        .object({
          tasks: z.number().int(),
          initiatives: z.number().int(),
          agentSessions: z.number().int(),
          implementationHints: z.number().int(),
        })
        .optional()
        .describe('Counts of associated entities'),
    }),
  ),
  total: z
    .number()
    .int()
    .describe('Total number of services matching filters (before pagination)'),
  hasMore: z
    .boolean()
    .describe('Whether more results may exist beyond this page'),
});

type ListServicesOutput = z.infer<typeof listServicesOutput>;

@Injectable()
export class ServiceToolsProvider {
  private readonly logger = new Logger(ServiceToolsProvider.name);

  constructor(private readonly serviceService: ServiceService) {}

  @Tool({
    name: 'list_services',
    description:
      'List services in the organization. Use this to discover what services ' +
      'exist and determine which service owns a given feature area. Defaults ' +
      'to active services only (pass status=ARCHIVED or DEPRECATED to include ' +
      'non-active services). Supports filtering by name, tag, language, and ' +
      'service type. Returns name, description, tags, language, framework, and ' +
      'associated entity counts to help identify the correct owning service ' +
      'for a task or feature.',
    parameters: listServicesParameters,
    outputSchema: listServicesOutput,
  })
  async listServices(
    params: z.infer<typeof listServicesParameters>,
    _context: Context,
    request: Request,
  ): Promise<ListServicesOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const { name, tag, language, serviceType, status, limit, offset } = params;

    this.logger.log('list_services called', {
      organizationId: auth.organizationId,
      name,
      tag,
      language,
      serviceType,
      status,
      limit,
      offset,
    });

    try {
      const fetched = await this.serviceService.findAll(
        auth.organizationId as OrganizationId,
        {
          status,
          tags: tag ? [tag] : undefined,
          serviceType,
          limit: FETCH_LIMIT,
          page: 1,
        },
      );

      let filtered = fetched;

      if (name) {
        const lower = name.toLowerCase();
        filtered = filtered.filter((s) => s.name.toLowerCase().includes(lower));
      }

      if (language) {
        const lower = language.toLowerCase();
        filtered = filtered.filter((s) =>
          s.language?.toLowerCase().includes(lower),
        );
      }

      const paged = filtered.slice(offset, offset + limit);
      // Also signal hasMore if we hit the fetch ceiling (more rows may exist in DB)
      const hasMore =
        filtered.length > offset + limit || fetched.length >= FETCH_LIMIT;

      const services = paged.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description ?? undefined,
        serviceType: s.serviceType ?? undefined,
        language: s.language ?? undefined,
        framework: s.framework ?? undefined,
        tags: s.tags ?? [],
        status: s.status,
        repositoryUrl: s.repositoryUrl ?? undefined,
        childCounts: s.childCounts
          ? {
              tasks: s.childCounts.tasks ?? 0,
              initiatives: s.childCounts.initiatives ?? 0,
              agentSessions: s.childCounts.agentSessions ?? 0,
              implementationHints: s.childCounts.implementationHints ?? 0,
            }
          : undefined,
      }));

      return { services, total: filtered.length, hasMore };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.warn(`list_services failed: ${message}`, stack);
      return mcpError(`Service list failed: ${message}`);
    }
  }
}
