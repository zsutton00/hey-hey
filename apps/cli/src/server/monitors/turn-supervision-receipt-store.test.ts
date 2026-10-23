import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileTurnSupervisionReceiptStore } from './turn-supervision-receipt-store';

const directories: string[] = [];

const receiptPath = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'turn-supervision-'));
  directories.push(directory);
  return path.join(directory, 'receipts.jsonl');
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('FileTurnSupervisionReceiptStore', () => {
  it('replays the first recorded chain disposition after reconstruction', async () => {
    const filePath = await receiptPath();
    const first = new FileTurnSupervisionReceiptStore(filePath);
    await expect(first.claim('event-1')).resolves.toEqual({ status: 'CLAIMED' });
    await first.record('event-1', { status: 'HANDLED', supervisor: 'TASK_MONITOR' });

    const restarted = new FileTurnSupervisionReceiptStore(filePath);
    await expect(restarted.claim('event-1')).resolves.toEqual({
      status: 'RECORDED',
      disposition: { status: 'HANDLED', supervisor: 'TASK_MONITOR' },
    });
  });

  it('reclaims an unfinished receipt after process reconstruction', async () => {
    const filePath = await receiptPath();
    await new FileTurnSupervisionReceiptStore(filePath).claim('event-1');

    await expect(new FileTurnSupervisionReceiptStore(filePath).claim('event-1')).resolves.toEqual({
      status: 'CLAIMED',
    });
  });

  it('releases failed attempts so the Turn can be retried', async () => {
    const store = new FileTurnSupervisionReceiptStore(await receiptPath());
    await store.claim('event-1');
    await store.releaseClaim('event-1');

    await expect(store.claim('event-1')).resolves.toEqual({ status: 'CLAIMED' });
    await expect(
      store.record('event-1', { status: 'HANDLED', supervisor: 'TASK_MONITOR' }),
    ).resolves.toEqual({ status: 'HANDLED', supervisor: 'TASK_MONITOR' });
  });

  it('replays completed legacy event receipts and retries legacy failures', async () => {
    const filePath = await receiptPath();
    const recordedAt = '2026-07-31T00:00:00.000Z';
    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          status: 'RECORDED',
          eventId: 'legacy-completed-turn',
          disposition: { status: 'HANDLED', supervisor: 'TASK_MONITOR' },
          recordedAt,
        }),
        JSON.stringify({
          status: 'RECORDED',
          eventId: 'legacy-failed-turn',
          disposition: {
            status: 'FAILED',
            supervisor: 'SESSION_MONITOR',
            reason: 'TRANSIENT_FAILURE',
          },
          recordedAt,
        }),
        '',
      ].join('\n'),
      'utf8',
    );

    const restarted = new FileTurnSupervisionReceiptStore(filePath);
    await expect(restarted.claim('legacy-completed-turn')).resolves.toEqual({
      status: 'RECORDED',
      disposition: { status: 'HANDLED', supervisor: 'TASK_MONITOR' },
    });
    await expect(restarted.claim('legacy-failed-turn')).resolves.toEqual({
      status: 'CLAIMED',
    });
  });

  it('recovers from a torn final JSONL append', async () => {
    const filePath = await receiptPath();
    const first = new FileTurnSupervisionReceiptStore(filePath);
    await first.record('event-1', { status: 'HANDLED', supervisor: 'SESSION_MONITOR' });
    await fs.appendFile(filePath, '{"status":"RECORDED"', 'utf8');

    const restarted = new FileTurnSupervisionReceiptStore(filePath);
    await expect(restarted.claim('event-1')).resolves.toMatchObject({ status: 'RECORDED' });
  });
});
