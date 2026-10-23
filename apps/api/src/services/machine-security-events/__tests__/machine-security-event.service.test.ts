import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { WebsocketGateway } from '../../../core/websockets/websocket.gateway';
import { MachineId, UserId } from '../../../types';
import { MachineSecurityEventType } from '../../../generated';
import { MachineSecurityEventService } from '../machine-security-event.service';
import * as TestUtils from '../../../utils/testUtils';

const { testIds } = TestUtils;

const TEST_MACHINE_ID = '00000000-0000-4000-8000-000000000001' as MachineId;
const OTHER_MACHINE_ID = '00000000-0000-4000-8000-0000000000ff' as MachineId;
const TEST_USER_ID = testIds.user as UserId;

interface SecurityEventRow {
  id: string;
  machineId: string;
  eventType: string;
  occurredAt: Date;
  detail: string | null;
  metadata: unknown;
  createdAt: Date;
}

interface MachineRow {
  id: string;
  userId: string;
}

describe('MachineSecurityEventService', () => {
  let service: MachineSecurityEventService;
  let gateway: jest.Mocked<Pick<WebsocketGateway, 'emitMachineSecurityEvent'>>;
  let rows: SecurityEventRow[];
  let machines: MachineRow[];

  const matchesIdFilter = (
    row: SecurityEventRow,
    where: { id?: { in?: string[] }; machineId?: string },
  ): boolean => {
    if (where.machineId && row.machineId !== where.machineId) {
      return false;
    }
    if (where.id?.in && !where.id.in.includes(row.id)) {
      return false;
    }
    return true;
  };

  const buildPrismaMock = (): jest.Mocked<PrismaService> => {
    const machineSecurityEvent = {
      findMany: jest.fn(
        async ({
          where = {},
          orderBy,
          take,
        }: {
          where?: { id?: { in?: string[] }; machineId?: string };
          orderBy?: { occurredAt?: 'asc' | 'desc' };
          take?: number;
        }) => {
          let result = rows.filter((row) => matchesIdFilter(row, where));
          if (orderBy?.occurredAt) {
            const dir = orderBy.occurredAt === 'desc' ? -1 : 1;
            result = [...result].sort(
              (a, b) => dir * (a.occurredAt.getTime() - b.occurredAt.getTime()),
            );
          }
          if (typeof take === 'number') {
            result = result.slice(0, take);
          }
          return result;
        },
      ),
      createManyAndReturn: jest.fn(
        async ({
          data,
        }: {
          data: Array<Omit<SecurityEventRow, 'createdAt'>>;
        }) => {
          const inserted: SecurityEventRow[] = [];
          for (const entry of data) {
            // skipDuplicates on the composite (machineId, id) primary key.
            if (
              rows.some(
                (row) =>
                  row.id === entry.id && row.machineId === entry.machineId,
              )
            ) {
              continue;
            }
            const row = { ...entry, createdAt: new Date() };
            rows.push(row);
            inserted.push(row);
          }
          return inserted;
        },
      ),
    };

    const machine = {
      findFirst: jest.fn(
        async ({ where }: { where: { id: string; userId: string } }) => {
          return (
            machines.find(
              (m) => m.id === where.id && m.userId === where.userId,
            ) ?? null
          );
        },
      ),
    };

    return {
      db: { machineSecurityEvent, machine },
    } as unknown as jest.Mocked<PrismaService>;
  };

  beforeEach(() => {
    rows = [];
    machines = [{ id: TEST_MACHINE_ID, userId: TEST_USER_ID }];
    gateway = {
      emitMachineSecurityEvent: jest.fn(),
    } as unknown as jest.Mocked<
      Pick<WebsocketGateway, 'emitMachineSecurityEvent'>
    >;
    service = new MachineSecurityEventService(
      buildPrismaMock(),
      gateway as unknown as WebsocketGateway,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('recordEvents idempotency', () => {
    const entry = {
      id: '0f9c4d2e-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
      eventType: MachineSecurityEventType.SignatureFailure,
      occurredAt: '2026-06-14T12:00:00.000Z',
      detail: 'bad signature',
    };

    it('reporting the same client id twice yields exactly one row and emits once', async () => {
      await service.recordEvents({
        machineId: TEST_MACHINE_ID,
        userId: TEST_USER_ID,
        events: [entry],
      });
      await service.recordEvents({
        machineId: TEST_MACHINE_ID,
        userId: TEST_USER_ID,
        events: [entry],
      });

      expect(rows.filter((r) => r.id === entry.id)).toHaveLength(1);
      expect(gateway.emitMachineSecurityEvent).toHaveBeenCalledTimes(1);
    });

    it('emits a realtime frame to the owner for each newly persisted event', async () => {
      const result = await service.recordEvents({
        machineId: TEST_MACHINE_ID,
        userId: TEST_USER_ID,
        events: [entry],
      });

      expect(result).toHaveLength(1);
      expect(gateway.emitMachineSecurityEvent).toHaveBeenCalledTimes(1);
      const frame = gateway.emitMachineSecurityEvent.mock.calls[0]![0];
      expect(frame.type).toBe('machine_security_event');
      expect(frame.userId).toBe(TEST_USER_ID);
      expect(frame.machineId).toBe(TEST_MACHINE_ID);
      expect(frame.event.id).toBe(entry.id);
      expect(frame.event.eventType).toBe(
        MachineSecurityEventType.SignatureFailure,
      );
    });
  });

  describe('listEvents', () => {
    it('returns events most-recent-first for an owned machine', async () => {
      await service.recordEvents({
        machineId: TEST_MACHINE_ID,
        userId: TEST_USER_ID,
        events: [
          {
            id: 'older',
            eventType: MachineSecurityEventType.ReplayRejection,
            occurredAt: '2026-06-14T10:00:00.000Z',
          },
          {
            id: 'newer',
            eventType: MachineSecurityEventType.RateLimitTrip,
            occurredAt: '2026-06-14T12:00:00.000Z',
          },
        ],
      });

      const feed = await service.listEvents({
        machineId: TEST_MACHINE_ID,
        userId: TEST_USER_ID,
      });

      expect(feed.map((e) => e.id)).toEqual(['newer', 'older']);
    });

    it('throws NotFound for a machine the caller does not own', async () => {
      await expect(
        service.listEvents({
          machineId: OTHER_MACHINE_ID,
          userId: TEST_USER_ID,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
