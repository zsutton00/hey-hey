import { ConfigService } from '@nestjs/config';
import { McpHealthController } from '../mcp-health.controller';
import { McpHealthService, McpServerState } from '../mcp-health.service';
import type { Response } from 'express';

function mockResponse(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function mockHealthService(state: McpServerState): McpHealthService {
  return {
    getState: () => state,
    isReady: () => state === 'ready',
  } as McpHealthService;
}

function mockConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: jest.fn(
      (key: string, defaultValue: string) => overrides[key] ?? defaultValue,
    ),
  } as unknown as ConfigService;
}

describe('McpHealthController', () => {
  it('returns 200 with server info when ready', () => {
    const config = mockConfig({
      MCP_SERVER_NAME: 'test-mcp',
      MCP_SERVER_VERSION: '2.0.0',
    });
    const controller = new McpHealthController(
      mockHealthService('ready'),
      config,
    );
    const res = mockResponse();

    controller.getHealth(res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ready',
        name: 'test-mcp',
        version: '2.0.0',
        timestamp: expect.any(String),
      }),
    );
  });

  it('returns 503 when server is starting', () => {
    const controller = new McpHealthController(
      mockHealthService('starting'),
      mockConfig(),
    );
    const res = mockResponse();

    controller.getHealth(res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'starting' }),
    );
  });

  it('returns 503 when server is shutting down', () => {
    const controller = new McpHealthController(
      mockHealthService('shutting_down'),
      mockConfig(),
    );
    const res = mockResponse();

    controller.getHealth(res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'shutting_down',
      }),
    );
  });

  it('uses default name and version when not configured', () => {
    const controller = new McpHealthController(
      mockHealthService('ready'),
      mockConfig(),
    );
    const res = mockResponse();

    controller.getHealth(res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'hey-hey-mcp',
        version: '1.0.0',
      }),
    );
  });
});
