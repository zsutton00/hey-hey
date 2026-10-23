import { CliSettingsEmitter } from '../cli-settings-emitter.service';
import { MachineId, OrganizationId, ProjectId, UserId } from '../../../types';

const organizationId = '11111111-1111-4111-8111-111111111111' as OrganizationId;
const projectId = '22222222-2222-4222-8222-222222222222' as ProjectId;
const userId = '33333333-3333-4333-8333-333333333333' as UserId;
const machineId = '44444444-4444-4444-8444-444444444444' as MachineId;

const settingsValue = {
  enabled: true,
  provider: 'codex' as const,
  model: 'gpt-5.6-luna',
  reasoningEffort: 'xhigh' as const,
  countThreshold: 3,
  eventTypes: ['task.created'],
};

describe('CliSettingsEmitter', () => {
  it('correlates a typed success acknowledgement', async () => {
    const signer = {
      signCliSettings: jest.fn((event) => ({
        machineId,
        userId,
        nonce: 'nonce',
        timestampMs: Date.now(),
        signature: 'signature',
        event,
      })),
    };
    const gateway = {
      emitCliSettingsWithAck: jest.fn(async (event) => ({
        kind: 'ack' as const,
        value: [
          {
            requestId: event.envelope.event.requestId,
            operation: event.envelope.event.operation,
            status: 'success' as const,
            result: {
              settingsFamily: 'daily_session' as const,
              schemaVersion: 1 as const,
              scope: { type: 'project' as const, projectId },
              persistenceRevision: 2,
              effectiveValueSource: 'persisted' as const,
              value: settingsValue,
            },
          },
        ],
      })),
    };
    const subject = new CliSettingsEmitter(signer as never, gateway as never);

    await expect(
      subject.request({
        request: { operation: 'daily_session.settings.get', projectId },
        machineId,
        userId,
        organizationId,
        projectId,
      }),
    ).resolves.toMatchObject({
      status: 'success',
      result: { persistenceRevision: 2 },
    });
    expect(gateway.emitCliSettingsWithAck).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['timeout', { kind: 'timeout' as const }, 'TIMEOUT'],
    [
      'malformed acknowledgement',
      { kind: 'ack' as const, value: [] },
      'MALFORMED_ACK',
    ],
  ])('returns a typed %s error', async (_label, acknowledgement, code) => {
    const signer = { signCliSettings: jest.fn((event) => ({ event })) };
    const gateway = {
      emitCliSettingsWithAck: jest.fn().mockResolvedValue(acknowledgement),
    };
    const subject = new CliSettingsEmitter(signer as never, gateway as never);

    await expect(
      subject.request({
        request: { operation: 'daily_session.settings.get', projectId },
        machineId,
        userId,
        organizationId,
        projectId,
      }),
    ).resolves.toMatchObject({ status: 'error', error: { code } });
  });
});
