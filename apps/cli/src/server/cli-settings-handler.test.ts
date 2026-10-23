import { describe, expect, it, vi } from 'vitest';
import {
  LocalReasoningEffort,
  LocalRunProvider,
} from '../shared/agent-bridge-contract/contract';
import { CliSettingsHandler } from './cli-settings-handler';
import { NOOP_LOGGER } from './logger';

const requestId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const projectId = '33333333-3333-4333-8333-333333333333';

const settings = {
  enabled: true,
  provider: LocalRunProvider.Codex,
  model: 'gpt-5.6-luna',
  reasoningEffort: LocalReasoningEffort.Xhigh,
  countThreshold: 3,
  eventTypes: ['task.created'],
};

const snapshot = {
  status: 'ready' as const,
  settings,
  usedDefaultLaunch: true,
  effectiveValueSource: 'default' as const,
  persistenceRevision: 0,
};

const createSubject = (overrides: Record<string, unknown> = {}) => {
  const verification = {
    verifyCliSettingsFrame: vi.fn().mockReturnValue({
      ok: true as const,
      verified: {
        frame: { organizationId, projectId },
        envelope: {},
        body: {
          requestId,
          operation: 'daily_session.settings.get' as const,
          projectId,
        },
      },
    }),
  };
  const settingsStore = {
    load: vi.fn().mockResolvedValue(snapshot),
    replace: vi.fn().mockResolvedValue({ ...snapshot, effectiveValueSource: 'persisted', persistenceRevision: 1 }),
  };
  const monitorPipeline = { applyDailySessionSettings: vi.fn() };
  const authContext = {
    resolve: vi.fn().mockResolvedValue({
      accessToken: 'token',
      organizationId,
      userId: '44444444-4444-4444-8444-444444444444',
      projectId,
    }),
  };
  const subject = new CliSettingsHandler({
    triggerVerificationRuntime: verification as never,
    settingsStore: settingsStore as never,
    monitorPipeline: monitorPipeline as never,
    authContext: authContext as never,
    logger: NOOP_LOGGER,
    ...overrides,
  });
  return { subject, verification, settingsStore, monitorPipeline };
};

describe('CliSettingsHandler', () => {
  it('returns default metadata for a project-bound GET', async () => {
    const { subject } = createSubject();

    await expect(subject.handle({})).resolves.toMatchObject({
      requestId,
      operation: 'daily_session.settings.get',
      status: 'success',
      result: {
        scope: { type: 'project', projectId },
        persistenceRevision: 0,
        effectiveValueSource: 'default',
      },
    });
  });

  it('atomically applies a replacement through the existing monitor pipeline', async () => {
    const { subject, settingsStore, monitorPipeline } = createSubject();
    const body = {
      requestId,
      operation: 'daily_session.settings.replace' as const,
      projectId,
      expectedPersistenceRevision: 0,
      value: settings,
    };
    const verification = createSubject().verification;
    verification.verifyCliSettingsFrame.mockReturnValue({
      ok: true as const,
      verified: { frame: { organizationId, projectId }, envelope: {}, body },
    });
    const replacementSubject = createSubject({ triggerVerificationRuntime: verification as never });

    await expect(replacementSubject.subject.handle({})).resolves.toMatchObject({
      status: 'success',
      operation: 'daily_session.settings.replace',
      result: { persistenceRevision: 1, effectiveValueSource: 'persisted' },
    });
    expect(replacementSubject.settingsStore.replace).toHaveBeenCalledWith(
      projectId,
      0,
      settings,
    );
    expect(replacementSubject.monitorPipeline.applyDailySessionSettings).toHaveBeenCalledWith(settings);
    expect(settingsStore.load).not.toHaveBeenCalled();
    expect(monitorPipeline.applyDailySessionSettings).not.toHaveBeenCalled();
  });

  it('leaves runtime application out of stale responses', async () => {
    const replacementSubject = createSubject();
    replacementSubject.settingsStore.replace.mockRejectedValue(
      Object.assign(new Error('stale'), {
        name: 'DailySessionSettingsRevisionConflictError',
        expectedPersistenceRevision: 0,
        currentPersistenceRevision: 1,
      }),
    );
    // Use the concrete error shape so the handler exercises the typed branch.
    const { DailySessionSettingsRevisionConflictError } = await import('./monitors/daily-session-settings');
    replacementSubject.settingsStore.replace.mockRejectedValue(
      new DailySessionSettingsRevisionConflictError(0, 1),
    );

    const body = {
      requestId,
      operation: 'daily_session.settings.replace' as const,
      projectId,
      expectedPersistenceRevision: 0,
      value: settings,
    };
    replacementSubject.verification.verifyCliSettingsFrame.mockReturnValue({
      ok: true as const,
      verified: { frame: { organizationId, projectId }, envelope: {}, body },
    });
    await expect(replacementSubject.subject.handle({})).resolves.toMatchObject({
      status: 'error',
      error: {
        code: 'USER_SETTINGS_REVISION_CONFLICT',
        expectedPersistenceRevision: 0,
        currentPersistenceRevision: 1,
      },
    });
    expect(replacementSubject.monitorPipeline.applyDailySessionSettings).not.toHaveBeenCalled();
  });
});
