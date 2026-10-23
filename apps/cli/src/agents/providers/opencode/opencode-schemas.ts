import { z } from 'zod';

const opencodePromptRequestSchema = z.object({
  parts: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('text'), text: z.string() }),
        z.object({
          type: z.literal('file'),
          mime: z.string(),
          filename: z.string(),
          url: z.string(),
        }),
      ]),
    )
    .min(1),
  system: z.string().optional(),
  model: z.object({ providerID: z.string(), modelID: z.string() }).optional(),
  variant: z.string().optional(),
  tools: z.record(z.boolean()).optional(),
});

export type OpencodePromptRequest = z.infer<typeof opencodePromptRequestSchema>;

const timeRange = z.object({
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
});

const partBase = z.object({
  id: z.string().optional(),
  sessionID: z.string(),
  messageID: z.string().optional(),
});

const opencodeTextPart = partBase.extend({
  type: z.literal('text'),
  text: z.string(),
  synthetic: z.boolean().optional(),
  ignored: z.boolean().optional(),
  time: timeRange.optional(),
  metadata: z.record(z.unknown()).optional(),
});

const opencodeReasoningPart = partBase.extend({
  type: z.literal('reasoning'),
  text: z.string(),
  metadata: z.record(z.unknown()).optional(),
  time: timeRange.optional(),
});

const toolStatePending = z.object({
  status: z.literal('pending'),
  input: z.record(z.unknown()),
  raw: z.string().optional(),
});

const toolStateRunning = z.object({
  status: z.literal('running'),
  input: z.record(z.unknown()),
  title: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  time: z.object({ start: z.number().int().nonnegative() }),
});

const toolStateCompleted = z.object({
  status: z.literal('completed'),
  input: z.record(z.unknown()),
  output: z.string(),
  title: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  time: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
});

const toolStateError = z.object({
  status: z.literal('error'),
  input: z.record(z.unknown()),
  error: z.string(),
  metadata: z.record(z.unknown()).optional(),
  time: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
});

const opencodeToolState = z.discriminatedUnion('status', [
  toolStatePending,
  toolStateRunning,
  toolStateCompleted,
  toolStateError,
]);

const opencodeToolPart = partBase.extend({
  type: z.literal('tool'),
  callID: z.string(),
  tool: z.string(),
  state: opencodeToolState,
  metadata: z.record(z.unknown()).optional(),
});

const opencodeOtherPart = z
  .object({
    type: z.string(),
    sessionID: z.string().optional(),
    messageID: z.string().optional(),
  })
  .passthrough();

const opencodePart = z.union([
  opencodeTextPart,
  opencodeReasoningPart,
  opencodeToolPart,
  opencodeOtherPart,
]);

const nonNegativeFiniteNumber = z.number().finite().nonnegative();

const opencodeMessageTokens = z
  .object({
    input: nonNegativeFiniteNumber,
    output: nonNegativeFiniteNumber,
    reasoning: nonNegativeFiniteNumber.optional().default(0),
    cache: z
      .object({
        read: nonNegativeFiniteNumber,
        write: nonNegativeFiniteNumber,
      })
      .optional()
      .default({ read: 0, write: 0 }),
  })
  .passthrough();

const opencodeMessageInfo = z
  .object({
    role: z.string(),
    providerID: z.string().min(1).optional(),
    modelID: z.string().min(1).optional(),
    tokens: opencodeMessageTokens.optional(),
    error: z
      .object({
        name: z.string(),
        data: z.object({ message: z.string().optional() }).passthrough().optional(),
      })
      .passthrough()
      .optional(),
    time: z
      .object({
        created: nonNegativeFiniteNumber.optional(),
        completed: nonNegativeFiniteNumber.optional(),
      })
      .optional(),
  })
  .passthrough();

export const opencodeMessageUpdatedProperties = z
  .object({
    sessionID: z.string().optional(),
    info: opencodeMessageInfo,
  })
  .passthrough();

/** One message with its parts: the blocking prompt reply and each session-history entry. */
export const opencodeSessionMessage = z
  .object({
    info: opencodeMessageInfo,
    parts: z.array(opencodePart),
  })
  .passthrough();

export const opencodeSessionMessagesResponse = z.array(opencodeSessionMessage);

const opencodeModelLimit = z
  .object({
    context: nonNegativeFiniteNumber,
  })
  .passthrough();

const opencodeProviderModel = z
  .object({
    id: z.string().min(1).optional(),
    limit: opencodeModelLimit,
  })
  .passthrough();

