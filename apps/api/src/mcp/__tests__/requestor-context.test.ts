import {
  extractRequestorContext,
  requestorContextSchema,
  RequestorContext,
} from '../tools/requestor-context';
import type { AuthContext } from '../tools/mcp-tool.utils';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000099';
const TOOL_NAME = 'edit_task';

function makeAuthContext(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      userId: USER_ID as any,
      email: 'test@example.com',
      name: 'Test User',
      currentOrgId: ORG_ID as any,
      orgMemberships: [],
      isDevAdmin: false,
      devAdminMode: false,
    },
    organizationId: ORG_ID as any,
    token: 'tok-123',
    ...overrides,
  };
}

function makeRequest(
  opts: {
    userAgent?: string;
    ip?: string;
    conversationIdHeader?: string;
    serviceIdHeader?: string;
  } = {},
) {
  return {
    headers: {
      'user-agent': opts.userAgent ?? 'TestAgent/1.0',
      ...(opts.conversationIdHeader
        ? { 'x-conversation-id': opts.conversationIdHeader }
        : {}),
      ...(opts.serviceIdHeader ? { 'x-service-id': opts.serviceIdHeader } : {}),
    },
    ip: opts.ip ?? '127.0.0.1',
  } as any;
}

describe('requestorContextSchema', () => {
  it('accepts a valid full context', () => {
    const input: RequestorContext = {
      userId: USER_ID,
      organizationId: ORG_ID,
      toolName: TOOL_NAME,
      timestamp: new Date().toISOString(),
      source: 'agent',
      conversationId: 'conv-123',
      userAgent: 'TestAgent/1.0',
      ipAddress: '10.0.0.1',
    };
    expect(requestorContextSchema.parse(input)).toEqual(input);
  });

  it('accepts context without optional fields', () => {
    const input = {
      userId: USER_ID,
      organizationId: ORG_ID,
      toolName: TOOL_NAME,
      timestamp: new Date().toISOString(),
      source: 'agent' as const,
    };
    const result = requestorContextSchema.parse(input);
    expect(result.conversationId).toBeUndefined();
    expect(result.userAgent).toBeUndefined();
    expect(result.ipAddress).toBeUndefined();
  });

  it('accepts non-uuid userId (only min-length validated)', () => {
    const input = {
      userId: 'not-a-uuid',
      organizationId: ORG_ID,
      toolName: TOOL_NAME,
      timestamp: new Date().toISOString(),
      source: 'agent' as const,
    };
    expect(requestorContextSchema.safeParse(input).success).toBe(true);
  });

  it('rejects invalid organizationId', () => {
    const input = {
      userId: USER_ID,
      organizationId: 'not-a-uuid',
      toolName: TOOL_NAME,
      timestamp: new Date().toISOString(),
      source: 'agent' as const,
    };
    expect(requestorContextSchema.safeParse(input).success).toBe(false);
  });

  it('rejects invalid timestamp', () => {
    const input = {
      userId: USER_ID,
      organizationId: ORG_ID,
      toolName: TOOL_NAME,
      timestamp: 'last tuesday',
      source: 'agent' as const,
    };
    expect(requestorContextSchema.safeParse(input).success).toBe(false);
  });

  it('rejects userAgent exceeding 500 chars', () => {
    const input = {
      userId: USER_ID,
      organizationId: ORG_ID,
      toolName: TOOL_NAME,
      timestamp: new Date().toISOString(),
      source: 'agent' as const,
      userAgent: 'A'.repeat(501),
    };
    expect(requestorContextSchema.safeParse(input).success).toBe(false);
  });

  it('rejects invalid ipAddress', () => {
    const input = {
      userId: USER_ID,
      organizationId: ORG_ID,
      toolName: TOOL_NAME,
      timestamp: new Date().toISOString(),
      source: 'agent' as const,
      ipAddress: 'not-an-ip',
    };
    expect(requestorContextSchema.safeParse(input).success).toBe(false);
  });

  it('accepts IPv6 address', () => {
    const input = {
      userId: USER_ID,
      organizationId: ORG_ID,
      toolName: TOOL_NAME,
      timestamp: new Date().toISOString(),
      source: 'agent' as const,
      ipAddress: '::1',
    };
    expect(requestorContextSchema.safeParse(input).success).toBe(true);
  });

  it('rejects missing source', () => {
    const input = {
      userId: USER_ID,
      organizationId: ORG_ID,
      toolName: TOOL_NAME,
      timestamp: new Date().toISOString(),
    };
    expect(requestorContextSchema.safeParse(input).success).toBe(false);
  });

  it('rejects invalid source value', () => {
    const input = {
      userId: USER_ID,
      organizationId: ORG_ID,
      toolName: TOOL_NAME,
      timestamp: new Date().toISOString(),
      source: 'system',
    };
    expect(requestorContextSchema.safeParse(input).success).toBe(false);
  });

  it('accepts source: user', () => {
    const input = {
      userId: USER_ID,
      organizationId: ORG_ID,
      toolName: TOOL_NAME,
      timestamp: new Date().toISOString(),
      source: 'user' as const,
    };
    expect(requestorContextSchema.safeParse(input).success).toBe(true);
  });
});

