import { execFileSync } from 'node:child_process';
import { ROOT_CONTEXT, SpanKind, TraceFlags, trace } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import { SamplingDecision } from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import {
  API_SPAN_NAMES,
  createApiTracingSampler,
  PrivacySafeSpanExporter,
  resolveApiTracingConfig,
  sanitizeReadableSpan,
  withApiSpan,
} from '../api-tracing';

it.each(API_SPAN_NAMES)(
  'exports safe operation %s without private attributes',
  (name) => {
    const sanitized = sanitizeReadableSpan(
      readableSpan({
        name,
        instrumentationScope: { name: 'hey-hey-api' },
      }),
    );
    expect(sanitized?.name).toBe(name);
    expect(sanitized?.attributes).toEqual({});
    expect(JSON.stringify(sanitized)).not.toMatch(/private|secret/);
  },
);

function readableSpan(overrides: Partial<ReadableSpan> = {}): ReadableSpan {
  return {
    spanContext: () => ({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: 1,
    }),
    name: 'GET /accounts/6d0f?token=private',
    attributes: {
      'http.request.method': 'get',
      'http.response.status_code': 200,
      'url.full': 'https://api.example/accounts/private-id?token=secret',
      'http.route': '/accounts/private-id',
      'db.statement': 'SELECT * FROM account WHERE id = private-id',
    },
    events: [
      {
        name: 'exception',
        time: [1, 0],
        attributes: {
          'exception.type': 'Error',
          'exception.message': 'private payload',
          'exception.stacktrace': 'private stack',
        },
      },
    ],
    links: [],
    status: { code: 2, message: 'private error text' },
    instrumentationScope: {
      name: '@opentelemetry/instrumentation-http',
      version: '0.222.0',
      attributes: { 'request.id': 'private-id' },
    },
    resource: {
      attributes: {
        'service.name': 'hey-hey-api',
        'process.command_line': 'private command line',
      },
    },
    ...overrides,
  } as unknown as ReadableSpan;
}

it.each(['connection', 'db_query', 'commit_transaction'])(
  'preserves the exact Prisma engine %s phase without SQL',
  (phase) => {
    const sanitized = sanitizeReadableSpan(
      readableSpan({
        name: `prisma:engine:${phase}`,
        instrumentationScope: { name: 'prisma' },
      }),
    );
    expect(sanitized?.attributes['prisma.phase']).toBe(phase);
    expect(sanitized?.name).toBe(`PostgreSQL ${phase}`);
    expect(JSON.stringify(sanitized)).not.toMatch(/private|secret/);
    const unknown = sanitizeReadableSpan(
      readableSpan({
        name: `prisma:engine:${phase} private SQL`,
        instrumentationScope: { name: 'prisma' },
      }),
    );
    expect(unknown?.attributes['prisma.phase']).toBeUndefined();
  },
);

it('keeps only safe checkpoint identity attributes', () => {
  const sanitized = sanitizeReadableSpan(
    readableSpan({
      name: 'proposal.change_set.checkpoint.precheck',
      instrumentationScope: { name: 'hey-hey-api' },
      attributes: {
        'operation.kind': 'section.replace',
        'operation.index': 0,
        'section.content': 'private',
      },
    }),
  );
  expect(sanitized?.attributes).toEqual({
    'operation.kind': 'section.replace',
    'operation.index': 0,
  });
});