const opencodeProvider = z
  .object({
    id: z.string().min(1),
    models: z.record(opencodeProviderModel),
  })
  .passthrough();

export const opencodeProvidersResponse = z
  .object({
    providers: z.array(opencodeProvider),
    default: z.record(z.string()).optional(),
  })
  .passthrough();

export const opencodeSessionSummarizeResponse = z.boolean();

type OpencodeTextPart = z.infer<typeof opencodeTextPart>;
type OpencodeReasoningPart = z.infer<typeof opencodeReasoningPart>;
type OpencodeToolPart = z.infer<typeof opencodeToolPart>;
type OpencodePart = z.infer<typeof opencodePart>;
export type OpencodeMessageInfo = z.infer<typeof opencodeMessageInfo>;
export type OpencodeMessageTokens = z.infer<typeof opencodeMessageTokens>;
type OpencodeMessageUpdatedProperties = z.infer<typeof opencodeMessageUpdatedProperties>;
type OpencodeSessionMessage = z.infer<typeof opencodeSessionMessagesResponse>[number];
type OpencodeProvidersResponse = z.infer<typeof opencodeProvidersResponse>;

export const opencodeMessagePartUpdatedProperties = z.object({
  sessionID: z.string().optional(),
  part: opencodePart,
  time: z.number().int().nonnegative().optional(),
});

const opencodePermissionAskedProperties = z.object({
  id: z.string(),
  sessionID: z.string().optional(),
  permission: z.string(),
  patterns: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
  always: z.array(z.string()).optional(),
  tool: z
    .object({
      messageID: z.string(),
      callID: z.string(),
    })
    .optional(),
});

export const opencodeExternalDirectoryPermissionAskedProperties =
  opencodePermissionAskedProperties.extend({
    permission: z.literal('external_directory'),
    patterns: z.array(z.string().min(1)).min(1),
  });

const sessionStatusInfo = z.discriminatedUnion('type', [
  z.object({ type: z.literal('idle') }),
  z.object({ type: z.literal('busy') }),
  z.object({
    type: z.literal('retry'),
    attempt: z.number().int().nonnegative(),
    message: z.string(),
    next: z.number().int().nonnegative(),
  }),
]);

const opencodeSessionStatusProperties = z.object({
  sessionID: z.string(),
  status: sessionStatusInfo,
});

const opencodeSessionErrorProperties = z.object({
  sessionID: z.string().optional(),
  error: z
    .object({
      name: z.string().optional(),
      message: z.string().optional(),
    })
    .passthrough()
    .optional(),
});

const opencodeFileDiff = z.object({
  file: z.string(),
  patch: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  status: z.enum(['added', 'deleted', 'modified']).optional(),
});

const opencodeSessionDiffProperties = z.object({
  sessionID: z.string(),
  diff: z.array(opencodeFileDiff),
});

type OpencodeMessagePartUpdated = z.infer<typeof opencodeMessagePartUpdatedProperties>;
type OpencodePermissionAsked = z.infer<typeof opencodePermissionAskedProperties>;
type OpencodeExternalDirectoryPermissionAsked = z.infer<
  typeof opencodeExternalDirectoryPermissionAskedProperties
>;
type OpencodeSessionStatus = z.infer<typeof opencodeSessionStatusProperties>;
type OpencodeSessionError = z.infer<typeof opencodeSessionErrorProperties>;
type OpencodeSessionDiff = z.infer<typeof opencodeSessionDiffProperties>;
type OpencodeFileDiff = z.infer<typeof opencodeFileDiff>;

const opencodeSseEnvelope = z
  .object({
    id: z.string().optional(),
    type: z.string(),
    properties: z.record(z.unknown()),
  })
  .passthrough();

type OpencodeSseEnvelope = z.infer<typeof opencodeSseEnvelope>;

type OpencodeSseEvent =
  | { type: 'server.connected'; id?: string; properties: Record<string, unknown> }
  | { type: 'server.heartbeat'; id?: string; properties: Record<string, unknown> }
  | { type: 'message.updated'; id?: string; properties: OpencodeMessageUpdatedProperties }
  | { type: 'message.part.updated'; id?: string; properties: OpencodeMessagePartUpdated }
  | { type: 'permission.asked'; id?: string; properties: OpencodePermissionAsked }
  | { type: 'session.status'; id?: string; properties: OpencodeSessionStatus }
  | { type: 'session.error'; id?: string; properties: OpencodeSessionError }
  | { type: 'session.diff'; id?: string; properties: OpencodeSessionDiff }
  | { type: string; id?: string; properties: Record<string, unknown> };

