import type { Request } from 'express';
import {
  HintReadToolsProvider,
  HintWriteToolsProvider,
} from './hint-tools.provider';
import * as TestUtils from '../../utils/testUtils';

const { testIds } = TestUtils;
const sessionId = '33333333-3333-4333-8333-333333333333';
const itemId = '11111111-1111-4111-8111-111111111111';

function makeRequest(headers: Record<string, string> = {}): Request {
  return {
    user: { userId: testIds.user, currentOrgId: testIds.organization },
    headers: {
      authorization: 'Bearer token',
      'x-project-id': testIds.project,
      ...headers,
    },
  } as unknown as Request;
}

describe('hint tool providers', () => {
  it('records the current agent session as origin when no message is given', async () => {
    const hintService = {
      createHint: jest.fn().mockResolvedValue({ id: 'h1' }),
    };
    const provider = new HintWriteToolsProvider(hintService as never);

    const result = await provider.createHint(
      { text: 'note', connections: [{ itemId, itemType: 'TASK' }] },
      {} as never,
      makeRequest({ 'x-agent-session-id': sessionId }),
    );

    expect(result).toEqual({ hint: { id: 'h1' } });
    expect(hintService.createHint).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: testIds.project, token: 'token' }),
      {
        text: 'note',
        origin: { entityType: 'AGENT_SESSION', entityId: sessionId },
        connections: [
          { targetNodeId: itemId, targetEntityType: 'TASK', strength: 1 },
        ],
      },
    );
  });

  it('returns a tool error instead of throwing when the service refuses', async () => {
    const hintService = {
      findHintsForItems: jest.fn().mockRejectedValue(new Error('nope')),
    };
    const provider = new HintReadToolsProvider(hintService as never);

    const result = await provider.getHintsForItems(
      { itemIds: [itemId] },
      {} as never,
      makeRequest(),
    );

    expect(result).toMatchObject({ isError: true });
  });
});

describe('hint tool registration', () => {
  const original = process.env.HINTS_ENABLED;
  afterEach(() => {
    process.env.HINTS_ENABLED = original;
    jest.resetModules();
  });

  const loadProviders = (enabled: string | undefined) => {
    if (enabled === undefined) delete process.env.HINTS_ENABLED;
    else process.env.HINTS_ENABLED = enabled;
    let providers: unknown[] = [];
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { McpServerModule } = require('../mcp-server.module');
      providers = Reflect.getMetadata(
        'providers',
        McpServerModule as object,
      ) as unknown[];
    });
    return providers.map((p) => (p as { name?: string }).name);
  };

  it.each([undefined, 'false', 'true'])(
    'always offers read and write hint tools (legacy setting %s)',
    (setting) => {
      const names = loadProviders(setting);
      expect(names).toContain('HintWriteToolsProvider');
      expect(names).toContain('HintReadToolsProvider');
    },
  );
});
