import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import {
  RUN_CONFORMANCE_PROTOCOL,
  processRequestSchema,
  processResponseSchema,
  type RunConformanceCommand,
  type RunConformanceDriver,
  type RunConformanceObservation,
  type RunConformanceProcessResponse,
} from './protocol';

export interface JsonLineProcessPeer {
  request(line: string): Promise<string>;
}

export class JsonLinesRunConformanceDriver implements RunConformanceDriver {
  private nextRequest = 1;

  public constructor(private readonly peer: JsonLineProcessPeer) {}

  public async execute(command: RunConformanceCommand): Promise<RunConformanceObservation> {
    const requestId = `request-${String(this.nextRequest++)}`;
    const line = JSON.stringify({ protocol: RUN_CONFORMANCE_PROTOCOL, requestId, command });
    const response = processResponseSchema.parse(JSON.parse(await this.peer.request(line)));
    if (response.requestId !== requestId) {
      throw new Error(
        `Mismatched JSON-lines response: expected ${requestId}, received ${response.requestId}.`,
      );
    }
    if (!response.ok) throw new Error(response.error);
    return response.observation;
  }
}

/** Serve one stateful driver over newline-delimited JSON without coupling the peer to the test runner. */
export const serveRunConformanceJsonLines = async (
  input: Readable,
  output: Writable,
  driver: RunConformanceDriver,
): Promise<void> => {
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === '') continue;
    let response: RunConformanceProcessResponse;
    try {
      const request = processRequestSchema.parse(JSON.parse(line));
      response = {
        protocol: RUN_CONFORMANCE_PROTOCOL,
        requestId: request.requestId,
        ok: true,
        observation: await driver.execute(request.command),
      };
    } catch (error) {
      response = {
        protocol: RUN_CONFORMANCE_PROTOCOL,
        requestId: readRequestId(line),
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    output.write(`${JSON.stringify(response)}\n`);
  }
};

const readRequestId = (line: string): string => {
  try {
    const parsed = processRequestSchema.partial().parse(JSON.parse(line));
    return parsed.requestId ?? 'invalid-request';
  } catch {
    return 'invalid-request';
  }
};
