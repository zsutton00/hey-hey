import Anthropic from '@anthropic-ai/sdk';
import { JsonValue } from 'jsonriver/dist/parse';
import { ContextAwareLogger } from 'src/core/logging/context-aware-logger.service';
import type { IntermediateSystemMessageData } from 'src/types/flow-internal.types';
import { errorToLoggable } from 'src/utils/logging.util';
import z from 'zod';
import { parse } from './jsonriver';

export type MutableIntermediateSystemMessageData =
  Partial<IntermediateSystemMessageData> & Record<string, unknown>;

export const ARRAY_LIKE_FIELDS = new Set([
  'uiElements',
  'actions',
  'arrayField',
  'initiatives',
  'insights',
]);

const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_TARGET_FIELDS = ['response', 'uiElements'];

export function cloneJsonValue<T>(value: T): T {
  if (value == null || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map((item: unknown) => cloneJsonValue(item)) as unknown as T;
  }

  const clone: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    clone[key] = cloneJsonValue(entry);
  }

  return clone as T;
}

export function valuesAreEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  if (a == null || b == null) {
    return false;
  }

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }

    return a.every((value, index) => valuesAreEqual(value, b[index]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a as Record<string, unknown>);
    const keysB = Object.keys(b as Record<string, unknown>);

    if (keysA.length !== keysB.length) {
      return false;
    }

    return keysA.every((key) =>
      valuesAreEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ),
    );
  }

  return false;
}

export function getCurrentDeltaValue(
  state: MutableIntermediateSystemMessageData,
  field: string,
  index?: number,
): unknown {
  if (ARRAY_LIKE_FIELDS.has(field)) {
    const existing = state[field];
    if (Array.isArray(existing)) {
      if (typeof index === 'number') {
        return existing[index];
      }
      return existing[existing.length - 1];
    }
    return undefined;
  }

  return (state as Record<string, unknown>)[field];
}

export function applyStructuredDelta(
  state: MutableIntermediateSystemMessageData,
  field: string,
  value: unknown,
  index?: number,
): boolean {
  if (ARRAY_LIKE_FIELDS.has(field)) {
    if (typeof index === 'number') {
      const nextArray = Array.isArray(state[field])
        ? ([...(state[field] as unknown[])] as unknown[])
        : [];
      const previousValue = nextArray[index];
      if (valuesAreEqual(previousValue, value)) {
        return false;
      }
      nextArray[index] = cloneJsonValue(value);
      state[field] = nextArray;
      return true;
    }

    if (Array.isArray(value)) {
      if (valuesAreEqual(state[field], value)) {
        return false;
      }
      state[field] = cloneJsonValue(value) as unknown;
      return true;
    }

    return false;
  }

  const previousValue = (state as Record<string, unknown>)[field];
  if (valuesAreEqual(previousValue, value)) {
    return false;
  }

  (state as Record<string, unknown>)[field] = cloneJsonValue(value);
  return true;
}

type SchemaFieldValidator = {
  isArray: boolean;
  validateValue: (value: unknown) => void;
  validateItem?: (value: unknown) => void;
};

function unwrapToBaseSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return unwrapToBaseSchema(schema.unwrap());
  }

  if (schema instanceof z.ZodDefault) {
    return unwrapToBaseSchema(schema._def.innerType);
  }

  if (schema instanceof z.ZodEffects) {
    return unwrapToBaseSchema(schema._def.schema);
  }

  return schema;
}

function createSafeParseValidator(
  schema: z.ZodTypeAny,
  fieldLabel: string,
): (value: unknown) => void {
  return (value: unknown) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new Error(
        `Invalid structured stream value for "${fieldLabel}": ${result.error.message}`,
      );
    }
  };
}

export function createSchemaFieldValidators(
  schema?: z.Schema,
): Record<string, SchemaFieldValidator> {
  if (!schema || !(schema instanceof z.ZodObject)) {
    return {};
  }

  const validators: Record<string, SchemaFieldValidator> = {};
  const shape = schema.shape;

  for (const [field, fieldSchema] of Object.entries(shape)) {
    const zodSchema = fieldSchema as z.ZodTypeAny;
    const baseSchema = unwrapToBaseSchema(zodSchema);

    if (baseSchema instanceof z.ZodArray) {
      const fieldValidator = createSafeParseValidator(zodSchema, field);
      const itemValidator = createSafeParseValidator(
        baseSchema.element as z.ZodTypeAny,
        `${field}[]`,
      );

      validators[field] = {
        isArray: true,
        validateValue: fieldValidator,
        validateItem: itemValidator,
      };
      ARRAY_LIKE_FIELDS.add(field);
      continue;
    }

    validators[field] = {
      isArray: false,
      validateValue: createSafeParseValidator(zodSchema, field),
    };
  }

  return validators;
}

interface PushableAsyncIterable<T> {
  iterable: AsyncIterable<T>;
  push: (value: T) => void;
  end: () => void;
}

