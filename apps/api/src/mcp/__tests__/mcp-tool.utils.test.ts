import { z } from 'zod';
import {
  mcpError,
  extractAuthContext,
  isAuthContext,
  paginationFields,
  truncate,
  resolveServiceId,
  isServiceId,
  resolveAgentSessionId,
  isAgentSessionId,
  AuthContext,
} from '../tools/mcp-tool.utils';

const ORG_ID = '00000000-0000-4000-8000-000000000001';

function makeRequest(opts: { orgId?: string; token?: string } = {}) {
  return {
    headers: {
      authorization: opts.token ? `Bearer ${opts.token}` : undefined,
    },
    cookies: {},
    user: opts.orgId
      ? {
          currentOrgId: opts.orgId,
          userId: 'u1',
          email: 't@t.com',
          name: 'T',
          orgMemberships: [],
          isDevAdmin: false,
          devAdminMode: false,
        }
      : undefined,
  };
}

describe('mcpError', () => {
  it('returns a CallToolResult with isError true', () => {
    const result = mcpError('Something went wrong');
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'Something went wrong' },
    ]);
  });

  it('wraps any message string', () => {
    const result = mcpError('');
    expect(result.content[0]).toEqual({ type: 'text', text: '' });
    expect(result.isError).toBe(true);
  });
});

describe('extractAuthContext', () => {
  it('returns AuthContext when user and org are present', () => {
    const result = extractAuthContext(
      {},
      makeRequest({ orgId: ORG_ID, token: 'tok123' }) as any,
    );

    expect(isAuthContext(result)).toBe(true);
    const ctx = result as AuthContext;
    expect(ctx.organizationId).toBe(ORG_ID);
    expect(ctx.token).toBe('tok123');
    expect(ctx.user.userId).toBe('u1');
  });

  it('prefers explicit organizationId param over user currentOrgId', () => {
    const explicitOrg = '00000000-0000-4000-8000-000000000099';
    const result = extractAuthContext(
      { organizationId: explicitOrg },
      makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
    );

    expect(isAuthContext(result)).toBe(true);
    expect((result as AuthContext).organizationId).toBe(explicitOrg);
  });

  it('returns error when no user is on the request', () => {
    const result = extractAuthContext({}, makeRequest() as any);

    expect(isAuthContext(result)).toBe(false);
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'Authentication required',
    );
  });

  it('returns error when no organizationId is available', () => {
    const req = makeRequest({ orgId: ORG_ID }) as any;
    req.user.currentOrgId = undefined;
    const result = extractAuthContext({}, req);

    expect(isAuthContext(result)).toBe(false);
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('Missing organizationId');
  });

  it('extracts token from Bearer header', () => {
    const result = extractAuthContext(
      {},
      makeRequest({ orgId: ORG_ID, token: 'jwt-abc' }) as any,
    );

    expect((result as AuthContext).token).toBe('jwt-abc');
  });

  it('falls back to cookie token when no Authorization header', () => {
    const req = makeRequest({ orgId: ORG_ID }) as any;
    req.headers.authorization = undefined;
    req.cookies = { accessToken: 'cookie-tok' };
    const result = extractAuthContext({}, req);

    expect((result as AuthContext).token).toBe('cookie-tok');
  });

  it('returns null token when neither header nor cookie exists', () => {
    const req = makeRequest({ orgId: ORG_ID }) as any;
    req.headers.authorization = undefined;
    req.cookies = {};
    const result = extractAuthContext({}, req);

    expect((result as AuthContext).token).toBeNull();
  });
});

describe('isAuthContext', () => {
  it('returns true for AuthContext objects', () => {
    const ctx: AuthContext = {
      user: { currentOrgId: ORG_ID } as any,
      organizationId: ORG_ID as any,
      token: null,
    };
    expect(isAuthContext(ctx)).toBe(true);
  });

  it('returns false for CallToolResult error objects', () => {
    const err = mcpError('fail');
    expect(isAuthContext(err)).toBe(false);
  });

  it('returns false for CallToolResult that contains a user key', () => {
    const tricky = {
      content: [{ type: 'text' as const, text: 'fail' }],
      isError: true,
      user: 'something',
    };
    expect(isAuthContext(tricky as any)).toBe(false);
  });
});

