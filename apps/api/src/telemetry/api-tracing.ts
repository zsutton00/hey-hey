import {
  context,
  SpanKind,
  SpanStatusCode,
  trace,
  TraceFlags,
} from '@opentelemetry/api';
import {
  ExportResultCode,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { Span } from '@opentelemetry/api';
import type { WorkItemChangeSetOperation } from '../generated';
import { startApiProcessSampling } from './api-process-sampling';
import { startApiCpuProfiling } from './api-cpu-profiling';

const API_TRACER_NAME = 'hey-hey-api';
const DEFAULT_MAX_QUEUE_SIZE = 2048;
const MAX_QUEUE_SIZE = 8192;
const MAX_EXPORT_BATCH_SIZE = 512;
const EXPORT_TIMEOUT_MS = 2000;
const SCHEDULE_DELAY_MS = 5000;
const VALID_HTTP_METHODS = new Set([
  'CONNECT',
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
  'TRACE',
]);
const VALID_DATABASE_OPERATIONS = new Set([
  'BEGIN',
  'COMMIT',
  'CONNECT',
  'DELETE',
  'INSERT',
  'ROLLBACK',
  'SELECT',
  'UPDATE',
]);
export const API_SPAN_NAMES = [
  'domain_event.persist',
  'entity_context.assemble_full',
  'proposal.create',
  'proposal.create.transaction',
  'proposal.authoring.validate',
  'proposal.post_commit',
  'proposal.response.map',
  'proposal.change_set.materialize',
  'proposal.change_set.prepare',
  'proposal.change_set.claim',
  'proposal.change_set.apply',
  'proposal.change_set.publish',
  'proposal.change_set.release_fences',
  'proposal.change_set.checkpoint',
  'proposal.change_set.checkpoint.renew',
  'proposal.change_set.checkpoint.applying',
  'proposal.change_set.checkpoint.precheck',
  'proposal.change_set.checkpoint.mutation',
  'proposal.change_set.checkpoint.postcheck',
  'proposal.change_set.checkpoint.completed',
  'proposal.change_set.checkpoint.failed',
  'proposal.change_set.advisory_lock',
  'proposal.change_set.published_result',
  'proposal.change_set.edge_handoff',
  'work_item.write.advisory_lock',
  'work_item.patch.response_read',
] as const;
const CUSTOM_SPAN_NAMES: ReadonlySet<string> = new Set(API_SPAN_NAMES);
const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/i;
const TRACE_ID_UNSET = '00000000000000000000000000000000';
// Exact engine names only: unknown names may contain SQL or private content.
const PRISMA_PHASES = new Map([
  ['prisma:engine:connection', 'connection'],
  ['prisma:engine:db_query', 'db_query'],
  ['prisma:engine:commit_transaction', 'commit_transaction'],
  ['prisma:engine:serialize', 'serialize'],
  ['prisma:engine:response_json_serialization', 'response_json_serialization'],
  ['prisma:client:serialize', 'client_serialize'],
]);
const OPERATION_KINDS: readonly WorkItemChangeSetOperation['op'][] = [
  'workItem.create',
  'workItem.update',
  'workItem.delete',
  'section.replace',
  'section.clear',
  'layout.replace',
  'layout.clear',
  'relationship.create',
  'relationship.update',
  'relationship.delete',
];

type ApiSpanDetails = {
  operationKind: WorkItemChangeSetOperation['op'];
  operationIndex: number;
};

export interface ApiTracingConfig {
  deploymentEnvironment: 'development' | 'local' | 'staging';
  endpoint: string;
  sampleRate: number;
  maxQueueSize: number;
}

export function resolveApiTracingConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApiTracingConfig | undefined {
  if (environment.API_TRACING_ENABLED !== 'true') return undefined;

  const deploymentEnvironment =
    environment.DEPLOYMENT_ENVIRONMENT?.trim().toLowerCase();
  if (
    !['development', 'local', 'staging'].includes(deploymentEnvironment ?? '')
  ) {
    return undefined;
  }

  const diagnosticMode = environment.API_TRACING_DIAGNOSTIC_MODE === 'true';
  if (diagnosticMode && deploymentEnvironment !== 'local') return undefined;

  const traceEndpoint = environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  const endpoint = traceEndpoint
    ? normalizeOtlpTraceEndpoint(traceEndpoint, false)
    : normalizeOtlpTraceEndpoint(environment.OTEL_EXPORTER_OTLP_ENDPOINT, true);
  if (!endpoint) return undefined;

  const defaultSampleRate = deploymentEnvironment === 'staging' ? 0.05 : 0.1;
  const rawSampleRate = environment.API_TRACING_SAMPLE_RATE;
  const sampleRate =
    rawSampleRate === undefined
      ? diagnosticMode
        ? 1
        : defaultSampleRate
      : Number(rawSampleRate);
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
    return undefined;
  }
  if (sampleRate === 1 && !diagnosticMode) return undefined;

  const rawQueueSize = environment.API_TRACING_MAX_QUEUE_SIZE;
  const maxQueueSize =
    rawQueueSize === undefined ? DEFAULT_MAX_QUEUE_SIZE : Number(rawQueueSize);
  if (
    !Number.isInteger(maxQueueSize) ||
    maxQueueSize < 1 ||
    maxQueueSize > MAX_QUEUE_SIZE
  ) {
    return undefined;
  }

  return {
    deploymentEnvironment:
      deploymentEnvironment as ApiTracingConfig['deploymentEnvironment'],
    endpoint,
    sampleRate,
    maxQueueSize,
  };
}