export interface ParseOpencodeSseLineResult {
  ok: boolean;
  event: OpencodeSseEvent | null;
  errors: string[];
}

const SSE_DATA_PREFIX = 'data: ';

export const parseOpencodeSseLine = (line: string): ParseOpencodeSseLineResult => {
  if (!line.startsWith(SSE_DATA_PREFIX)) {
    return { ok: false, event: null, errors: [] };
  }

  const body = line.slice(SSE_DATA_PREFIX.length);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    return {
      ok: false,
      event: null,
      errors: [`opencode SSE line is not valid JSON: ${(error as Error).message}`],
    };
  }

  const envelope = opencodeSseEnvelope.safeParse(parsed);
  if (!envelope.success) {
    return {
      ok: false,
      event: null,
      errors: envelope.error.issues.map((i) => `envelope: ${i.path.join('.')} ${i.message}`),
    };
  }

  const { id, type, properties } = envelope.data;

  switch (type) {
    case 'server.connected':
    case 'server.heartbeat': {
      return {
        ok: true,
        event: { type, ...(id !== undefined ? { id } : {}), properties },
        errors: [],
      };
    }
    case 'message.part.updated': {
      const result = opencodeMessagePartUpdatedProperties.safeParse(properties);
      if (!result.success) {
        return {
          ok: false,
          event: null,
          errors: result.error.issues.map(
            (i) => `message.part.updated: ${i.path.join('.')} ${i.message}`,
          ),
        };
      }
      return {
        ok: true,
        event: { type, ...(id !== undefined ? { id } : {}), properties: result.data },
        errors: [],
      };
    }
    case 'message.updated': {
      const result = opencodeMessageUpdatedProperties.safeParse(properties);
      if (!result.success) {
        return {
          ok: false,
          event: null,
          errors: result.error.issues.map(
            (i) => `message.updated: ${i.path.join('.')} ${i.message}`,
          ),
        };
      }
      return {
        ok: true,
        event: { type, ...(id !== undefined ? { id } : {}), properties: result.data },
        errors: [],
      };
    }
    case 'permission.asked': {
      const result = opencodePermissionAskedProperties.safeParse(properties);
      if (!result.success) {
        return {
          ok: false,
          event: null,
          errors: result.error.issues.map(
            (i) => `permission.asked: ${i.path.join('.')} ${i.message}`,
          ),
        };
      }
      return {
        ok: true,
        event: { type, ...(id !== undefined ? { id } : {}), properties: result.data },
        errors: [],
      };
    }
    case 'session.status': {
      const result = opencodeSessionStatusProperties.safeParse(properties);
      if (!result.success) {
        return {
          ok: false,
          event: null,
          errors: result.error.issues.map(
            (i) => `session.status: ${i.path.join('.')} ${i.message}`,
          ),
        };
      }
      return {
        ok: true,
        event: { type, ...(id !== undefined ? { id } : {}), properties: result.data },
        errors: [],
      };
    }
    case 'session.error': {
      const result = opencodeSessionErrorProperties.safeParse(properties);
      if (!result.success) {
        return {
          ok: false,
          event: null,
          errors: result.error.issues.map((i) => `session.error: ${i.path.join('.')} ${i.message}`),
        };
      }
      return {
        ok: true,
        event: { type, ...(id !== undefined ? { id } : {}), properties: result.data },
        errors: [],
      };
    }
    case 'session.diff': {
      const result = opencodeSessionDiffProperties.safeParse(properties);
      if (!result.success) {
        return {
          ok: false,
          event: null,
          errors: result.error.issues.map((i) => `session.diff: ${i.path.join('.')} ${i.message}`),
        };
      }
      return {
        ok: true,
        event: { type, ...(id !== undefined ? { id } : {}), properties: result.data },
        errors: [],
      };
    }
    default: {
      return {
        ok: true,
        event: { type, ...(id !== undefined ? { id } : {}), properties },
        errors: [],
      };
    }
  }
};

const opencodeHealthBody = z.object({
  healthy: z.boolean(),
});

type OpencodeHealthBody = z.infer<typeof opencodeHealthBody>;

const SERVE_LISTENING_PATTERN = /listening on (http:\/\/[^\s]+)/i;

interface ParsedServeStdoutLine {
  baseUrl: string;
}

const parseServeStdoutListenLine = (chunk: string): ParsedServeStdoutLine | null => {
  const match = chunk.match(SERVE_LISTENING_PATTERN);
  if (!match || !match[1]) {
    return null;
  }
  return { baseUrl: match[1].replace(/\/+$/, '') };
};