describe('resolveAgentSessionId', () => {
  it('returns the validated Agent Session ID from the request header', () => {
    const request = {
      headers: {
        'x-agent-session-id': '00000000-0000-4000-8000-000000000030',
      },
    } as any;

    const result = resolveAgentSessionId(request);

    expect(isAgentSessionId(result)).toBe(true);
    expect(result).toBe('00000000-0000-4000-8000-000000000030');
  });

  it('returns a diagnosable error when the Agent Session header is missing', () => {
    const result = resolveAgentSessionId({ headers: {} } as any);

    expect(isAgentSessionId(result)).toBe(false);
    expect((result as any).content[0].text).toContain('Missing agent session');
  });

  it('rejects a malformed Agent Session header', () => {
    const result = resolveAgentSessionId({
      headers: { 'x-agent-session-id': 'not-a-uuid' },
    } as any);

    expect(isAgentSessionId(result)).toBe(false);
    expect((result as any).content[0].text).toContain(
      'Invalid agent session ID',
    );
  });
});

describe('paginationFields', () => {
  const schema = z.object(paginationFields);

  it('applies default values', () => {
    const result = schema.parse({});
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(0);
  });

  it('accepts valid limit and offset', () => {
    const result = schema.parse({ limit: 50, offset: 20 });
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(20);
  });

  it('rejects limit above 100', () => {
    const result = schema.safeParse({ limit: 200 });
    expect(result.success).toBe(false);
  });

  it('rejects limit below 1', () => {
    const result = schema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative offset', () => {
    const result = schema.safeParse({ offset: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer limit', () => {
    const result = schema.safeParse({ limit: 10.5 });
    expect(result.success).toBe(false);
  });
});

describe('truncate', () => {
  it('returns empty string for undefined input', () => {
    expect(truncate(undefined, 100)).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(truncate('', 100)).toBe('');
  });

  it('returns text unchanged when within max length', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('returns text unchanged when exactly at max length', () => {
    expect(truncate('12345', 5)).toBe('12345');
  });

  it('truncates and appends ellipsis when exceeding max', () => {
    const result = truncate('abcdef', 5);
    expect(result).toBe('abcd…');
    expect(result.length).toBe(5);
  });

  it('produces only ellipsis when max is 1', () => {
    expect(truncate('abc', 1)).toBe('…');
  });

  it('handles large text with 300-char max', () => {
    const longText = 'A'.repeat(500);
    const result = truncate(longText, 300);
    expect(result.length).toBe(300);
    expect(result.endsWith('…')).toBe(true);
    expect(result.startsWith('A'.repeat(299))).toBe(true);
  });
});

describe('resolveServiceId', () => {
  it('returns serviceId from explicit parameter', () => {
    const req = { headers: {} } as any;
    const result = resolveServiceId({ serviceId: 'svc-123' }, req);
    expect(isServiceId(result)).toBe(true);
    expect(result).toBe('svc-123');
  });

  it('returns serviceId from X-Service-ID header', () => {
    const req = { headers: { 'x-service-id': 'svc-from-header' } } as any;
    const result = resolveServiceId({}, req);
    expect(isServiceId(result)).toBe(true);
    expect(result).toBe('svc-from-header');
  });

  it('prefers explicit param over header', () => {
    const req = { headers: { 'x-service-id': 'from-header' } } as any;
    const result = resolveServiceId({ serviceId: 'from-param' }, req);
    expect(result).toBe('from-param');
  });

  it('returns error when neither param nor header is set', () => {
    const req = { headers: {} } as any;
    const result = resolveServiceId({}, req);
    expect(isServiceId(result)).toBe(false);
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('Missing serviceId');
  });
});

describe('isServiceId', () => {
  it('returns true for string values', () => {
    expect(isServiceId('svc-1' as any)).toBe(true);
  });

  it('returns false for CallToolResult error objects', () => {
    expect(isServiceId(mcpError('fail') as any)).toBe(false);
  });
});
