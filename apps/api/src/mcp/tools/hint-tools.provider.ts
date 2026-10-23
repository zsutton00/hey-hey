import { Injectable, Logger } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Request } from 'express';
import {
  HintConnectionEndpointEntityType,
  HintOrigin,
  HintOriginEntityType,
} from '../../generated/graphs';
import {
  HintRequestor,
  HintService,
  HintView,
  MAX_HINT_CONNECTIONS,
  MAX_HINT_READ_ITEMS,
} from '../../services/hints/hint.service';
import {
  extractAuthContext,
  isAgentSessionId,
  isAuthContext,
  isProjectId,
  mcpError,
  resolveAgentSessionId,
  resolveProjectId,
} from './mcp-tool.utils';

export const CREATE_HINT_TOOL_NAME = 'create_hint';
export const ADD_HINT_CONNECTION_TOOL_NAME = 'add_hint_connection';
export const GET_HINTS_FOR_ITEMS_TOOL_NAME = 'get_hints_for_items';

// The firing logic owns strength changes; new connections start equal.
const INITIAL_CONNECTION_STRENGTH = 1;

const HINT_PURPOSE =
  'A hint is a small, cheap note that matters to future work but is not ' +
  'worth a requirement: direction the user gave, a correction they do not ' +
  'want to repeat, or a gotcha found while building.';

const connectionTargetSchema = z.object({
  itemId: z.string().uuid().describe('ID of the item the hint concerns'),
  itemType: z
    .nativeEnum(HintConnectionEndpointEntityType)
    .describe(
      'Entity type of the item. Features, tasks, Diagrams, Decisions and ' +
        'every other work item are TASK; HINT connects to another hint.',
    ),
});

const createHintParameters = z.object({
  projectId: z
    .string()
    .uuid()
    .optional()
    .describe('Project the hint belongs to. Inferred from X-Project-ID.'),
  text: z.string().min(1).max(1000).describe('The hint itself, short.'),
  connections: z
    .array(connectionTargetSchema)
    .min(1)
    .max(MAX_HINT_CONNECTIONS)
    .describe('Items the hint concerns. At least one is required.'),
  originMessageId: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Message the hint came from, such as the user message that gave the ' +
        'direction. When omitted, the current agent session is the origin.',
    ),
});

const addHintConnectionParameters = z.object({
  projectId: z
    .string()
    .uuid()
    .optional()
    .describe('Project the hint belongs to. Inferred from X-Project-ID.'),
  hintId: z.string().uuid().describe('ID of the existing hint'),
  connection: connectionTargetSchema,
});

const getHintsForItemsParameters = z.object({
  projectId: z
    .string()
    .uuid()
    .optional()
    .describe('Project to read hints from. Inferred from X-Project-ID.'),
  itemIds: z
    .array(z.string().uuid())
    .min(1)
    .max(MAX_HINT_READ_ITEMS)
    .describe('IDs of the items you are focused on'),
});

