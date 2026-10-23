export const PRODUCTION_LOG_SCHEMA_VERSION = 1;
export const PRODUCTION_LOG_SERVICE = 'hey-hey-api';

export type ProductionLogLevel =
  | 'error'
  | 'warn'
  | 'info'
  | 'debug'
  | 'verbose'
  | 'http';

export interface ProductionLogContext {
  traceId?: string;
  traceSampled?: boolean;
  requestId?: string;
  correlationId?: string;
  organizationId?: string;
  projectId?: string;
  workflowId?: string;
  conversationId?: string;
  messageId?: string;
  agentSessionId?: string;
}

export interface ProductionLogInput {
  level: string;
  message: unknown;
  timestamp?: string | Date;
  source?: string;
  component?: string;
  context?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  error?: unknown;
}

export interface ProductionLogEnvelope {
  schemaVersion: number;
  timestamp: string;
  level: string;
  service: string;
  environment: string;
  source: string;
  message: string;
  component?: string;
  traceId?: string;
  traceSampled?: boolean;
  requestId?: string;
  correlationId?: string;
  organizationId?: string;
  projectId?: string;
  workflowId?: string;
  conversationId?: string;
  messageId?: string;
  agentSessionId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  responseTimeMs?: number;
  event?: string;
  operation?: string;
  flowId?: string;
  nodeId?: string;
  nodeType?: string;
  executionType?: string;
  operationType?: string;
  issues?: unknown[];
  issuesTruncated?: boolean;
  issuesTotalCount?: number;
  structuredAttributesTruncated?: string[];
  errorName?: string;
  errorStack?: string;
  [key: string]: unknown;
}

const CONTEXT_FIELDS = [
  'requestId',
  'correlationId',
  'organizationId',
  'projectId',
  'workflowId',
  'conversationId',
  'messageId',
  'agentSessionId',
] as const satisfies ReadonlyArray<keyof ProductionLogContext>;

const SAFE_ATTRIBUTE_FIELDS = new Set([
  'method',
  'path',
  'statusCode',
  'status_code',
  'responseTimeMs',
  'response_time',
  'event',
  'operation',
  'flowId',
  'nodeId',
  'nodeType',
  'executionType',
  'operationType',
  'component',
  'loggerContext',
]);

const RESERVED_ATTRIBUTE_FIELDS = new Set([
  'includeErrorDetails',
  'schemaVersion',
  'timestamp',
  'level',
  'service',
  'environment',
  'source',
  'message',
  'context',
  'error',
  'errorName',
  'errorStack',
  'stack',
  'issues',
  'issuesTruncated',
  'issuesTotalCount',
  'structuredAttributesTruncated',
  ...CONTEXT_FIELDS,
  'traceId',
  'traceSampled',
  ...SAFE_ATTRIBUTE_FIELDS,
]);

export function preserveLogAttributes(
  attributes: Record<string, unknown>,
  overwritten: readonly string[],
): Record<string, unknown> {
  const result = { ...attributes };
  for (const field of overwritten) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) continue;
    let target = `caller_${field}`;
    while (Object.prototype.hasOwnProperty.call(result, target)) {
      target = `caller_${target}`;
    }
    result[target] = result[field];
    delete result[field];
  }
  return result;
}

/** Caller values for these Winston-owned fields are moved at ingress. */
export function attributesFromWinston(
  info: Record<string, unknown>,
): Record<string, unknown> {
  const attributes = { ...info };
  delete attributes.message;
  delete attributes.level;
  delete attributes.timestamp;
  return attributes;
}

const SECRET_ATTRIBUTE_SEGMENTS = new Set([
  'authorization',
  'cookie',
  'password',
  'passwd',
  'private_key',
  'secret',
  'token',
  'api_key',
]);

const PAYLOAD_ATTRIBUTE_FIELDS = new Set([
  'body',
  'headers',
  'payload',
  'prompt',
  'request_body',
  'response_body',
]);

const MAX_DYNAMIC_ATTRIBUTES = 64;
const MAX_DIAGNOSTIC_ISSUES = 32;
const MAX_DIAGNOSTIC_ISSUE_BYTES = 16_384;
const MAX_STRUCTURED_ATTRIBUTE_BYTES = 16_384;
const MAX_STRUCTURED_VALUE_DEPTH = 4;
const MAX_STRUCTURED_ARRAY_ITEMS = 32;
const MAX_STRUCTURED_OBJECT_FIELDS = 24;
const MAX_STRUCTURED_STRING_LENGTH = 512;

const SECRET_PATTERN =
  /(["']?)(authorization|cookie|password|passwd|secret|token|api[-_ ]?key|private[-_ ]?key)\1\s*([:=])\s*(["']?)([^,\s;}"']+)\4/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const PEM_PATTERN = /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi;

