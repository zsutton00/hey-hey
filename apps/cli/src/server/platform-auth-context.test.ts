import { describe, expect, it } from 'vitest';
import { RunStore } from '../run-store/run-store';
import { createTestOAuthClient } from './__tests__/helpers/test-oauth-client';
import { NOOP_LOGGER } from './logger';
import { MonitorProjectContext } from './monitors/project-context';
import { createTestPlatformWebSocketManager } from './monitors/test-owners.test-support';
import { PlatformAuthContext } from './platform-auth-context';

describe('PlatformAuthContext project scope', () => {
  it('uses the caller project without replacing the learned daily-session project', async () => {
    const projectContext = new MonitorProjectContext({
      runStore: new RunStore(),
      platformWebSocketManager: createTestPlatformWebSocketManager(),
      logger: NOOP_LOGGER,
    });
    projectContext.learn('learned-project');
    const token = `header.${Buffer.from(JSON.stringify({ organizationId: 'org', sub: 'user' })).toString('base64url')}.signature`;
    const auth = new PlatformAuthContext(
      createTestOAuthClient({ getAccessToken: async () => ({ success: true, data: token }) }),
      projectContext,
      NOOP_LOGGER,
    );

    await expect(auth.resolve('command-project')).resolves.toEqual({
      accessToken: token,
      organizationId: 'org',
      userId: 'user',
      projectId: 'command-project',
    });
    await expect(auth.resolve()).resolves.toEqual(
      expect.objectContaining({ projectId: 'learned-project' }),
    );
    expect(projectContext.currentProjectId).toBe('learned-project');
  });
});
