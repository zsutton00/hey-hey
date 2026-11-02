import { SearchReceiptStore } from './search-receipt.store';
import type { RedisService } from '../../core/redis/redis.service';
import type { ConfigService } from '@nestjs/config';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const RECEIPT_ID = '00000000-0000-4000-8000-000000000003';

describe('SearchReceiptStore', () => {
  const set = jest.fn();
  const get = jest.fn();
  const store = new SearchReceiptStore(
    { getClient: () => ({ set, get }) } as unknown as RedisService,
    { get: () => 240 } as unknown as ConfigService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores a fresh scoped receipt with the query and a short Redis expiry', async () => {
    const id = await store.issue(
      { agentSessionId: SESSION_ID, projectId: PROJECT_ID },
      'unified_search',
      { queries: ['billing', 'auth'] },
    );

    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    const [key, serialized, expiryMode, ttl] = set.mock.calls[0]!;
    expect(key).toBe(`mcp:project-graph-search-receipt:${id}`);
    expect(expiryMode).toBe('EX');
    expect(ttl).toBe(240);
    expect(JSON.parse(serialized)).toEqual({
      agentSessionId: SESSION_ID,
      projectId: PROJECT_ID,
      tool: 'unified_search',
      input: { queries: ['billing', 'auth'] },
      createdAt: expect.any(String),
    });
  });

  it('accepts reusable same-session and same-project receipts and rejects invalid scopes', async () => {
    get.mockResolvedValue(
      JSON.stringify({ agentSessionId: SESSION_ID, projectId: PROJECT_ID }),
    );
    const scope = { agentSessionId: SESSION_ID, projectId: PROJECT_ID };

    await expect(store.validate(RECEIPT_ID, scope)).resolves.toBeNull();
    await expect(store.validate(RECEIPT_ID, scope)).resolves.toBeNull();
    await expect(
      store.validate(RECEIPT_ID, { ...scope, agentSessionId: 'other-session' }),
    ).resolves.toContain('different agent session or project');
    await expect(
      store.validate(RECEIPT_ID, { ...scope, projectId: 'other-project' }),
    ).resolves.toContain('different agent session or project');
  });

  it('gives actionable errors for missing and expired receipts', async () => {
    get.mockResolvedValue(null);
    const scope = { agentSessionId: SESSION_ID, projectId: PROJECT_ID };

    await expect(store.validate(undefined, scope)).resolves.toContain(
      'Run unified_search',
    );
    await expect(store.validate(RECEIPT_ID, scope)).resolves.toContain(
      'unknown or expired',
    );
  });

  it('requires a valid agent-session header for receipt scope', () => {
    expect(
      store.resolveScope(
        { headers: { 'x-agent-session-id': SESSION_ID } } as never,
        PROJECT_ID,
      ),
    ).toEqual({ agentSessionId: SESSION_ID, projectId: PROJECT_ID });
    expect(store.resolveScope({ headers: {} } as never, PROJECT_ID)).toBeNull();
    expect(
      store.resolveScope(
        { headers: { 'x-agent-session-id': 'invalid' } } as never,
        PROJECT_ID,
      ),
    ).toBeNull();
  });
});
