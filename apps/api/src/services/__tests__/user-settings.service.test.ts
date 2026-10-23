import { HttpException } from '@nestjs/common';
import { AgentSessionType } from '../../generated';
import { UserSettingsService } from '../user-settings.service';
import { OrganizationId, ProjectId, UserId } from '../../types';

const organizationId = '11111111-1111-4111-8111-111111111111' as OrganizationId;
const projectId = '22222222-2222-4222-8222-222222222222' as ProjectId;
const userId = '33333333-3333-4333-8333-333333333333' as UserId;
const machineId = '44444444-4444-4444-8444-444444444444';

const value = {
  enabled: true,
  provider: 'codex' as const,
  model: 'gpt-5.6-luna',
  reasoningEffort: 'xhigh' as const,
  countThreshold: 3,
  eventTypes: ['task.created'],
};

const createSubject = (response: object) => {
  const agentSessionService = {
    findAll: jest
      .fn()
      .mockResolvedValue([{ id: 'session-id', userId, machineId }]),
  };
  const cliSettingsEmitter = { request: jest.fn().mockResolvedValue(response) };
  return {
    subject: new UserSettingsService(
      agentSessionService as never,
      cliSettingsEmitter as never,
    ),
    agentSessionService,
    cliSettingsEmitter,
  };
};

const successResponse = {
  requestId: '55555555-5555-4555-8555-555555555555',
  operation: 'daily_session.settings.get' as const,
  status: 'success' as const,
  result: {
    settingsFamily: 'daily_session' as const,
    schemaVersion: 1 as const,
    scope: { type: 'project' as const, projectId },
    persistenceRevision: 1,
    effectiveValueSource: 'default' as const,
    value,
  },
};

describe('UserSettingsService', () => {
  it('looks up the caller-owned bound Daily Session and maps the CLI resource', async () => {
    const { subject, agentSessionService, cliSettingsEmitter } =
      createSubject(successResponse);

    await expect(
      subject.get(organizationId, projectId, userId, 'daily_session'),
    ).resolves.toMatchObject({
      success: true,
      data: { scope: { projectId }, persistenceRevision: 1 },
    });
    expect(agentSessionService.findAll).toHaveBeenCalledWith(
      organizationId,
      projectId,
      {
        userId,
        type: AgentSessionType.DailySession,
      },
    );
    expect(cliSettingsEmitter.request).toHaveBeenCalledWith(
      expect.objectContaining({
        request: { operation: 'daily_session.settings.get', projectId },
      }),
    );
  });

  it('rejects a replacement whose explicit scope differs from the route project', async () => {
    const { subject, cliSettingsEmitter } = createSubject(successResponse);
    const request = {
      settingsFamily: 'daily_session' as const,
      schemaVersion: 1 as const,
      scope: {
        type: 'project' as const,
        projectId: organizationId as unknown as ProjectId,
      },
      expectedPersistenceRevision: 0,
      value,
    };

    try {
      await subject.replace(
        organizationId,
        projectId,
        userId,
        'daily_session',
        request,
      );
      fail('expected the route scope mismatch to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(400);
    }
    expect(cliSettingsEmitter.request).not.toHaveBeenCalled();
  });

  it('maps stale revisions to the generated conflict response', async () => {
    const { subject } = createSubject({
      requestId: successResponse.requestId,
      operation: 'daily_session.settings.replace' as const,
      status: 'error' as const,
      error: {
        code: 'USER_SETTINGS_REVISION_CONFLICT' as const,
        message: 'stale',
        expectedPersistenceRevision: 0,
        currentPersistenceRevision: 2,
      },
    });
    const request = {
      settingsFamily: 'daily_session' as const,
      schemaVersion: 1 as const,
      scope: { type: 'project' as const, projectId },
      expectedPersistenceRevision: 0,
      value,
    };

    try {
      await subject.replace(
        organizationId,
        projectId,
        userId,
        'daily_session',
        request,
      );
      fail('expected the stale revision to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const exception = error as HttpException;
      const response = exception.getResponse() as {
        code?: string;
        currentPersistenceRevision?: number;
      };
      expect(exception.getStatus()).toBe(409);
      expect(response.code).toBe('USER_SETTINGS_REVISION_CONFLICT');
      expect(response.currentPersistenceRevision).toBe(2);
    }
  });
});