describe('API tracing configuration', () => {
  const baseEnvironment = {
    API_TRACING_ENABLED: 'true',
    DEPLOYMENT_ENVIRONMENT: 'staging',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://alloy.internal:4318',
  };

  it('keeps tracing disabled unless the endpoint and explicit gate are configured', () => {
    expect(resolveApiTracingConfig({})).toBeUndefined();
    expect(
      resolveApiTracingConfig({
        ...baseEnvironment,
        API_TRACING_ENABLED: 'false',
      }),
    ).toBeUndefined();
    expect(
      resolveApiTracingConfig({
        ...baseEnvironment,
        OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
      }),
    ).toBeUndefined();
  });

  it('uses bounded staging sampling and appends the trace endpoint path', () => {
    expect(resolveApiTracingConfig(baseEnvironment)).toMatchObject({
      deploymentEnvironment: 'staging',
      endpoint: 'http://alloy.internal:4318/v1/traces',
      sampleRate: 0.05,
      maxQueueSize: 2048,
    });
  });

  it('blocks production and permits full sampling only for marked local diagnostics', () => {
    expect(
      resolveApiTracingConfig({
        ...baseEnvironment,
        DEPLOYMENT_ENVIRONMENT: 'production',
      }),
    ).toBeUndefined();
    expect(
      resolveApiTracingConfig({
        ...baseEnvironment,
        NODE_ENV: 'production',
      }),
    ).toMatchObject({ deploymentEnvironment: 'staging', sampleRate: 0.05 });
    expect(
      resolveApiTracingConfig({
        ...baseEnvironment,
        DEPLOYMENT_ENVIRONMENT: 'local',
        API_TRACING_SAMPLE_RATE: '1',
      }),
    ).toBeUndefined();
    expect(
      resolveApiTracingConfig({
        ...baseEnvironment,
        DEPLOYMENT_ENVIRONMENT: 'local',
        API_TRACING_DIAGNOSTIC_MODE: 'true',
        API_TRACING_SAMPLE_RATE: '1',
      }),
    ).toMatchObject({ sampleRate: 1, deploymentEnvironment: 'local' });
  });

  it('applies the configured sample rate even when an incoming parent is sampled', () => {
    const sampler = createApiTracingSampler(0.05);
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const parentContext = trace.setSpanContext(ROOT_CONTEXT, {
      traceId,
      spanId: '00f067aa0ba902b7',
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
    });

    const result = sampler.shouldSample(
      parentContext,
      traceId,
      'incoming request',
      SpanKind.SERVER,
      {},
      [],
    );

    expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it('uses an explicitly configured trace endpoint without adding a path', () => {
    expect(
      resolveApiTracingConfig({
        ...baseEnvironment,
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
          'http://alloy.internal:4318/custom/trace-ingest',
      }),
    ).toMatchObject({
      endpoint: 'http://alloy.internal:4318/custom/trace-ingest',
    });
  });

  it('rejects unbounded queue and invalid sampling values', () => {
    expect(
      resolveApiTracingConfig({
        ...baseEnvironment,
        API_TRACING_MAX_QUEUE_SIZE: '8193',
      }),
    ).toBeUndefined();
    expect(
      resolveApiTracingConfig({
        ...baseEnvironment,
        API_TRACING_SAMPLE_RATE: 'NaN',
      }),
    ).toBeUndefined();
  });
});

describe('privacy-safe span export', () => {
  it('keeps bounded HTTP fields and removes request, SQL, event, and resource content', () => {
    const sanitized = sanitizeReadableSpan(readableSpan());

    expect(sanitized).toMatchObject({
      name: 'HTTP GET',
      attributes: {
        'http.request.method': 'GET',
        'http.response.status_code': 200,
      },
      status: { code: 2 },
      instrumentationScope: { name: 'http' },
      resource: { attributes: { 'service.name': 'hey-hey-api' } },
    });
    expect(sanitized?.events).toEqual([
      {
        name: 'exception',
        time: [1, 0],
        attributes: { 'exception.type': 'Error' },
      },
    ]);
    expect(JSON.stringify(sanitized)).not.toMatch(
      /private|accounts\/6d0f|private-id|token=|SELECT \*/i,
    );
  });

  it('labels Prisma spans as PostgreSQL and rejects unknown instrumentation scopes', () => {
    const prismaSpan = sanitizeReadableSpan(
      readableSpan({
        name: 'prisma:engine:query SELECT * FROM private_table',
        attributes: {
          'db.operation.name': 'select',
          'db.statement': 'SELECT * FROM private_table',
        },
        instrumentationScope: {
          name: 'prisma',
        } as ReadableSpan['instrumentationScope'],
      }),
    );

    expect(prismaSpan).toMatchObject({
      name: 'PostgreSQL SELECT',
      attributes: {
        'db.system.name': 'postgresql',
        'db.operation.name': 'SELECT',
      },
    });
    expect(JSON.stringify(prismaSpan)).not.toContain('private_table');
    expect(
      sanitizeReadableSpan(
        readableSpan({
          instrumentationScope: {
            name: 'unknown-library',
          } as ReadableSpan['instrumentationScope'],
        }),
      ),
    ).toBeUndefined();
  });

  it('contains exporter failures and shutdown errors', async () => {
    const delegate = {
      export: jest.fn(() => {
        throw new Error('collector unavailable');
      }),
      shutdown: jest.fn().mockRejectedValue(new Error('collector unavailable')),
    } as unknown as SpanExporter;
    const exporter = new PrivacySafeSpanExporter(delegate);
    const callback = jest.fn();

    expect(() => exporter.export([readableSpan()], callback)).not.toThrow();
    expect(callback).toHaveBeenCalledWith({ code: ExportResultCode.FAILED });
    await expect(exporter.shutdown()).resolves.toBeUndefined();
  });
});

describe('custom span wrapper', () => {
  it('returns the operation result and rethrows the same application error', async () => {
    await expect(
      withApiSpan('entity_context.assemble_full', async () => 'assembled'),
    ).resolves.toBe('assembled');

    const failure = new Error('context lookup failed');
    await expect(
      withApiSpan('domain_event.persist', async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});

describe('isolated HTTP tracing integration', () => {
  it('continues sampled and unsampled W3C context, starts absent context, and correlates logs', () => {
    const program = String.raw`
      const net = require('node:net');
      const { createApiTracingSdk, withApiSpan } = require('./src/telemetry/api-tracing');
      const { CustomLoggerService } = require('./src/common/logger/logger.service');
      const exportedSpans = [];
      const exporter = {
        export(spans, callback) {
          exportedSpans.push(...spans);
          callback({ code: 0 });
        },
        shutdown() { return Promise.resolve(); },
      };
      const sdk = createApiTracingSdk({
        deploymentEnvironment: 'local',
        endpoint: 'http://127.0.0.1:4318/v1/traces',
        sampleRate: 1,
        maxQueueSize: 16,
      }, exporter);
      process.env.LOG_LEVEL = 'silent';
      let http;
      const logger = new CustomLoggerService();
      const outboundTraceparents = [];
      const activeTraceIds = [];
      const logTraceIds = [];
      const logTraceSampled = [];
      let sink;
      let api;
      const failure = new Error('private diagnostic detail');
      let originalErrorPreserved = false;
      function listen(server) {
        return new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', () => {
            server.removeListener('error', reject);
            resolve(server.address().port);
          });
        });
      }
      function request(port, traceparent) {
        return new Promise((resolve, reject) => {
          const socket = net.connect(port, '127.0.0.1', () => {
            const parentHeader = traceparent ? 'traceparent: ' + traceparent + '\r\n' : '';
            socket.write('GET /private/private-id?token=very-secret HTTP/1.1\r\nHost: localhost\r\n' + parentHeader + 'Connection: close\r\n\r\n');
          });
          let response = '';
          socket.on('data', (chunk) => response += chunk.toString());
          socket.on('end', () => resolve(response));
          socket.on('error', reject);
        });
      }
      (async () => {
        sdk.start();
        http = require('node:http');
        sink = http.createServer((request, response) => {
          outboundTraceparents.push(request.headers.traceparent || null);
          response.end('sink');
        });
        const sinkPort = await listen(sink);
        api = http.createServer(async (request, response) => {
          activeTraceIds.push(require('./src/telemetry/api-tracing').activeTraceId() || null);
          logTraceIds.push(logger.buildEnvelopeForTest('info', 'request traced').traceId || null);
          logTraceSampled.push(logger.buildEnvelopeForTest('info', 'request traced').traceSampled);
          if (activeTraceIds.length === 1) {
            try {
              await withApiSpan('domain_event.persist', async () => { throw failure; });
            } catch (error) {
              originalErrorPreserved = error === failure;
            }
          }
          const outgoing = http.get({ hostname: '127.0.0.1', port: sinkPort, path: '/' }, (downstream) => {
            downstream.resume();
            downstream.on('end', () => response.end('api'));
          });
          outgoing.on('error', () => {
            response.statusCode = 502;
            response.end('outbound failed');
          });
        });
        const apiPort = await listen(api);
        const sampledTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
        const unsampledTraceId = '1bf92f3577b34da6a3ce929d0e0e4736';
        await request(apiPort, '00-' + sampledTraceId + '-00f067aa0ba902b7-01');
        await request(apiPort, undefined);
        await request(apiPort, '00-' + unsampledTraceId + '-00f067aa0ba902b7-00');
        await new Promise((resolve) => api.close(resolve));
        await new Promise((resolve) => sink.close(resolve));
        await sdk.shutdown();
        const spans = exportedSpans;
        process.stdout.write(JSON.stringify({
          outboundTraceparents,
          activeTraceIds,
          logTraceIds,
          logTraceSampled,
          originalErrorPreserved,
          spanSummaries: spans.map((span) => ({
            name: span.name,
            scope: span.instrumentationScope.name,
            status: span.status.code,
          })),
          exportedTraceIds: spans.map((span) => span.spanContext().traceId),
          exportedContent: JSON.stringify(spans.map((span) => ({
            name: span.name,
            attributes: span.attributes,
            events: span.events,
            resourceAttributes: span.resource.attributes,
          }))),
        }));
      })().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    `;
    const output = execFileSync(
      process.execPath,
      ['-r', 'ts-node/register', '-e', program],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 20_000,
      },
    );
    const result = JSON.parse(output) as {
      outboundTraceparents: Array<string | null>;
      activeTraceIds: Array<string | null>;
      logTraceIds: Array<string | null>;
      logTraceSampled: boolean[];
      originalErrorPreserved: boolean;
      spanSummaries: Array<{ name: string; scope: string; status: number }>;
      exportedTraceIds: string[];
      exportedContent: string;
    };

    expect(result.outboundTraceparents[0]).toMatch(
      new RegExp(`^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$`),
    );
    expect(result.outboundTraceparents[1]).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/,
    );
    expect(result.outboundTraceparents[1]).not.toContain(
      '00000000000000000000000000000000',
    );
    expect(result.outboundTraceparents[2]).toMatch(
      new RegExp(`^00-1bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-00$`),
    );
    expect(result.activeTraceIds).toEqual([
      '4bf92f3577b34da6a3ce929d0e0e4736',
      result.activeTraceIds[1],
      '1bf92f3577b34da6a3ce929d0e0e4736',
    ]);
    expect(result.activeTraceIds[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(result.logTraceIds).toEqual(result.activeTraceIds);
    expect(result.logTraceSampled).toEqual([true, true, false]);
    expect(result.originalErrorPreserved).toBe(true);
    expect(result.spanSummaries).toContainEqual({
      name: 'domain_event.persist',
      scope: 'hey-hey-api',
      status: 2,
    });
    expect(result.exportedTraceIds).not.toContain(
      '1bf92f3577b34da6a3ce929d0e0e4736',
    );
    expect(result.exportedTraceIds).toContain(
      '4bf92f3577b34da6a3ce929d0e0e4736',
    );
    expect(result.exportedContent).not.toMatch(
      /private-id|very-secret|private diagnostic detail/,
    );
  });
});
