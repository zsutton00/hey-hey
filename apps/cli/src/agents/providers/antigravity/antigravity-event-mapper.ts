import type { ServerLogger } from '../../../server/logger';
import { PermissionDecisionRequestDtoDecisionEnum } from '@hey-hey/contracts/api/models';
import { z } from 'zod';
import { toDurableJsonValue } from '../../../run-store/durable-events';
import { ToolRuleStore } from '../../../session/tool-rules';
import {
  buildNormalizedProviderFacts,
  permissionFingerprint,
  type ProviderActivityFacts,
} from '../provider-event-normalization-core';
import type { AgentProviderId } from '../provider-config';
import type { AcpInboundCall, AcpUpdate } from './acp-schemas';

const PROVIDER = 'antigravity' satisfies AgentProviderId;

interface EventContext {
  runId: string;
  sessionId: string;
  timestamp: string;
}

type AcpToolUpdate = Extract<AcpUpdate, { sessionUpdate: 'tool_call' | 'tool_call_update' }>;
type Permission = Extract<AcpInboundCall, { method: 'session/request_permission' }>['params'];

const commandInputSchema = z.object({
  CommandLine: z.string().optional(),
  toolSummary: z.string().optional(),
});

export function normalizeAntigravityEvent(
  context: EventContext,
  eventType: string,
  payload: Record<string, unknown>,
  activity?: ProviderActivityFacts,
) {
  const agentId = context.runId;
  const normalizeInput = {
    ...context,
    eventType,
    agentId,
    provider: PROVIDER,
    rawEvent: payload,
  } as const;
  return {
    source: 'provider' as const,
    eventType,
    timestamp: context.timestamp,
    sessionId: context.sessionId,
    agentId,
    payload,
    providerFacts: buildNormalizedProviderFacts({
      normalizeInput,
      payload,
      ...(activity ? { activity } : {}),
    }),
  };
}

function mapTool(context: EventContext, update: AcpToolUpdate, logger: ServerLogger) {
  const { toolCallId, name, status, content = [] } = update;
  const input = toDurableJsonValue(update.rawInput ?? update.args) ?? {};
  if (!name || !status) {
    logger.debug('antigravity.acp.tool_fields_missing', {
      sessionId: context.sessionId,
      toolCallId,
      missing: [...(name ? [] : ['name']), ...(status ? [] : ['status'])],
    });
  }

  const complete = status === 'completed' || status === 'failed';
  const resultText = content
    .flatMap((block) => (block.type === 'content' ? [block.content.text] : []))
    .join('\n');
  const files = content.flatMap((block) =>
    block.type === 'diff'
      ? [{ path: block.path, status: block.oldText == null ? 'added' : 'modified' }]
      : [],
  );
  const payload = {
    routing: { item_id: toolCallId },
    ...(name && update.sessionUpdate === 'tool_call'
      ? { all_tool_use_blocks: [{ id: toolCallId, tool_name: name, input }] }
      : {}),
    ...(complete
      ? {
          all_tool_result_blocks: [
            { tool_use_id: toolCallId, is_error: status === 'failed', content_text: resultText },
          ],
        }
      : {}),
    ...(files.length > 0
      ? {
          canonical_event: {
            diff: {
              files,
              attribution_authority: status === 'completed' ? 'confirmed' : 'diagnostic',
            },
          },
        }
      : {}),
  };
  return normalizeAntigravityEvent(
    context,
    files.length > 0 ? 'file_diff_detected' : 'tool_use',
    payload,
    name && !complete
      ? { toolProgress: { toolUseId: toolCallId, toolName: name, input } }
      : undefined,
  );
}

