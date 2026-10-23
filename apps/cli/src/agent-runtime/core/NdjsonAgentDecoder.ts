import type { AgentDecoder } from './AgentDecoder';
import type { AgentContentItem, AgentMessage, AgentMessageType } from './types';
import { toAgentSessionId } from './types';

export type RawNdjsonPayload = Record<string, unknown>;

export type NdjsonPayloadNormalizer = (payload: RawNdjsonPayload) => AgentMessage;

export interface NdjsonDecoderLogger {
  warn(message: string, context?: Record<string, unknown>): void;
}

export interface NdjsonAgentDecoderOptions {
  normalizePayload?: NdjsonPayloadNormalizer | undefined;
  logger?: NdjsonDecoderLogger | undefined;
}

const MAX_LOG_LINE_LENGTH = 500;

const truncateForLog = (value: string): string =>
  value.length <= MAX_LOG_LINE_LENGTH ? value : `${value.slice(0, MAX_LOG_LINE_LENGTH)}...`;

const defaultLogger: NdjsonDecoderLogger = {
  warn: (message, context) => {
    console.warn(`[NdjsonAgentDecoder] ${message}`, context);
  },
};

const parseType = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const pickFirstDefined = (values: unknown[]): unknown => {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
};

const normalizeType = (rawType: string | null, rawSubtype: string | null): AgentMessageType => {
  if (rawType === 'assistant') {
    return 'assistant';
  }

  if (rawType === 'result') {
    return 'result';
  }

  if (rawType === 'error') {
    return 'error';
  }

  if (rawType === 'tool') {
    return 'tool';
  }

  if (rawType === 'user' && rawSubtype === 'tool') {
    return 'tool';
  }

  if (rawType === 'user') {
    return 'user';
  }

  return 'system';
};

const toContent = (type: AgentMessageType, payload: RawNdjsonPayload): AgentContentItem[] => {
  if (type === 'assistant') {
    return [
      {
        kind: 'text',
        payload: pickFirstDefined([
          payload['text'],
          payload['message'],
          payload['content'],
          payload['data'],
          payload,
        ]),
      },
    ];
  }

  if (type === 'tool') {
    return [
      {
        kind: 'tool',
        payload: pickFirstDefined([
          payload['tool'],
          payload['message'],
          payload['content'],
          payload['data'],
          payload,
        ]),
      },
    ];
  }

  if (type === 'result') {
    return [
      {
        kind: 'result',
        payload: pickFirstDefined([
          payload['result'],
          payload['message'],
          payload['content'],
          payload['data'],
          payload,
        ]),
      },
    ];
  }

  if (type === 'error') {
    return [
      {
        kind: 'error',
        payload: pickFirstDefined([
          payload['error'],
          payload['message'],
          payload['content'],
          payload['data'],
          payload,
        ]),
      },
    ];
  }

  return [
    {
      kind: 'text',
      payload: pickFirstDefined([
        payload['message'],
        payload['text'],
        payload['content'],
        payload['data'],
        payload,
      ]),
    },
  ];
};

const defaultNormalizePayload = (payload: RawNdjsonPayload): AgentMessage => {
  const rawType = parseType(payload['type']);
  const rawSubtype = parseType(payload['subtype']);
  const type = normalizeType(rawType, rawSubtype);
  const sessionIdValue = pickFirstDefined([payload['session_id'], payload['sessionId']]);

  const sessionId = typeof sessionIdValue === 'string' ? toAgentSessionId(sessionIdValue) : null;

  return {
    type,
    subtype: rawSubtype ?? undefined,
    sessionId,
    content: toContent(type, payload),
    timestamp: Date.now(),
    raw: payload,
  };
};

const createParseErrorMessage = (line: string, error: unknown): AgentMessage => ({
  type: 'error',
  subtype: 'parse_error',
  sessionId: null,
  content: [
    {
      kind: 'error',
      payload: {
        message: error instanceof Error ? error.message : 'Failed to parse NDJSON payload',
        line,
      },
    },
  ],
  timestamp: Date.now(),
  raw: {
    line,
  },
});

const createMalformedPayloadMessage = (payload: unknown): AgentMessage => ({
  type: 'error',
  subtype: 'malformed_payload',
  sessionId: null,
  content: [
    {
      kind: 'error',
      payload: {
        message: 'NDJSON payload must decode to an object',
        payload,
      },
    },
  ],
  timestamp: Date.now(),
  raw: payload,
});

export class NdjsonAgentDecoder implements AgentDecoder {
  private remainder = '';
  private readonly normalizePayload: NdjsonPayloadNormalizer;
  private readonly logger: NdjsonDecoderLogger;

  constructor(options: NdjsonAgentDecoderOptions = {}) {
    this.normalizePayload = options.normalizePayload ?? defaultNormalizePayload;
    this.logger = options.logger ?? defaultLogger;
  }

  decode(rawChunk: string): AgentMessage[] {
    this.remainder += rawChunk;
    const lines = this.remainder.split(/\r?\n/);
    this.remainder = lines.pop() ?? '';

    return lines.flatMap((line) => this.parseLine(line));
  }

  flush(): AgentMessage[] {
    if (this.remainder.length === 0) {
      return [];
    }

    const pending = this.remainder;
    this.remainder = '';
    return this.parseLine(pending);
  }

  reset(): void {
    this.remainder = '';
  }

  private parseLine(line: string): AgentMessage[] {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmedLine) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.logger.warn('Decoded NDJSON payload is not an object', {
          payloadType: Array.isArray(parsed) ? 'array' : typeof parsed,
        });
        return [createMalformedPayloadMessage(parsed)];
      }
      return [this.normalizePayload(parsed as RawNdjsonPayload)];
    } catch (error) {
      this.logger.warn('Failed to parse NDJSON line', {
        message: error instanceof Error ? error.message : 'Failed to parse NDJSON payload',
        line: truncateForLog(trimmedLine),
      });
      return [createParseErrorMessage(trimmedLine, error)];
    }
  }
}