function sanitizeText(value: string): string {
  return value
    .replace(PEM_PATTERN, '[REDACTED_PRIVATE_KEY]')
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(
      SECRET_PATTERN,
      (_match, quote, key, delimiter, valueQuote) =>
        `${quote}${key}${quote}${delimiter}${valueQuote}[REDACTED]${valueQuote}`,
    );
}

function primitive(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string')
    return sanitizeText(value).slice(0, MAX_STRUCTURED_STRING_LENGTH);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return undefined;
}

type StructuredLogValue =
  | string
  | number
  | boolean
  | null
  | StructuredLogValue[]
  | { [key: string]: StructuredLogValue };

function sanitizeStructuredLogValue(
  value: unknown,
  field = '',
  depth = 0,
  ancestors = new Set<object>(),
  state: { truncated: boolean } = { truncated: false },
): StructuredLogValue | undefined {
  if (isPrivateAttribute(field)) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') {
    const sanitized = sanitizeText(value);
    if (sanitized.length > MAX_STRUCTURED_STRING_LENGTH) {
      state.truncated = true;
    }
    return sanitized.slice(0, MAX_STRUCTURED_STRING_LENGTH);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (depth >= MAX_STRUCTURED_VALUE_DEPTH || typeof value !== 'object') {
    if (typeof value === 'object') state.truncated = true;
    return undefined;
  }
  if (value instanceof Error || ancestors.has(value)) {
    state.truncated = true;
    return value instanceof Error ? '[Error omitted]' : '[Circular]';
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);

  if (Array.isArray(value)) {
    if (value.length > MAX_STRUCTURED_ARRAY_ITEMS) {
      state.truncated = true;
    }
    return value
      .slice(0, MAX_STRUCTURED_ARRAY_ITEMS)
      .map((item) =>
        sanitizeStructuredLogValue(
          item,
          field,
          depth + 1,
          nextAncestors,
          state,
        ),
      )
      .map((item) => item ?? null);
  }

  const result: { [key: string]: StructuredLogValue } = {};
  if (Object.keys(value).length > MAX_STRUCTURED_OBJECT_FIELDS) {
    state.truncated = true;
  }
  for (const [key, nestedValue] of Object.entries(value).slice(
    0,
    MAX_STRUCTURED_OBJECT_FIELDS,
  )) {
    const sanitized = sanitizeStructuredLogValue(
      nestedValue,
      key,
      depth + 1,
      nextAncestors,
      state,
    );
    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  }
  return result;
}

function boundStructuredLogValue(
  value: StructuredLogValue,
  maxBytes: number,
): { value: StructuredLogValue; truncated: boolean } {
  const serialized = JSON.stringify(value);
  if (
    serialized !== undefined &&
    Buffer.byteLength(serialized, 'utf8') <= maxBytes
  ) {
    return { value, truncated: false };
  }

  if (Array.isArray(value)) {
    const bounded: StructuredLogValue[] = [];
    for (const item of value) {
      const candidate = [...bounded, item];
      const candidateSerialized = JSON.stringify(candidate);
      if (
        candidateSerialized === undefined ||
        Buffer.byteLength(candidateSerialized, 'utf8') > maxBytes
      ) {
        break;
      }
      bounded.push(item);
    }
    return { value: bounded, truncated: true };
  }

  if (typeof value === 'object' && value !== null) {
    const bounded: { [key: string]: StructuredLogValue } = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const candidate = { ...bounded, [key]: nestedValue };
      const candidateSerialized = JSON.stringify(candidate);
      if (
        candidateSerialized === undefined ||
        Buffer.byteLength(candidateSerialized, 'utf8') > maxBytes
      ) {
        break;
      }
      bounded[key] = nestedValue;
    }
    return { value: bounded, truncated: true };
  }

  return { value: '[Structured value omitted: size limit]', truncated: true };
}

function sanitizeStructuredAttribute(
  value: unknown,
  field: string,
): { value: StructuredLogValue; truncated: boolean } | undefined {
  if (value === null || typeof value !== 'object') return undefined;

  const state = { truncated: false };
  const sanitized = sanitizeStructuredLogValue(
    value,
    field,
    0,
    new Set<object>(),
    state,
  );
  if (sanitized === undefined) return undefined;

  const bounded = boundStructuredLogValue(
    sanitized,
    MAX_STRUCTURED_ATTRIBUTE_BYTES,
  );
  return {
    value: bounded.value,
    truncated: state.truncated || bounded.truncated,
  };
}

