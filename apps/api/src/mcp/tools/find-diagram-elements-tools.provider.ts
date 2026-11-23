import { Injectable, Logger } from '@nestjs/common';
import { Context, Tool } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Request } from 'express';
import {
  DIAGRAM_ELEMENT_LOOKUP_LIMITS,
  DiagramElementLookupService,
  type DiagramElementLookupHit,
} from '../../services/tasks/diagram-element-lookup.service';
import {
  extractAuthContext,
  isAuthContext,
  isProjectId,
  mcpError,
  resolveProjectId,
} from './mcp-tool.utils';

export const findDiagramElementsParameters = z.object({
  identities: z
    .array(
      z.object({
        entityType: z.enum(['TASK', 'SERVICE']),
        entityId: z.string().uuid(),
      }),
    )
    .min(1)
    .max(DIAGRAM_ELEMENT_LOOKUP_LIMITS.identityCount)
    .describe(
      'Tasks (including Contracts) and Services to find Diagram Elements for',
    ),
});

function renderHit(hit: DiagramElementLookupHit): string {
  const link =
    hit.linkKind === 'CONTRACT_PARTICIPATION'
      ? `${hit.linkKind}/${hit.relationshipType}`
      : hit.linkKind;

  return JSON.stringify({
    for: `${hit.identity.entityType}:${hit.identity.entityId}`,
    link,
    elementId: hit.element.id,
    element: hit.element.name,
    role: hit.element.role,
    diagramId: hit.diagram.id,
    diagram: hit.diagram.name,
  });
}

@Injectable()
export class FindDiagramElementsToolsProvider {
  private readonly logger = new Logger(FindDiagramElementsToolsProvider.name);

  constructor(private readonly lookup: DiagramElementLookupService) {}

  @Tool({
    name: 'find_diagram_elements',
    description:
      'Find the live Diagram Elements that recorded project links connect to the ' +
      'given tasks, Contracts or Services. An element is returned only when it ' +
      'canonically references the entity (CANONICAL_REFERENCE), has a FULFILLED_BY ' +
      'link to it (FULFILLED_BY), or, for a Contract, has a GUARANTEES, IMPLEMENTS ' +
      'or CONSUMES link to it (CONTRACT_PARTICIPATION). Names, roles and ' +
      'proximity are never matched. An empty result means no recorded link, not a ' +
      'failure; a failed read is reported as an error. Read-only. Project is ' +
      'resolved from X-Project-ID.',
    parameters: findDiagramElementsParameters,
  })
  async findDiagramElements(
    params: z.infer<typeof findDiagramElementsParameters>,
    _context: Context,
    request: Request,
  ): Promise<CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) {
      return auth;
    }

    const projectId = resolveProjectId({}, request);
    if (!isProjectId(projectId)) {
      return projectId;
    }

    if (!auth.token) {
      return mcpError(
        'Authentication token required for Diagram element reads.',
      );
    }

    try {
      const result = await this.lookup.find(
        auth.organizationId,
        projectId,
        params.identities,
        auth.token,
      );
      const lines = result.hits.map(renderHit);
      const header = `${result.hits.length} Diagram Element link(s)${
        result.truncated
          ? ` (truncated at ${DIAGRAM_ELEMENT_LOOKUP_LIMITS.hitCount})`
          : ''
      }`;

      return {
        content: [{ type: 'text', text: [header, ...lines].join('\n') }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn('find_diagram_elements failed', {
        organizationId: auth.organizationId,
        projectId,
        identityCount: params.identities.length,
        error: message,
      });

      return mcpError(`Diagram element lookup failed: ${message}`);
    }
  }
}