export function mapAntigravityUpdate(
  context: EventContext,
  update: AcpUpdate,
  logger: ServerLogger,
) {
  switch (update.sessionUpdate) {
    case 'agent_thought_chunk':
      return normalizeAntigravityEvent(context, 'agent_output', {
        messageType: 'thinking',
        summary: update.content.text,
      });
    case 'tool_call':
    case 'tool_call_update':
      return mapTool(context, update, logger);
    case 'usage_update':
      return normalizeAntigravityEvent(context, 'context_usage', {
        used: update.used,
        size: update.size,
      });
    case 'current_mode_update':
      return normalizeAntigravityEvent(context, 'permission_mode_changed', {
        mode: update.currentModeId,
      });
    // Message chunks are fragments of one passage, not passages. The runner
    // buffers them and emits whole passages at tool-call and turn boundaries.
    case 'agent_message_chunk':
    case 'user_message_chunk':
    case 'available_commands_update':
    case 'config_option_update':
    case 'session_info_update':
      return null;
  }
}

/**
 * The stored-rule identity of an Antigravity tool: the provider-prefixed tool name,
 * so a rule never matches another provider's tool of the same name. A request with
 * no usable tool name has no rule key and can only be approved once.
 */
export function antigravityRuleKey(toolName: string | undefined): string | undefined {
  if (!toolName) {
    return undefined;
  }
  const key = `${PROVIDER}:${toolName}`;
  return ToolRuleStore.isValidRuleName(key) ? key : undefined;
}

const writingKinds = new Set(['edit', 'delete', 'move']);

/** A path Hey Hey read from a permission request, and the part of the request it came from. */
export interface AntigravityWriteTarget {
  source: string;
  path: string;
}

export function antigravityWriteTargetSources(
  tool: Permission['toolCall'],
): AntigravityWriteTarget[] {
  const targets: AntigravityWriteTarget[] = (tool.content ?? []).flatMap((entry, index) =>
    entry.type === 'diff' ? [{ source: `content[${index}].path`, path: entry.path }] : [],
  );
  if (!writingKinds.has(tool.kind ?? '')) {
    return targets;
  }

  // Only the ACP fields that name files: tool inputs are tool-specific, and their
  // field names (edit_file's `Target` is the text being replaced) say nothing reliable.
  (tool.locations ?? []).forEach((location, index) => {
    targets.push({ source: `locations[${index}].path`, path: location.path });
  });
  return targets;
}

export function antigravityWriteTargets(tool: Permission['toolCall']): string[] {
  return [...new Set(antigravityWriteTargetSources(tool).map((target) => target.path))];
}

export function mapAntigravityPermission(
  context: EventContext,
  requestId: string,
  params: Permission,
) {
  const tool = params.toolCall;
  const action = tool.name ?? tool.kind ?? 'tool';
  const target = tool.title ?? action;
  const input = commandInputSchema.safeParse(tool.rawInput ?? tool.args).data;
  const command = tool.kind === 'execute' ? input?.CommandLine : undefined;
  const files = antigravityWriteTargets(tool);
  const isWrite = writingKinds.has(tool.kind ?? '') || files.length > 0;
  const permissionType = isWrite
    ? 'file_change'
    : tool.kind === 'execute'
      ? 'command_execution'
      : action;
  const reason = input?.toolSummary ?? (command || files.length ? undefined : target);
  const offers = (kind: string) => params.options.some((option) => option.kind === kind);
  const canApprove = offers('allow_once');
  const canRemember = canApprove && antigravityRuleKey(tool.name) !== undefined;
  const availableDecisions = Object.values(PermissionDecisionRequestDtoDecisionEnum).filter(
    (decision) => {
      switch (decision) {
        case 'approve':
          return canApprove;
        case 'always_approve':
        case 'whitelist':
          return canRemember;
        case 'deny':
          return offers('reject_once');
      }
    },
  );
  const fingerprint = permissionFingerprint({
    provider: PROVIDER,
    requestId,
    action,
    input: tool.rawInput ?? tool.args,
  });
  return normalizeAntigravityEvent(context, 'permission_request_detected', {
    enrichment_metadata: { command, reason, referenced_files: files },
    permission_request: {
      id: requestId,
      permission_type: permissionType,
      action,
      target,
      fingerprint,
      session_id: context.sessionId,
      agent_id: context.runId,
      agent_type: PROVIDER,
      timestamp: context.timestamp,
      idempotency_token: requestId,
      availableDecisions,
    },
  });
}
