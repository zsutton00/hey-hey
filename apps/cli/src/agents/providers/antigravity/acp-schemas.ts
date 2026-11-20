import { z } from 'zod';

const rpcId = z.union([z.string(), z.number()]);
const envelope = z.object({ jsonrpc: z.literal('2.0') });
const textContent = z.object({ type: z.literal('text'), text: z.string() });

const toolFields = z.object({
  toolCallId: z.string().min(1),
  name: z.string().optional(),
  title: z.string().optional(),
  kind: z.string().optional(),
  status: z.string().optional(),
  rawInput: z.unknown().optional(),
  args: z.unknown().optional(),
  rawOutput: z.unknown().optional(),
  content: z
    .array(
      z.union([
        z.object({
          type: z.literal('diff'),
          path: z.string(),
          oldText: z.string().nullish(),
          newText: z.string(),
        }),
        z.object({ type: z.literal('content'), content: textContent }),
      ]),
    )
    .optional(),
});

export const updateSchema = z.discriminatedUnion('sessionUpdate', [
  z.object({ sessionUpdate: z.literal('user_message_chunk'), content: textContent }),
  z.object({ sessionUpdate: z.literal('agent_message_chunk'), content: textContent }),
  z.object({ sessionUpdate: z.literal('agent_thought_chunk'), content: textContent }),
  toolFields.extend({ sessionUpdate: z.literal('tool_call') }),
  toolFields.extend({ sessionUpdate: z.literal('tool_call_update') }),
  z.object({
    sessionUpdate: z.literal('usage_update'),
    used: z.number().nonnegative(),
    size: z.number().positive(),
  }),
  z.object({ sessionUpdate: z.literal('current_mode_update'), currentModeId: z.string() }),
  z.object({
    sessionUpdate: z.literal('available_commands_update'),
    availableCommands: z.array(z.object({ name: z.string() })),
  }),
  z.object({
    sessionUpdate: z.literal('config_option_update'),
    configOptions: z.array(z.object({ id: z.string() })),
  }),
  z.object({ sessionUpdate: z.literal('session_info_update'), title: z.string().optional() }),
]);

export const inboundCallSchema = z.discriminatedUnion('method', [
  envelope.extend({
    method: z.literal('session/update'),
    params: z.object({ sessionId: z.string().min(1), update: updateSchema }),
  }),
  envelope.extend({
    method: z.literal('session/request_permission'),
    id: rpcId,
    params: z.object({
      sessionId: z.string().min(1),
      toolCall: toolFields,
      options: z.array(
        z.object({
          optionId: z.string(),
          kind: z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always']),
          name: z.string(),
        }),
      ),
    }),
  }),
]);

export const responseEnvelope = envelope.extend({ id: rpcId });
export const errorResponseSchema = responseEnvelope.extend({
  error: z.object({ code: z.number(), message: z.string() }),
});

const sessionModels = z.object({ currentModelId: z.string().optional() }).nullish();
const sessionModes = z.object({ currentModeId: z.string().optional() }).nullish();
export const acpResultSchemas = {
  initialize: z.object({ protocolVersion: z.literal(1) }),
  'session/new': z.object({
    sessionId: z.string().min(1),
    modes: sessionModes,
    models: sessionModels,
  }),
  'session/resume': z.object({
    modes: sessionModes,
    models: sessionModels,
    sessionId: z.string().min(1).optional(),
  }),
  'session/set_mode': z.object({}),
  'session/prompt': z.object({ stopReason: z.string() }),
};

export type AcpUpdate = z.infer<typeof updateSchema>;
export type AcpInboundCall = z.infer<typeof inboundCallSchema>;