function createPushableAsyncIterable<T>(): PushableAsyncIterable<T> {
  let done = false;
  const queue: T[] = [];
  let pendingResolve: ((result: IteratorResult<T>) => void) | null = null;

  const iterator: AsyncIterator<T> & AsyncIterable<T> = {
    async next(): Promise<IteratorResult<T>> {
      if (queue.length > 0) {
        const value = queue.shift();
        if (value === undefined) {
          throw new Error('Queue unexpectedly empty during iteration');
        }
        return { value, done: false };
      }
      if (done) {
        return { value: undefined as unknown as T, done: true };
      }
      return new Promise<IteratorResult<T>>((resolve) => {
        pendingResolve = resolve;
      });
    },

    async return(): Promise<IteratorResult<T>> {
      done = true;
      if (pendingResolve) {
        pendingResolve({ value: undefined as unknown as T, done: true });
        pendingResolve = null;
      }
      return { value: undefined as unknown as T, done: true };
    },

    async throw(err?: unknown): Promise<IteratorResult<T>> {
      done = true;
      if (pendingResolve) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/prefer-promise-reject-errors
        pendingResolve(Promise.reject(err ?? new Error('Stream error')) as any);
        pendingResolve = null;
      }
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      return Promise.reject(err ?? new Error('Stream error'));
    },

    [Symbol.asyncIterator]() {
      return this;
    },
  };

  return {
    iterable: iterator,
    push(value: T) {
      if (done) {
        return;
      }
      if (pendingResolve) {
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve({ value, done: false });
      } else {
        queue.push(value);
      }
    },
    end() {
      if (done) {
        return;
      }
      done = true;
      if (pendingResolve) {
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve({ value: undefined as unknown as T, done: true });
      }
    },
  };
}

class JsonStreamBlockParser {
  private readonly pushable = createPushableAsyncIterable<string>();
  private readonly consumption: Promise<void>;
  private pendingSnapshot: Record<string, unknown> | null = null;
  private lastEmitted: number | null = -1;
  private previousFieldValues: Map<string, unknown> = new Map();
  private throttlerTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly parse: (
      stream: AsyncIterable<string>,
    ) => AsyncIterableIterator<JsonValue>,
    private readonly emitSnapshot: (
      snapshot: IntermediateSystemMessageData,
    ) => boolean,
    private readonly targetFields: string[],
    private readonly debounceMs: number,
    private readonly logger?: ContextAwareLogger,
  ) {
    this.consumption = this.consume();
    this.pushable.push('{');
  }

  push(text: string) {
    this.pushable.push(text);
  }

  async close(): Promise<void> {
    if (this.throttlerTimer) {
      clearTimeout(this.throttlerTimer);
      this.throttlerTimer = null;
    }

    // Flush any pending snapshot immediately
    if (this.pendingSnapshot) {
      this.emitSnapshot(this.pendingSnapshot as IntermediateSystemMessageData);
      this.pendingSnapshot = null;
    }

    this.pushable.end();
    await this.consumption;
  }

  private serializeEmitted(
    emitted: Record<string, unknown> | string | number | boolean,
  ): string {
    const type = typeof emitted;

    if (emitted === null) return 'n';
    if (type === 'boolean') return emitted ? 't' : 'f';
    if (type === 'number') return `${emitted as number}`;
    if (type === 'string') return `s${(emitted as string).length}`;
    if (Array.isArray(emitted))
      return `[${emitted.map((v) => this.serializeEmitted(v)).join(',')}]`;
    if (type === 'object') {
      const keys = Object.keys(emitted).sort();
      const obj = emitted as Record<string, unknown>;
      const out: string[] = [];
      for (const k of keys) {
        const value = obj[k] as
          | Record<string, unknown>
          | string
          | number
          | boolean;
        const str = this.serializeEmitted(value);
        out.push(`${k}:${str}`);
      }
      return out.join(',');
    }
    throw new Error('Unsupported emitted value type');
  }

  private hash(emitted: Record<string, unknown> | string | number | boolean) {
    const str = this.serializeEmitted(emitted);
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash +=
        (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return hash >>> 0;
  }

  private scheduleEmit(snapshot: Record<string, unknown>): void {
    const hashed = this.hash(snapshot);
    if (this.lastEmitted === hashed) {
      return;
    }

    this.lastEmitted = hashed;
    this.pendingSnapshot = snapshot;

    // Clear existing timer
    if (this.throttlerTimer) {
      return;
    }

    // Schedule new emission
    this.throttlerTimer = setTimeout(() => {
      this.throttlerTimer = null;
      if (this.pendingSnapshot) {
        const emitted = this.emitSnapshot(
          this.pendingSnapshot as IntermediateSystemMessageData,
        );

        // Update previous field values
        if (emitted) {
          for (const field of this.targetFields) {
            this.previousFieldValues.set(field, this.pendingSnapshot[field]);
          }
        }

        this.pendingSnapshot = null;
      }
    }, this.debounceMs);
  }

  private async consume(): Promise<void> {
    try {
      for await (const value of this.parse(this.pushable.iterable)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          continue;
        }
        this.scheduleEmit(value as Record<string, unknown>);
      }
    } catch (error) {
      this.logger?.warn('Failed to parse structured text delta payload', {
        error: errorToLoggable(error),
      });
    }
  }
}

