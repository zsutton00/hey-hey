import { UserSettingsController } from '../user-settings.controller';
import { ProjectId } from '../../types';

describe('UserSettingsController', () => {
  it('keeps the HTTP controller as a thin authenticated delegation layer', async () => {
    const service = {
      get: jest.fn().mockResolvedValue({ success: true }),
      replace: jest.fn().mockResolvedValue({ success: true }),
    };
    const subject = new UserSettingsController(service as never);
    const request = {
      settingsFamily: 'daily_session' as const,
      schemaVersion: 1 as const,
      scope: {
        type: 'project' as const,
        projectId: '22222222-2222-4222-8222-222222222222' as ProjectId,
      },
      expectedPersistenceRevision: 0,
      value: {
        enabled: true,
        provider: 'codex' as const,
        model: 'gpt-5.6-luna',
        reasoningEffort: 'xhigh' as const,
        countThreshold: 3,
        eventTypes: ['task.created'],
      },
    };

    await subject.get(
      '22222222-2222-4222-8222-222222222222' as never,
      'daily_session',
      '11111111-1111-4111-8111-111111111111' as never,
      '33333333-3333-4333-8333-333333333333' as never,
    );
    await subject.replace(
      '22222222-2222-4222-8222-222222222222' as never,
      'daily_session',
      request,
      '11111111-1111-4111-8111-111111111111' as never,
      '33333333-3333-4333-8333-333333333333' as never,
    );

    expect(service.get).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      'daily_session',
    );
    expect(service.replace).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      'daily_session',
      request,
    );
  });
});
