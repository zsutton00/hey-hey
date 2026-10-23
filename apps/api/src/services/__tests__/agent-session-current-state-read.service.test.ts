import { AgentSessionCurrentState } from 'src/generated';
import { AgentSessionCurrentStateReadService } from '../agent-session-current-state-read.service';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_A = '33333333-3333-4333-8333-333333333333';
const SESSION_B = '44444444-4444-4444-8444-444444444444';
const MISSING_SESSION = '55555555-5555-4555-8555-555555555555';

describe('AgentSessionCurrentStateReadService', () => {
  it('authorizes once, batches projection reads, defaults misses to IDLE, and preserves request order', async () => {
    const messageFindMany = jest.fn();
    const prisma = {
      db: {
        agentSession: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: SESSION_B,
              organizationId: ORGANIZATION_ID,
              projectId: PROJECT_ID,
              conversationId: '66666666-6666-4666-8666-666666666666',
              updatedAt: new Date('2026-08-07T12:00:00.000Z'),
            },
            {
              id: SESSION_A,
              organizationId: ORGANIZATION_ID,
              projectId: PROJECT_ID,
              conversationId: '77777777-7777-4777-8777-777777777777',
              updatedAt: new Date('2026-08-07T12:01:00.000Z'),
            },
          ]),
        },
        message: { findMany: messageFindMany },
      },
    };
    const projection = {
      readMany: jest.fn().mockResolvedValue(
        new Map([
          [
            SESSION_A,
            {
              schemaVersion: 1,
              agentSessionId: SESSION_A,
              organizationId: ORGANIZATION_ID,
              projectId: PROJECT_ID,
              userId: '88888888-8888-4888-8888-888888888888',
              machineId: null,
              currentState: AgentSessionCurrentState.Thinking,
              revision: 4,
              transitionedAt: '2026-08-07T12:02:00.000Z',
              observedAt: '2026-08-07T12:02:00.000Z',
              observedAtMs: 1786104120000,
            },
          ],
        ]),
      ),
    };
    const service = new AgentSessionCurrentStateReadService(
      prisma as any,
      projection as any,
    );

    await expect(
      service.readAuthorized(ORGANIZATION_ID as any, PROJECT_ID as any, [
        SESSION_A,
        SESSION_B,
        MISSING_SESSION,
      ]),
    ).resolves.toEqual([
      {
        agentSessionId: SESSION_A,
        currentState: AgentSessionCurrentState.Thinking,
        revision: 4,
        transitionedAt: '2026-08-07T12:02:00.000Z',
      },
      {
        agentSessionId: SESSION_B,
        currentState: AgentSessionCurrentState.Idle,
        revision: 0,
        transitionedAt: '2026-08-07T12:00:00.000Z',
      },
    ]);

    expect(prisma.db.agentSession.findMany).toHaveBeenCalledTimes(1);
    expect(projection.readMany).toHaveBeenCalledTimes(1);
    expect(projection.readMany).toHaveBeenCalledWith([SESSION_B, SESSION_A]);
    expect(messageFindMany).not.toHaveBeenCalled();
  });

  it('returns IDLE on a miss without querying conversation messages or writing a projection', async () => {
    const messageFindMany = jest.fn();
    const prisma = {
      db: {
        agentSession: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: SESSION_A,
              organizationId: ORGANIZATION_ID,
              projectId: PROJECT_ID,
              conversationId: null,
              updatedAt: new Date('2026-08-07T12:00:00.000Z'),
            },
          ]),
        },
        message: { findMany: messageFindMany },
      },
    };
    const projection = { readMany: jest.fn().mockResolvedValue(new Map()) };
    const service = new AgentSessionCurrentStateReadService(
      prisma as any,
      projection as any,
    );

    await expect(
      service.readAuthorized(ORGANIZATION_ID as any, PROJECT_ID as any, [
        SESSION_A,
      ]),
    ).resolves.toEqual([
      {
        agentSessionId: SESSION_A,
        currentState: AgentSessionCurrentState.Idle,
        revision: 0,
        transitionedAt: '2026-08-07T12:00:00.000Z',
      },
    ]);
    expect(prisma.db.agentSession.findMany).toHaveBeenCalledTimes(1);
    expect(projection.readMany).toHaveBeenCalledTimes(1);
    expect(messageFindMany).not.toHaveBeenCalled();
  });
});
