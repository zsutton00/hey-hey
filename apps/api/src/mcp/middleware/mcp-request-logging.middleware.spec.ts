import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { McpRequestLoggingMiddleware } from './mcp-request-logging.middleware';

describe('McpRequestLoggingMiddleware', () => {
  it('logs request metadata without serializing telemetry arguments or results', () => {
    const finishHandlers: Array<() => void> = [];
    const response = {
      statusCode: 200,
      on: jest.fn((event: string, handler: () => void) => {
        if (event === 'finish') finishHandlers.push(handler);
        return response;
      }),
    } as unknown as Response;
    const request = {
      method: 'POST',
      body: {
        method: 'tools/call',
        id: 7,
        params: {
          name: 'get_agent_session',
          arguments: {
            contextData: {
              messageBreakdown: { assistantMessageTokens: 123 },
            },
            cost: { state: 'available', amountUsd: 1.25 },
          },
        },
      },
      headers: {
        authorization: 'Bearer secret-token',
        'x-organization-id':
          '11111111-1111-4111-8111-111111111111',
        'x-agent-session-id':
          '22222222-2222-4222-8222-222222222222',
        'x-conversation-id':
          '33333333-3333-4333-8333-333333333333',
      },
    } as unknown as Request;
    const next = jest.fn();
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    new McpRequestLoggingMiddleware().use(request, response, next);
    finishHandlers.forEach((handler) => handler());

    expect(next).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(log.mock.calls[0]?.[0] as string) as Record<
      string,
      unknown
    >;
    expect(logged).toEqual({
      event: 'mcp.request',
      httpMethod: 'POST',
      jsonrpcMethod: 'tools/call',
      jsonrpcId: 7,
      toolName: 'get_agent_session',
      status: 200,
      durationMs: expect.any(Number),
      headers: {
        authorization: true,
        'x-organization-id': true,
        'x-agent-session-id': true,
        'x-conversation-id': true,
        'x-message-id': false,
      },
    });
    expect(JSON.stringify(logged)).not.toContain('contextData');
    expect(JSON.stringify(logged)).not.toContain('assistantMessageTokens');
    expect(JSON.stringify(logged)).not.toContain('amountUsd');
    expect(JSON.stringify(logged)).not.toContain('secret-token');
  });
});
