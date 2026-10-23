import { GitHubOAuthService } from '../integrations/github-oauth.service';

describe('GitHubOAuthService', () => {
  let service: GitHubOAuthService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    service = new GitHubOAuthService();
    process.env.GITHUB_CLIENT_ID = 'client-id';
    process.env.GITHUB_CLIENT_SECRET = 'client-secret';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('builds authorize URL with expected query params', () => {
    const url = service.buildAuthorizeUrl({
      state: 'state-token',
      redirectUri: 'http://api.test/callback',
      scope: 'repo',
    });

    expect(url).toContain('client_id=client-id');
    expect(url).toContain('redirect_uri=http%3A%2F%2Fapi.test%2Fcallback');
    expect(url).toContain('scope=repo');
    expect(url).toContain('state=state-token');
  });

  it('signs and validates state payloads', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const { state } = service.buildState({
      integrationId: 'integration-1',
      organizationId: 'org-1',
      projectId: 'project-1',
    });

    const parsed = service.parseState(state);
    expect(parsed.integrationId).toBe('integration-1');
    expect(parsed.organizationId).toBe('org-1');
    expect(parsed.projectId).toBe('project-1');
    nowSpy.mockRestore();
  });

  it('rejects expired state payloads', () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1000);
    const { state } = service.buildState({
      integrationId: 'integration-1',
      organizationId: 'org-1',
      projectId: 'project-1',
    });
    nowSpy.mockReturnValue(1000 + 11 * 60 * 1000);

    expect(() => service.parseState(state)).toThrow('OAuth state has expired');
    nowSpy.mockRestore();
  });

  it('exchanges OAuth code for tokens', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        refresh_token_expires_in: 7200,
        scope: 'repo',
        token_type: 'bearer',
      }),
    } as Response);

    const result = await service.exchangeCodeForToken(
      'code-123',
      'http://api.test/callback',
    );

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
  });

  it('throws on failed token exchange', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'bad_verification_code',
        error_description: 'Invalid code',
      }),
    } as Response);

    await expect(
      service.exchangeCodeForToken('code-123', 'http://api.test/callback'),
    ).rejects.toThrow('Invalid code');
  });
});
