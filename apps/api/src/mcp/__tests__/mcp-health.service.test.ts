import { ConfigService } from '@nestjs/config';
import { McpHealthService } from '../mcp-health.service';

function createService(
  overrides: Record<string, unknown> = {},
): McpHealthService {
  const config = {
    get: jest.fn((key: string, defaultValue: unknown) => {
      if (key in overrides) return overrides[key];
      return defaultValue;
    }),
  } as unknown as ConfigService;
  return new McpHealthService(config);
}

describe('McpHealthService', () => {
  it('starts in "starting" state', () => {
    const service = createService();
    expect(service.getState()).toBe('starting');
    expect(service.isReady()).toBe(false);
  });

  it('transitions to "ready" on module init', () => {
    const service = createService();
    service.onModuleInit();
    expect(service.getState()).toBe('ready');
    expect(service.isReady()).toBe(true);
  });

  it('transitions to "shutting_down" on module destroy', async () => {
    const service = createService({ MCP_SHUTDOWN_TIMEOUT_MS: 100 });
    service.onModuleInit();
    expect(service.isReady()).toBe(true);

    await service.onModuleDestroy();
    expect(service.getState()).toBe('shutting_down');
    expect(service.isReady()).toBe(false);
  });

  it('uses default shutdown timeout when not configured', () => {
    const config = {
      get: jest.fn((_key: string, defaultValue: unknown) => defaultValue),
    } as unknown as ConfigService;
    const service = new McpHealthService(config);

    expect(config.get).toHaveBeenCalledWith('MCP_SHUTDOWN_TIMEOUT_MS', 5000);
  });
});
