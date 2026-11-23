import type { ServerLogger } from '../../../server/logger';
import { toDurableJsonValue } from '../../../run-store/durable-events';
import {
  buildNormalizedProviderFacts,
  permissionFingerprint,
  type ProviderActivityFacts,
} from '../provider-event-normalization-core';
import type { AcpInboundCall, AcpUpdate } from './acp-schemas';

interface EventContext {
  runId: string;
  sessionId: string;
  timestamp: string;
}

type AcpToolUpdate = Extract<AcpUpdate, { sessionUpdate: 'tool_call' | 'tool_call_update' }>;
type Permission = Extract<AcpInboundCall, { method: 'session/request_permission' }>['params'];

export function normalizeAntigravityEvent(
  context: EventContext,
  eventType: string,
  payload: Record<string, unknown>,
  activity?: ProviderActivityFacts,
) {
  const agentId = 'antigravity';
  const normalizeInput = {
    ...context,
    eventType,
    agentId,
    provider: agentId,
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
    case 'agent_message_chunk':
      return normalizeAntigravityEvent(
        context,
        'agent_output',
        { messageType: 'assistant', summary: update.content.text },
        {
          narration: { delivery: 'delta', text: update.content.text, isFinal: false },
        },
      );
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
    case 'user_message_chunk':
    case 'available_commands_update':
    case 'config_option_update':
    case 'session_info_update':
      return null;
  }
}

export function mapAntigravityPermission(
  context: EventContext,
  requestId: string,
  params: Permission,
) {
  const tool = params.toolCall;
  const action = tool.name ?? tool.kind ?? 'tool';
  const target = tool.title ?? action;
  const fingerprint = permissionFingerprint({
    provider: 'antigravity',
    requestId,
    action,
    input: tool.rawInput ?? tool.args,
  });
  return normalizeAntigravityEvent(context, 'permission_request_detected', {
    permission_request: {
      id: requestId,
      permission_type: tool.kind === 'edit' ? 'file_change' : 'command_execution',
      action,
      target,
      fingerprint,
      session_id: context.sessionId,
      agent_type: 'antigravity',
      timestamp: context.timestamp,
      idempotency_token: requestId,
    },
  });
}
