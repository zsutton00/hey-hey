import { BadRequestException } from '@nestjs/common';
import { AgentSessionCurrentStateController } from '../agent-session-current-state.controller';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_A = '33333333-3333-4333-8333-333333333333';

describe('AgentSessionCurrentStateController', () => {
  it('rejects duplicate identities instead of silently deduplicating them', async () => {
    const readService = { readAuthorized: jest.fn() };
    const controller = new AgentSessionCurrentStateController(readService as any);

    await expect(
      controller.batchReadCurrentState(
        PROJECT_ID as any,
        ORGANIZATION_ID as any,
        { agentSessionIds: [SESSION_A, SESSION_A] } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(readService.readAuthorized).not.toHaveBeenCalled();
  });

  it('passes valid IDs through once and returns the service order', async () => {
    const secondSession = '44444444-4444-4444-8444-444444444444';
    const items = [
      {
        agentSessionId: secondSession,
        currentState: 'IDLE',
        revision: 0,
        transitionedAt: '2026-08-07T12:00:00.000Z',
      },
      {
        agentSessionId: SESSION_A,
        currentState: 'THINKING',
        revision: 3,
        transitionedAt: '2026-08-07T12:01:00.000Z',
      },
    ];
    const readService = {
      readAuthorized: jest.fn().mockResolvedValue(items),
    };
    const controller = new AgentSessionCurrentStateController(readService as any);

    await expect(
      controller.batchReadCurrentState(
        PROJECT_ID as any,
        ORGANIZATION_ID as any,
        { agentSessionIds: [secondSession, SESSION_A] } as any,
      ),
    ).resolves.toEqual({ items });
    expect(readService.readAuthorized).toHaveBeenCalledTimes(1);
    expect(readService.readAuthorized).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      PROJECT_ID,
      [secondSession, SESSION_A],
    );
  });
});
