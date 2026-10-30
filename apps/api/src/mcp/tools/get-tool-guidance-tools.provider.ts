import { Injectable, Logger } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { TOOL_GUIDANCE, type ToolGuidanceKey } from './tool-guidance';
import type { Request } from 'express';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { isProjectId, mcpError, resolveProjectId } from './mcp-tool.utils';
import {
  GUIDANCE_TOKEN_FIELD,
  guidanceTokenForType,
} from './work-item-guidance-token';
import {
  AUTHORING_ROOT_PROOF_FIELD,
  AUTHORING_ROOT_PROOF,
  TOPOLOGY_AUTHORING_GUIDANCE,
  authoringGuidanceOutputSchema,
  validateAuthoringRootProof,
} from './authoring-guidance';
import { AUTHORING_GUIDANCE_TOOL_NAME } from './proposal-tool-names';

const TOOL_GUIDANCE_KEYS = Object.keys(TOOL_GUIDANCE) as [
  ToolGuidanceKey,
  ...ToolGuidanceKey[],
];

/**
 * Tool names whose `body` entry branches on the work-item type being
 * authored. For these, the provider reads the incoming `workItemType`
 * and returns that type's contract — sections, required scalars, and
 * writing standards assembled from the central work-item type config.
 * Omitting `workItemType` returns a type overview rather than an error.
 */
const WORK_ITEM_TOOL_NAMES = new Set<ToolGuidanceKey>([
  'create_work_item',
  'edit_work_item',
]);

const ROOT_PROOF_GUIDANCE_TOOL_NAMES = new Set<ToolGuidanceKey>([
  'create_work_item',
  'edit_work_item',
]);

const getToolGuidanceParameters = z.object({
  toolName: z
    .enum(TOOL_GUIDANCE_KEYS)
    .describe(
      'Name of the tool to fetch long-form guidance for. ' +
        'Must be one of: ' +
        TOOL_GUIDANCE_KEYS.join(', '),
    ),
  workItemType: z
    .string()
    .optional()
    .describe(
      'Work-item type for `create_work_item` / `edit_work_item` guidance — a ' +
        'built-in key (e.g. STANDARD, FEATURE, GOAL, BUG, CONTRACT) or a project-defined ' +
        "custom type key. Returns that type's sections, required fields, and " +
        'writing standards, sourced from its work-item type registry ' +
        'definition. Omitting it returns a type overview. Ignored for tools ' +
        'whose guidance does not branch on work-item type.',
    ),
  projectId: z
    .string()
    .optional()
    .describe(
      'Project scope for resolving a workItemType against the effective ' +
        'project-owned snapshot. Required for type-specific guidance; ' +
        'falls back to the X-Project-ID header when omitted.',
    ),
  authoringRootProof: z
    .string()
    .optional()
    .describe(
      'Reusable proof returned by get_authoring_guidance(). Required when ' +
        'reading topology-sensitive work-item authoring guidance.',
    ),
});

type GetToolGuidanceParams = z.infer<typeof getToolGuidanceParameters>;
/**
 * Append the project-scoped per-type proof-of-read token to a work-item
 * guidance body. The token rides the text the agent reads —
 * `get_tool_guidance` returns no outputSchema — so it is surfaced as a labeled
 * trailing block the agent copies into its `guidanceToken` field on
 * create_work_item / edit_work_item. The same token covers both tools for a
 * type within a project, so the agent pays the read once per type, not per
 * edit.
 */
function appendGuidanceToken(
  body: string,
  workItemType: string,
  projectId: string,
): string {
  const token = guidanceTokenForType(workItemType, projectId);
  return [
    body,
    '',
    '---',
    '',
    '## Proof-of-read token',
    '',
    `\`create_work_item\` and \`edit_work_item\` require this`,
    'token whenever the proposal carries prose-quality content: a non-empty',
    '`sections` array, a non-empty `implementation` string, or FEATURE',
    'requirement authoring (`initialRequirements` / `requirementOps`). Pass it',
    `back as \`${GUIDANCE_TOKEN_FIELD}\`. It is keyed to project \`${projectId}\` and`,
    `work-item type \`${workItemType}\` and covers every gated tool, so you`,
    'only need to read this once per type in that project:',
    '',
    `\`${token}\``,
  ].join('\n');
}

