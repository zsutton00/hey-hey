import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { JsonLinesRunConformanceDriver, serveRunConformanceJsonLines } from './json-lines';
import { RUN_CONFORMANCE_PROTOCOL, processRequestSchema, processResponseSchema } from './protocol';
import { RunConformanceReferenceModel } from './reference-model';

describe('Run conformance JSON-lines transport', () => {
  it('serves the same stateful protocol one request and response per line', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let body = '';
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => {
      body += chunk;
    });
    const serving = serveRunConformanceJsonLines(input, output, new RunConformanceReferenceModel());
    input.end(
      `${JSON.stringify({
        protocol: RUN_CONFORMANCE_PROTOCOL,
        requestId: 'one',
        command: {
          kind: 'start',
          input: { inputId: 'input-1', prompt: 'hello', trigger: null, requiredReportTypes: [] },
        },
      })}\n${JSON.stringify({
        protocol: RUN_CONFORMANCE_PROTOCOL,
        requestId: 'two',
        command: { kind: 'observe' },
      })}\n`,
    );
    await serving;

    const responses = body
      .trim()
      .split('\n')
      .map((line) => processResponseSchema.parse(JSON.parse(line)));
    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({ requestId: 'one', ok: true });
    expect(responses[1]).toMatchObject({
      requestId: 'two',
      ok: true,
      observation: { activeTurn: { inputId: 'input-1' } },
    });
  });

  it('returns a correlated error for invalid input', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let body = '';
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => {
      body += chunk;
    });
    const serving = serveRunConformanceJsonLines(input, output, new RunConformanceReferenceModel());
    input.end('{"requestId":"bad","command":{"kind":"not-real"}}\n');
    await serving;
    expect(processResponseSchema.parse(JSON.parse(body))).toMatchObject({
      requestId: 'invalid-request',
      ok: false,
    });
  });

  it('provides a process-backed driver without exposing runner internals', async () => {
    const model = new RunConformanceReferenceModel();
    const driver = new JsonLinesRunConformanceDriver({
      request: async (line) => {
        const request = processRequestSchema.parse(JSON.parse(line));
        const observation = await model.execute(request.command);
        return JSON.stringify({
          protocol: RUN_CONFORMANCE_PROTOCOL,
          requestId: request.requestId,
          ok: true,
          observation,
        });
      },
    });
    await expect(
      driver.execute({
        kind: 'start',
        input: { inputId: 'remote', prompt: 'hello', trigger: null, requiredReportTypes: [] },
      }),
    ).resolves.toMatchObject({ activeTurn: { inputId: 'remote' } });
  });
});