function sanitizeDiagnosticIssues(
  value: unknown,
): { issues: unknown[]; truncated: boolean; totalCount: number } | undefined {
  if (!Array.isArray(value)) return undefined;

  const issues: unknown[] = [];
  let serializedBytes = 2;
  let truncated = value.length > MAX_DIAGNOSTIC_ISSUES;
  for (const issue of value.slice(0, MAX_DIAGNOSTIC_ISSUES)) {
    const sanitized = sanitizeStructuredLogValue(issue);
    if (sanitized === undefined) {
      truncated = true;
      continue;
    }
    const serialized = JSON.stringify(sanitized);
    if (serialized === undefined) {
      truncated = true;
      continue;
    }
    const separatorBytes = issues.length ? 1 : 0;
    if (
      serializedBytes + separatorBytes + Buffer.byteLength(serialized, 'utf8') >
      MAX_DIAGNOSTIC_ISSUE_BYTES
    ) {
      truncated = true;
      break;
    }
    issues.push(sanitized);
    serializedBytes += separatorBytes + Buffer.byteLength(serialized, 'utf8');
  }

  return { issues, truncated, totalCount: value.length };
}

function isPrivateAttribute(field: string): boolean {
  const normalized = field
    .replace(/^(caller_)+/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
  if (
    PAYLOAD_ATTRIBUTE_FIELDS.has(normalized) ||
    normalized.endsWith('_body') ||
    normalized.endsWith('_headers') ||
    normalized.endsWith('_payload')
  ) {
    return true;
  }
  return [...SECRET_ATTRIBUTE_SEGMENTS].some((segment) =>
    `_${normalized}_`.includes(`_${segment}_`),
  );
}

function sanitizeErrorStack(value: string): string | undefined {
  const stackWithoutMessage = value.split('\n').slice(1).join('\n').trim();
  return stackWithoutMessage
    ? sanitizeText(stackWithoutMessage).slice(0, 4000)
    : undefined;
}

function summarizeErrorCauses(error: Error): string | undefined {
  const seen = new Set<Error>([error]);
  const causes: string[] = [];
  let current = error;
  while (
    'cause' in current &&
    current.cause instanceof Error &&
    causes.length < 8
  ) {
    if (seen.has(current.cause)) {
      causes.push('[circular cause]');
      break;
    }
    current = current.cause;
    seen.add(current);
    causes.push(`${current.name}: ${current.message}\n${current.stack ?? ''}`);
  }
  return causes.length
    ? sanitizeText(causes.join('\nCaused by: ')).slice(0, 8000)
    : undefined;
}

function errorDetails(error: unknown):
  | {
      errorName: string;
      errorMessage?: string;
      errorStack?: string;
      errorCause?: string;
    }
  | undefined {
  if (error instanceof Error) {
    return {
      errorName: sanitizeText(error.name).slice(0, 128),
      errorMessage: sanitizeText(error.message).slice(0, 4000),
      errorCause: summarizeErrorCauses(error),
      errorStack: error.stack ? sanitizeErrorStack(error.stack) : undefined,
    };
  }
  // Error strings are frequently derived from request or domain payloads. Do
  // not treat them as stack traces; callers can provide a separate `stack`
  // attribute when a diagnostic stack is available.
  if (typeof error === 'string') return { errorName: 'Error' };
  return undefined;
}

function safeMessage(message: unknown): string {
  if (message instanceof Error) return 'Application error';
  if (typeof message === 'string') return sanitizeText(message).slice(0, 512);
  return '[structured message omitted]';
}

function timestampValue(value?: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

/**
 * Build the one-line application log record. The allowlists here are the API's
 * enforcement point for the deployment-owned application-log convention.
 */
export function buildProductionLogEnvelope(
  input: ProductionLogInput,
): ProductionLogEnvelope {
  const context = input.context ?? {};
  const attributes = input.attributes ?? {};
  const envelope: ProductionLogEnvelope = {
    schemaVersion: PRODUCTION_LOG_SCHEMA_VERSION,
    timestamp: timestampValue(input.timestamp),
    level: input.level,
    service: PRODUCTION_LOG_SERVICE,
    environment:
      process.env.DEPLOYMENT_ENVIRONMENT ||
      process.env.NODE_ENV ||
      'development',
    source: input.source || 'application',
    message: safeMessage(input.message),
  };

  for (const field of CONTEXT_FIELDS) {
    const value = primitive(context[field] ?? attributes[field]);
    if (typeof value === 'string' && value.length > 0) {
      envelope[field] = value;
    }
  }

  // The active OTel context is authoritative; a free-form log attribute must
  // not be able to manufacture trace correlation outside an active trace.
  const traceId = primitive(context.traceId);
  if (
    typeof traceId === 'string' &&
    /^[0-9a-f]{32}$/i.test(traceId) &&
    traceId.toLowerCase() !== '00000000000000000000000000000000'
  ) {
    envelope.traceId = traceId;
    if (typeof context.traceSampled === 'boolean') {
      envelope.traceSampled = context.traceSampled;
    }
  }

  const component = primitive(
    input.component ??
      attributes.component ??
      attributes.context ??
      attributes.loggerContext,
  );
  if (typeof component === 'string' && component.length > 0) {
    envelope.component = component;
  }

  for (const field of SAFE_ATTRIBUTE_FIELDS) {
    const value = primitive(attributes[field]);
    if (value === undefined) continue;
    switch (field) {
      case 'statusCode':
      case 'status_code':
        if (typeof value === 'number') envelope.statusCode = value;
        break;
      case 'responseTimeMs':
      case 'response_time':
        if (typeof value === 'number') envelope.responseTimeMs = value;
        break;
      case 'component':
        break;
      default:
        if (typeof value === 'string') {
          (envelope as unknown as Record<string, unknown>)[field] = value;
        }
    }
  }

  const diagnosticIssues = sanitizeDiagnosticIssues(attributes.issues);
  if (diagnosticIssues) {
    envelope.issues = diagnosticIssues.issues;
    if (diagnosticIssues.truncated) {
      envelope.issuesTruncated = true;
      envelope.issuesTotalCount = diagnosticIssues.totalCount;
    }
  }

  let dynamicAttributeCount = 0;
  const structuredAttributesTruncated: string[] = [];
  const dynamicEntries = [
    ...Object.entries(attributes),
    ...Object.entries(context).filter(
      ([field, rawValue]) =>
        !Object.prototype.hasOwnProperty.call(attributes, field) &&
        rawValue !== null &&
        typeof rawValue === 'object',
    ),
  ];
  const occupied = new Set([
    ...dynamicEntries.map(([field]) => field),
    ...RESERVED_ATTRIBUTE_FIELDS,
    'errorMessage',
    'errorCause',
  ]);
  for (const [field, suppliedValue] of dynamicEntries) {
    let target = field;
    if (
      RESERVED_ATTRIBUTE_FIELDS.has(field) ||
      field === 'errorMessage' ||
      field === 'errorCause'
    ) {
      target = `caller_${field}`;
      while (occupied.has(target)) target = `caller_${target}`;
      occupied.add(target);
    }
    const originalField = field.replace(/^(caller_)+/, '');
    let rawValue = suppliedValue;
    if (rawValue instanceof Error) {
      const details = errorDetails(rawValue);
      rawValue =
        attributes.includeErrorDetails === true
          ? details
          : { errorName: details?.errorName, errorStack: details?.errorStack };
    } else if (
      (originalField === 'stack' || originalField === 'errorStack') &&
      typeof rawValue === 'string'
    ) {
      rawValue = sanitizeErrorStack(rawValue);
    }
    if (
      dynamicAttributeCount >= MAX_DYNAMIC_ATTRIBUTES ||
      isPrivateAttribute(field)
    ) {
      continue;
    }
    const value = primitive(rawValue);
    if (value !== undefined) {
      envelope[target] = value;
      dynamicAttributeCount += 1;
      continue;
    }

    const structured = sanitizeStructuredAttribute(rawValue, field);
    if (!structured) continue;
    envelope[target] = structured.value;
    if (structured.truncated) {
      structuredAttributesTruncated.push(target);
    }
    dynamicAttributeCount += 1;
  }
  if (structuredAttributesTruncated.length > 0) {
    envelope.structuredAttributesTruncated =
      structuredAttributesTruncated.slice(0, MAX_DYNAMIC_ATTRIBUTES);
  }

  const details = errorDetails(input.error ?? attributes.error);
  if (
    attributes.includeErrorDetails === true &&
    details?.errorMessage !== undefined
  )
    envelope.errorMessage = details.errorMessage;
  if (
    attributes.includeErrorDetails === true &&
    details?.errorCause !== undefined
  )
    envelope.errorCause = details.errorCause;
  const suppliedErrorName = primitive(attributes.errorName);
  const suppliedErrorStack = primitive(
    attributes.errorStack ?? attributes.stack,
  );
  const errorName =
    details?.errorName ??
    (typeof suppliedErrorName === 'string' ? suppliedErrorName : undefined);
  if (errorName) {
    envelope.errorName = errorName;
  }
  const stack =
    details?.errorStack ??
    (typeof suppliedErrorStack === 'string'
      ? sanitizeErrorStack(suppliedErrorStack)
      : undefined);
  if (stack) {
    envelope.errorStack = stack;
  }

  return envelope;
}

export function serializeProductionLogEnvelope(
  input: ProductionLogInput,
): string {
  return JSON.stringify(buildProductionLogEnvelope(input));
}
