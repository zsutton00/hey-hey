import { describe, expect, it, vi } from 'vitest';
import { setAgentSessionOutputAttentionReady } from './agent-session-output-attention';

describe('setAgentSessionOutputAttentionReady', () => {
  const input = {
    organizationId: 'org-1',
    projectId: 'project-1',
    agentSessionId: 'session-1',
  };

  it('writes MESSAGE_READY through the explicit platform boundary', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await setAgentSessionOutputAttentionReady(input, {
      apiBaseUrl: 'https://platform.test/api/v1',
      auth: { getAccessToken: vi.fn().mockResolvedValue('token') } as never,
      fetchImpl,
      logger: { info: vi.fn() } as never,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://platform.test/api/v1/organizations/org-1/projects/project-1/agent-sessions/session-1/output-attention:ready',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ state: 'MESSAGE_READY' }),
      }),
    );
  });

  it('surfaces a rejected write', async () => {
    await expect(
      setAgentSessionOutputAttentionReady(input, {
        apiBaseUrl: 'https://platform.test/api/v1',
        auth: { getAccessToken: vi.fn().mockResolvedValue('token') } as never,
        fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
        logger: { info: vi.fn() } as never,
      }),
    ).rejects.toThrow('Failed to set Agent Session output attention: 500');
  });
});