describe('extractRequestorContext', () => {
  it('extracts full context from auth and request', () => {
    const auth = makeAuthContext();
    const request = makeRequest();
    const result = extractRequestorContext(auth, request, TOOL_NAME);

    expect(result.userId).toBe(USER_ID);
    expect(result.organizationId).toBe(ORG_ID);
    expect(result.toolName).toBe(TOOL_NAME);
    expect(result.userAgent).toBe('TestAgent/1.0');
    expect(result.ipAddress).toBe('127.0.0.1');
    expect(result.conversationId).toBeUndefined();
    expect(result.source).toBe('agent');
    expect(() => new Date(result.timestamp)).not.toThrow();
  });

  it('always stamps source: agent regardless of inputs', () => {
    const result = extractRequestorContext(
      makeAuthContext(),
      makeRequest({ conversationIdHeader: 'conv-x' }),
      TOOL_NAME,
    );
    expect(result.source).toBe('agent');
  });

  it('includes conversationId when provided as parameter', () => {
    const result = extractRequestorContext(
      makeAuthContext(),
      makeRequest(),
      TOOL_NAME,
      'conv-456',
    );
    expect(result.conversationId).toBe('conv-456');
  });

  it('extracts conversationId from X-Conversation-ID header', () => {
    const result = extractRequestorContext(
      makeAuthContext(),
      makeRequest({ conversationIdHeader: 'header-conv-789' }),
      TOOL_NAME,
    );
    expect(result.conversationId).toBe('header-conv-789');
  });

  it('prefers explicit conversationId parameter over header', () => {
    const result = extractRequestorContext(
      makeAuthContext(),
      makeRequest({ conversationIdHeader: 'from-header' }),
      TOOL_NAME,
      'from-param',
    );
    expect(result.conversationId).toBe('from-param');
  });

  it('omits conversationId when neither param nor header present', () => {
    const result = extractRequestorContext(
      makeAuthContext(),
      makeRequest(),
      TOOL_NAME,
    );
    expect(result.conversationId).toBeUndefined();
  });

  it('omits userAgent when header is absent', () => {
    const request = { headers: {}, ip: '10.0.0.1' } as any;
    const result = extractRequestorContext(
      makeAuthContext(),
      request,
      TOOL_NAME,
    );
    expect(result.userAgent).toBeUndefined();
  });

  it('omits ipAddress when request.ip is falsy', () => {
    const request = {
      headers: { 'user-agent': 'Test' },
      ip: undefined,
    } as any;
    const result = extractRequestorContext(
      makeAuthContext(),
      request,
      TOOL_NAME,
    );
    expect(result.ipAddress).toBeUndefined();
  });

  it('truncates long user-agent to 500 chars', () => {
    const longAgent = 'X'.repeat(600);
    const result = extractRequestorContext(
      makeAuthContext(),
      makeRequest({ userAgent: longAgent }),
      TOOL_NAME,
    );
    expect(result.userAgent!.length).toBe(500);
  });

  it('produces output compatible with Prisma JSON field', () => {
    const result = extractRequestorContext(
      makeAuthContext(),
      makeRequest({ conversationIdHeader: 'conv-789' }),
      TOOL_NAME,
    );
    const serialized = JSON.parse(JSON.stringify(result));
    expect(serialized).toEqual(result);
  });

  it('extracts serviceId from X-Service-ID header', () => {
    const svcId = '00000000-0000-4000-8000-000000000077';
    const result = extractRequestorContext(
      makeAuthContext(),
      makeRequest({ serviceIdHeader: svcId }),
      TOOL_NAME,
    );
    expect(result.serviceId).toBe(svcId);
  });

  it('omits serviceId when header is absent', () => {
    const result = extractRequestorContext(
      makeAuthContext(),
      makeRequest(),
      TOOL_NAME,
    );
    expect(result.serviceId).toBeUndefined();
  });
});
