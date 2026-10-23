import { EventRouter } from '../../../core/events/event-router';
import { EventEnvelope } from '../../../core/events/types/event-envelope';
import { EVENT_TYPES } from '../../../core/events/types/event.types';
import { MachineId, UserId } from '../../../types';
import { MachineSecurityEventType } from '../../../generated';
import { MachineSecurityEventConsumer } from '../machine-security-event.consumer';
import { MachineSecurityEventService } from '../machine-security-event.service';
import * as TestUtils from '../../../utils/testUtils';

const { testIds } = TestUtils;

const TEST_MACHINE_ID = '00000000-0000-4000-8000-000000000001' as MachineId;
const TEST_USER_ID = testIds.user as UserId;

describe('MachineSecurityEventConsumer', () => {
  let eventRouter: jest.Mocked<Pick<EventRouter, 'on'>>;
  let service: jest.Mocked<Pick<MachineSecurityEventService, 'recordEvents'>>;
  let consumer: MachineSecurityEventConsumer;
  let registeredHandler: (envelope: EventEnvelope) => void;

  beforeEach(async () => {
    eventRouter = {
      on: jest.fn(async (_type, handler) => {
        registeredHandler = handler as (envelope: EventEnvelope) => void;
      }),
    } as unknown as jest.Mocked<Pick<EventRouter, 'on'>>;

    service = {
      recordEvents: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<
      Pick<MachineSecurityEventService, 'recordEvents'>
    >;

    consumer = new MachineSecurityEventConsumer(
      eventRouter as unknown as EventRouter,
      service as unknown as MachineSecurityEventService,
    );

    await consumer.onModuleInit();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('subscribes to machine.revoked', () => {
    expect(eventRouter.on).toHaveBeenCalledWith(
      EVENT_TYPES.MACHINE.REVOKED,
      expect.any(Function),
    );
  });

  it('persists a revocation security event keyed on the domain event id', async () => {
    const revokedAt = '2026-06-14T12:00:00.000Z';
    const envelope = {
      event: {
        id: 'event-1',
        type: EVENT_TYPES.MACHINE.REVOKED,
        aggregateId: TEST_MACHINE_ID,
        payload: {
          machineId: TEST_MACHINE_ID,
          userId: TEST_USER_ID,
          revokedAt,
        },
      },
      timestamp: revokedAt,
    } as unknown as EventEnvelope;

    registeredHandler(envelope);
    // Handler is fire-and-forget; let the microtask queue drain.
    await Promise.resolve();

    expect(service.recordEvents).toHaveBeenCalledWith({
      machineId: TEST_MACHINE_ID,
      userId: TEST_USER_ID,
      events: [
        {
          id: 'event-1',
          eventType: MachineSecurityEventType.Revocation,
          occurredAt: revokedAt,
          detail: 'Machine credential revoked',
        },
      ],
    });
  });
});