function normalizeOtlpTraceEndpoint(
  value: string | undefined,
  appendTracePath: boolean,
): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return undefined;
    }
    if (!appendTracePath || parsed.pathname.endsWith('/v1/traces')) {
      return parsed.toString();
    }
    if (parsed.pathname === '/' || parsed.pathname === '') {
      parsed.pathname = '/v1/traces';
    } else {
      parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/v1/traces`;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function boundedMethod(value: unknown): string {
  if (typeof value !== 'string') return 'OTHER';
  const normalized = value.toUpperCase();
  return VALID_HTTP_METHODS.has(normalized) ? normalized : 'OTHER';
}

function boundedDatabaseOperation(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.toUpperCase();
  return VALID_DATABASE_OPERATIONS.has(normalized) ? normalized : undefined;
}

function safeExceptionEvent(event: ReadableSpan['events'][number]) {
  if (event.name !== 'exception') return undefined;

  const attributes: Record<string, string | boolean> = {};
  const exceptionType = event.attributes?.['exception.type'];
  if (
    typeof exceptionType === 'string' &&
    exceptionType.length <= 128 &&
    /^[A-Za-z0-9_.]+$/.test(exceptionType)
  ) {
    attributes['exception.type'] = exceptionType;
  }
  const escaped = event.attributes?.['exception.escaped'];
  if (typeof escaped === 'boolean') {
    attributes['exception.escaped'] = escaped;
  }
  return { name: 'exception', time: event.time, attributes };
}

/** Keep only bounded operational fields; request, SQL, and exception content is dropped. */
export function sanitizeReadableSpan(
  span: ReadableSpan,
): ReadableSpan | undefined {
  const scopeName = span.instrumentationScope.name.toLowerCase();
  const attributes: Record<string, string | number | boolean> = {};
  let name: string;
  let safeScope: string;

  if (scopeName.includes('http')) {
    const method = boundedMethod(
      span.attributes['http.request.method'] ?? span.attributes['http.method'],
    );
    attributes['http.request.method'] = method;

    const statusCode =
      span.attributes['http.response.status_code'] ??
      span.attributes['http.status_code'];
    if (
      typeof statusCode === 'number' &&
      statusCode >= 100 &&
      statusCode <= 599
    ) {
      attributes['http.response.status_code'] = statusCode;
    }
    name = `HTTP ${method}`;
    safeScope = 'http';
  } else if (scopeName.includes('prisma')) {
    const operation = boundedDatabaseOperation(
      span.attributes['db.operation.name'] ?? span.attributes['db.operation'],
    );
    attributes['db.system.name'] = 'postgresql';
    if (operation) attributes['db.operation.name'] = operation;
    const phase = PRISMA_PHASES.get(span.name);
    if (phase) attributes['prisma.phase'] = phase;
    name = phase
      ? `PostgreSQL ${phase}`
      : operation
        ? `PostgreSQL ${operation}`
        : 'PostgreSQL operation';
    safeScope = 'prisma';
  } else if (
    scopeName === API_TRACER_NAME &&
    CUSTOM_SPAN_NAMES.has(span.name)
  ) {
    name = span.name;
    safeScope = API_TRACER_NAME;
    const kind = span.attributes['operation.kind'];
    if (OPERATION_KINDS.some((value) => value === kind)) {
      attributes['operation.kind'] = kind as string;
    }
    const index = span.attributes['operation.index'];
    if (
      typeof index === 'number' &&
      Number.isSafeInteger(index) &&
      index >= 0
    ) {
      attributes['operation.index'] = index;
    }
  } else {
    return undefined;
  }

  const resourceAttributes: Record<string, string> = {};
  for (const field of [
    'service.name',
    'deployment.environment.name',
    'telemetry.sdk.language',
    'telemetry.sdk.name',
    'telemetry.sdk.version',
  ]) {
    const value = span.resource.attributes[field];
    if (typeof value === 'string' && value.length <= 128) {
      resourceAttributes[field] = value;
    }
  }

  return {
    ...span,
    // Keep the SDK method available to OTLP exporters without retaining the
    // SDK span as an enumerable bound-function property.
    spanContext: () => span.spanContext(),
    name,
    attributes,
    events: span.events
      .map(safeExceptionEvent)
      .filter(
        (event): event is NonNullable<typeof event> => event !== undefined,
      ),
    links: [],
    status: { code: span.status.code },
    resource: resourceFromAttributes(resourceAttributes),
    instrumentationScope: { name: safeScope },
  };
}

export class PrivacySafeSpanExporter implements SpanExporter {
  constructor(private readonly delegate: SpanExporter) {}

  export(
    spans: ReadableSpan[],
    resultCallback: Parameters<SpanExporter['export']>[1],
  ): void {
    try {
      this.delegate.export(
        spans
          .map(sanitizeReadableSpan)
          .filter((span): span is ReadableSpan => span !== undefined),
        resultCallback,
      );
    } catch {
      resultCallback({ code: ExportResultCode.FAILED });
    }
  }

  shutdown(): Promise<void> {
    try {
      return this.delegate.shutdown().catch(() => undefined);
    } catch {
      return Promise.resolve();
    }
  }
}

export function createApiTracingSdk(
  config: ApiTracingConfig,
  exporter: SpanExporter = new OTLPTraceExporter({
    url: config.endpoint,
    timeoutMillis: EXPORT_TIMEOUT_MS,
  }),
): NodeSDK {
  const resource = resourceFromAttributes({
    'service.name': 'hey-hey-api',
    'deployment.environment.name': config.deploymentEnvironment,
  });
  return new NodeSDK({
    autoDetectResources: false,
    serviceName: 'hey-hey-api',
    resource,
    sampler: createApiTracingSampler(config.sampleRate),
    textMapPropagator: new W3CTraceContextPropagator(),
    instrumentations: [
      new HttpInstrumentation({
        headersToSpanAttributes: {},
      }),
      new PrismaInstrumentation(),
    ],
    spanProcessors: [
      new BatchSpanProcessor(new PrivacySafeSpanExporter(exporter), {
        maxQueueSize: config.maxQueueSize,
        maxExportBatchSize: Math.min(
          config.maxQueueSize,
          MAX_EXPORT_BATCH_SIZE,
        ),
        scheduledDelayMillis: SCHEDULE_DELAY_MS,
        exportTimeoutMillis: EXPORT_TIMEOUT_MS,
      }),
    ],
    // This service keeps application logs and metrics on their existing pipelines.
    logRecordProcessors: [],
    metricReaders: [],
  });
}

export function createApiTracingSampler(
  sampleRate: number,
): ParentBasedSampler {
  const environmentSampler = new TraceIdRatioBasedSampler(sampleRate);
  return new ParentBasedSampler({
    root: environmentSampler,
    // A remote sampled flag is a caller-controlled hint. Reapply the API's
    // environment rate so an inbound traceparent cannot force full sampling.
    remoteParentSampled: environmentSampler,
  });
}

let tracingSdk: NodeSDK | undefined;
let stopProcessSampling: (() => void) | undefined;
let cpuProfiling: Promise<() => Promise<void>> | undefined;
export function startApiTracing(): void {
  if (tracingSdk) return;
  const config = resolveApiTracingConfig();
  if (!config) {
    if (process.env.API_TRACING_ENABLED === 'true') {
      console.warn(
        'API tracing remains disabled because its environment, sampling, endpoint, or queue configuration is not permitted.',
      );
    }
    return;
  }

  try {
    tracingSdk = createApiTracingSdk(config);
    tracingSdk.start();
  } catch {
    tracingSdk = undefined;
    console.warn(
      'API tracing could not start; requests will continue without traces.',
    );
  }
  if (tracingSdk && config.deploymentEnvironment === 'staging') {
    cpuProfiling = startApiCpuProfiling((record) =>
      console.log(JSON.stringify(record)),
    ).catch(() => {
      console.warn('API diagnostic CPU profile unavailable');
      return async () => {};
    });
    try {
      stopProcessSampling = startApiProcessSampling((record) =>
        console.log(JSON.stringify(record)),
      );
    } catch {
      console.warn('API diagnostic process sampling unavailable.');
    }
  }
}

export async function shutdownApiTracing(): Promise<void> {
  await (
    await cpuProfiling
  )?.();
  cpuProfiling = undefined;
  stopProcessSampling?.();
  stopProcessSampling = undefined;
  const sdk = tracingSdk;
  tracingSdk = undefined;
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch {
    // A collector outage during shutdown must not alter the API's exit path.
  }
}

export async function withApiSpan<T>(
  name: (typeof API_SPAN_NAMES)[number],
  operation: () => Promise<T>,
  details?: ApiSpanDetails,
): Promise<T> {
  let span: Span;
  try {
    span = trace.getTracer(API_TRACER_NAME).startSpan(name, {
      kind: SpanKind.INTERNAL,
      attributes: details
        ? {
            'operation.kind': details.operationKind,
            'operation.index': details.operationIndex,
          }
        : undefined,
    });
  } catch {
    return operation();
  }

  let callbackEntered = false;
  try {
    return await context.with(
      trace.setSpan(context.active(), span),
      async () => {
        callbackEntered = true;
        try {
          return await operation();
        } catch (error) {
          try {
            if (error instanceof Error) span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
          } catch {
            // Span recording is diagnostic and cannot replace the application error.
          }
          throw error;
        } finally {
          try {
            span.end();
          } catch {
            // Span shutdown cannot change the operation result.
          }
        }
      },
    );
  } catch (error) {
    if (!callbackEntered) {
      try {
        span.end();
      } catch {
        // Span shutdown cannot change the operation result.
      }
      return operation();
    }
    throw error;
  }
}

export function activeTraceId(): string | undefined {
  try {
    const spanContext = trace.getSpan(context.active())?.spanContext();
    if (
      !spanContext ||
      !TRACE_ID_PATTERN.test(spanContext.traceId) ||
      spanContext.traceId.toLowerCase() === TRACE_ID_UNSET
    ) {
      return undefined;
    }
    return spanContext.traceId;
  } catch {
    return undefined;
  }
}

export function activeTraceSampled(): boolean | undefined {
  const spanContext = trace.getSpan(context.active())?.spanContext();
  return spanContext
    ? (spanContext.traceFlags & TraceFlags.SAMPLED) !== 0
    : undefined;
}