export class StreamingJsonFieldAccumulator {
  private readonly blockParsers = new Map<number, JsonStreamBlockParser>();
  private readonly blockClosures: Promise<void>[] = [];
  private closed = false;

  constructor(
    private readonly emit: (snapshot: IntermediateSystemMessageData) => boolean,
    private readonly logger: ContextAwareLogger | undefined,
    private readonly targetFields: string[],
    private readonly debounceMs: number,
  ) {}

  push(payload: Record<string, unknown>) {
    if (this.closed || !payload) {
      return;
    }

    const type = typeof payload.type === 'string' ? payload.type : undefined;

    if (type === 'content_block_start') {
      const index = this.resolveIndex(payload.index);
      this.startBlock(index);
      return;
    }

    if (type === 'content_block_delta') {
      const index = this.resolveIndex(payload.index);
      const delta = payload.delta as Record<string, unknown> | undefined;
      if (
        delta &&
        delta.type === 'text_delta' &&
        typeof delta.text === 'string'
      ) {
        this.startBlock(index).push(delta.text);
      }
      return;
    }

    if (type === 'content_block_stop') {
      const index = this.resolveIndex(payload.index);
      this.finishBlock(index);
      return;
    }

    this.logger?.log('Ignoring non-structured payload fragment');
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;

    for (const [index, parser] of this.blockParsers.entries()) {
      this.logger?.log('Closing structured text block', { index });
      this.blockClosures.push(parser.close());
    }
    this.blockParsers.clear();

    await Promise.all(this.blockClosures);
  }

  private resolveIndex(value: unknown): number {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return 0;
  }

  private startBlock(index: number): JsonStreamBlockParser {
    let parser = this.blockParsers.get(index);
    if (parser) {
      return parser;
    }

    this.finishBlock(index);

    parser = new JsonStreamBlockParser(
      parse,
      this.emit,
      this.targetFields,
      this.debounceMs,
      this.logger,
    );
    this.blockParsers.set(index, parser);
    return parser;
  }

  private finishBlock(index: number) {
    const parser = this.blockParsers.get(index);
    if (!parser) {
      return;
    }
    this.blockParsers.delete(index);
    this.blockClosures.push(parser.close());
  }
}

export class StructuredStreamProcessor {
  private eventBuffer = '';
  private snapshot: IntermediateSystemMessageData | null = null;
  private accumulator: StreamingJsonFieldAccumulator;

  constructor(
    onSnapshot: (snapshot: IntermediateSystemMessageData) => boolean,
    private readonly logger: ContextAwareLogger,
    targetFields: string[],
  ) {
    const fields = targetFields ?? DEFAULT_TARGET_FIELDS;

    this.accumulator = new StreamingJsonFieldAccumulator(
      (snapshot) => {
        this.snapshot = snapshot;
        return onSnapshot(snapshot);
      },
      logger,
      fields,
      DEFAULT_DEBOUNCE_MS,
    );
  }

  ingestEvent(
    event:
      | Anthropic.Messages.RawContentBlockStartEvent
      | Anthropic.Messages.RawContentBlockDeltaEvent
      | Anthropic.Messages.RawContentBlockStopEvent,
  ) {
    this.accumulator.push(event as unknown as Record<string, unknown>);
  }

  async finalize(): Promise<IntermediateSystemMessageData | null> {
    this.processBufferedEvents(true);
    await this.accumulator.close();
    return this.snapshot;
  }

  private processBufferedEvents(flushRemainder: boolean) {
    let eventEndIndex = this.eventBuffer.indexOf('\n\n');
    while (eventEndIndex !== -1) {
      const rawEvent = this.eventBuffer.slice(0, eventEndIndex);
      this.eventBuffer = this.eventBuffer.slice(eventEndIndex + 2);
      this.processSSEEvent(rawEvent);
      eventEndIndex = this.eventBuffer.indexOf('\n\n');
    }

    if (flushRemainder && this.eventBuffer.trim().length > 0) {
      this.processSSEEvent(this.eventBuffer);
      this.eventBuffer = '';
    }
  }

  private processSSEEvent(rawEvent: string) {
    const dataPayload = rawEvent
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(6))
      .join('\n');

    if (!dataPayload || dataPayload === '[DONE]') {
      if (dataPayload === '[DONE]') {
        this.logger.log('Structured stream received completion sentinel');
      }
      return;
    }

    this.logger.log('Structured stream payload received', {
      payloadLength: dataPayload.length,
    });

    try {
      const parsed = JSON.parse(dataPayload) as Record<string, unknown>;
      this.accumulator.push(parsed);
    } catch (error) {
      this.logger.warn('Failed to parse SSE payload', {
        error: errorToLoggable(error),
        dataPayload,
      });
    }
  }
}

export function ensureSystemMessageData(
  value?: IntermediateSystemMessageData | MutableIntermediateSystemMessageData,
): IntermediateSystemMessageData {
  if (!value) {
    return {} as IntermediateSystemMessageData;
  }
  return value as IntermediateSystemMessageData;
}