@Injectable()
export class GetToolGuidanceToolsProvider {
  private readonly logger = new Logger(GetToolGuidanceToolsProvider.name);

  constructor(
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
  ) {}

  @Tool({
    name: AUTHORING_GUIDANCE_TOOL_NAME,
    description:
      'Returns the shared mutation-specific topology authoring rules and one reusable root proof. Call this once before an operation that can create or change project topology.',
    parameters: z.object({}).strict(),
    outputSchema: authoringGuidanceOutputSchema,
  })
  getAuthoringGuidance(): z.infer<typeof authoringGuidanceOutputSchema> {
    return {
      guidance: TOPOLOGY_AUTHORING_GUIDANCE,
      [AUTHORING_ROOT_PROOF_FIELD]: AUTHORING_ROOT_PROOF,
    };
  }

  @Tool({
    name: 'get_tool_guidance',
    description:
      'Returns the authoring conventions and writing standards for another ' +
      'MCP proposal tool. Call this before invoking a proposal tool whose ' +
      'schema redirects here — the body it returns is load-bearing for ' +
      'proposal quality, not optional parameter docs. Read-only and ' +
      'turn-continuing.',
    parameters: getToolGuidanceParameters,
  })
  async getToolGuidance(
    params: GetToolGuidanceParams,
    _context: Context,
    request: Request,
  ): Promise<CallToolResult> {
    const { toolName, workItemType, authoringRootProof } = params;
    this.logger.debug('get_tool_guidance called', {
      toolName,
      workItemType,
      rootProofProvided: Boolean(authoringRootProof),
    });

    if (
      ROOT_PROOF_GUIDANCE_TOOL_NAMES.has(toolName) &&
      workItemType !== undefined
    ) {
      const rootError = validateAuthoringRootProof({
        toolName: 'get_tool_guidance',
        token: authoringRootProof,
        required: true,
      });
      if (rootError) return mcpError(rootError);
    }

    const entry = TOOL_GUIDANCE[toolName as ToolGuidanceKey];
    if (!entry) {
      this.logger.warn(
        `get_tool_guidance lookup miss for toolName=${toolName}`,
      );
      return mcpError(`Unknown toolName: ${toolName}`);
    }

    let text: string;
    if (
      WORK_ITEM_TOOL_NAMES.has(toolName) &&
      typeof entry.body === 'function'
    ) {
      // Generic work-item tools resolve per type from the registry snapshot at
      // request time, for any registry key — built-in or project-defined.
      const built = entry.body(this.workItemTypeRegistry);
      if (!workItemType) {
        // Omitted workItemType degrades to the type overview, never an error.
        // The overview is not type-specific, so it carries no token — the
        // gated tools require a token keyed to a concrete project/type scope.
        text = built.noWorkItemType;
      } else {
        // Canonical and custom keys share one resolution path. A typed
        // guidance request without authoritative project context is invalid;
        // the retained global rows are never an effective fallback.
        const projectId = resolveProjectId(params, request);
        if (!isProjectId(projectId)) return projectId;
        try {
          this.workItemTypeRegistry.assertTypeActive(workItemType, projectId);
        } catch (error) {
          return mcpError(
            error instanceof Error ? error.message : String(error),
          );
        }
        text = appendGuidanceToken(
          built.forType(workItemType, projectId),
          workItemType,
          projectId,
        );
      }
      this.logger.debug('get_tool_guidance work-item branch selected', {
        toolName,
        workItemType: workItemType ?? '(overview)',
        tokenIssued: Boolean(workItemType),
      });
    } else if (typeof entry.body === 'string') {
      // Flat-body tools ignore fidelity/validation entirely.
      text = entry.body;
    } else if (typeof entry.body === 'function') {
      // A work-item builder body reached here only if its tool name is not in
      // WORK_ITEM_TOOL_NAMES — resolve the overview as a safe default.
      text = entry.body(this.workItemTypeRegistry).noWorkItemType;
    } else {
      throw new Error(`Unsupported guidance body for ${toolName}`);
    }

    return {
      content: [{ type: 'text', text }],
    };
  }
}