const hintViewSchema = z.object({
  id: z.string(),
  text: z.string(),
  origin: z.object({ entityType: z.string(), entityId: z.string() }),
  connections: z.array(
    z.object({
      id: z.string(),
      targetNodeId: z.string(),
      targetEntityType: z.string(),
      strength: z.number(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const hintOutput = z.object({ hint: hintViewSchema });
const hintsOutput = z.object({ hints: z.array(hintViewSchema) });

const toolError = (action: string, error: unknown): CallToolResult =>
  mcpError(
    `Failed to ${action}: ${error instanceof Error ? error.message : String(error)}`,
  );

function resolveRequestor(
  params: { projectId?: string },
  request: Request,
): HintRequestor | CallToolResult {
  const auth = extractAuthContext({}, request);
  if (!isAuthContext(auth)) return auth;
  if (!auth.token) return mcpError('Authentication token required.');
  const projectId = resolveProjectId(params, request);
  if (!isProjectId(projectId)) return projectId;
  return {
    userId: auth.user.userId,
    organizationId: auth.organizationId,
    projectId,
    token: auth.token,
  };
}

const isRequestor = (
  value: HintRequestor | CallToolResult,
): value is HintRequestor => 'userId' in value;

/** Write tools; offered only to agents that may record hints. */
@Injectable()
export class HintWriteToolsProvider {
  private readonly logger = new Logger(HintWriteToolsProvider.name);

  constructor(private readonly hintService: HintService) {}

  @Tool({
    name: CREATE_HINT_TOOL_NAME,
    description:
      `Record a hint. ${HINT_PURPOSE} Connect it to at least one item it ` +
      'concerns; the message or session it came from is kept as its origin. ' +
      'A hint never restates readable code, recorded requirements, Contracts ' +
      'or Decisions; if it belongs there, change that item instead.',
    parameters: createHintParameters,
    outputSchema: hintOutput,
  })
  async createHint(
    params: z.infer<typeof createHintParameters>,
    _context: Context,
    request: Request,
  ): Promise<z.infer<typeof hintOutput> | CallToolResult> {
    const requestor = resolveRequestor(params, request);
    if (!isRequestor(requestor)) return requestor;

    let origin: HintOrigin;
    if (params.originMessageId) {
      origin = {
        entityType: HintOriginEntityType.Message,
        entityId: params.originMessageId,
      };
    } else {
      const sessionId = resolveAgentSessionId(request);
      if (!isAgentSessionId(sessionId)) return sessionId;
      origin = {
        entityType: HintOriginEntityType.AgentSession,
        entityId: sessionId,
      };
    }

    this.logger.log('create_hint called', {
      projectId: requestor.projectId,
      connectionCount: params.connections.length,
      originType: origin.entityType,
    });
    try {
      const hint = await this.hintService.createHint(requestor, {
        text: params.text,
        origin,
        connections: params.connections.map((c) => ({
          targetNodeId: c.itemId,
          targetEntityType: c.itemType,
          strength: INITIAL_CONNECTION_STRENGTH,
        })),
      });
      return { hint };
    } catch (error) {
      this.logger.warn('create_hint failed', {
        projectId: requestor.projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return toolError('create hint', error);
    }
  }

  @Tool({
    name: ADD_HINT_CONNECTION_TOOL_NAME,
    description:
      'Connect an existing hint to another item it is also relevant to, so ' +
      'agents focused on that item find it too.',
    parameters: addHintConnectionParameters,
    outputSchema: hintOutput,
  })
  async addHintConnection(
    params: z.infer<typeof addHintConnectionParameters>,
    _context: Context,
    request: Request,
  ): Promise<z.infer<typeof hintOutput> | CallToolResult> {
    const requestor = resolveRequestor(params, request);
    if (!isRequestor(requestor)) return requestor;

    this.logger.log('add_hint_connection called', {
      projectId: requestor.projectId,
      hintId: params.hintId,
    });
    try {
      const hint = await this.hintService.addConnection(
        requestor,
        params.hintId,
        {
          targetNodeId: params.connection.itemId,
          targetEntityType: params.connection.itemType,
          strength: INITIAL_CONNECTION_STRENGTH,
        },
      );
      return { hint };
    } catch (error) {
      this.logger.warn('add_hint_connection failed', {
        projectId: requestor.projectId,
        hintId: params.hintId,
        error: error instanceof Error ? error.message : String(error),
      });
      return toolError('add hint connection', error);
    }
  }
}

/** Read tool; safe to offer to read-only agents. */
@Injectable()
export class HintReadToolsProvider {
  private readonly logger = new Logger(HintReadToolsProvider.name);

  constructor(private readonly hintService: HintService) {}

  @Tool({
    name: GET_HINTS_FOR_ITEMS_TOOL_NAME,
    description:
      `Read the hints connected to the items you are focused on. ${HINT_PURPOSE} ` +
      'Treat them as weakly held context, not authority: code, requirements, ' +
      'Contracts and Decisions win when they disagree.',
    parameters: getHintsForItemsParameters,
    outputSchema: hintsOutput,
  })
  async getHintsForItems(
    params: z.infer<typeof getHintsForItemsParameters>,
    _context: Context,
    request: Request,
  ): Promise<z.infer<typeof hintsOutput> | CallToolResult> {
    const requestor = resolveRequestor(params, request);
    if (!isRequestor(requestor)) return requestor;

    this.logger.log('get_hints_for_items called', {
      projectId: requestor.projectId,
      itemCount: params.itemIds.length,
    });
    try {
      const hints: HintView[] = await this.hintService.findHintsForItems(
        requestor,
        params.itemIds,
      );
      return { hints };
    } catch (error) {
      this.logger.warn('get_hints_for_items failed', {
        projectId: requestor.projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return toolError('read hints', error);
    }
  }
}

export const HINT_WRITE_TOOL_PROVIDERS = [HintWriteToolsProvider];
export const HINT_READ_TOOL_PROVIDERS = [HintReadToolsProvider];
