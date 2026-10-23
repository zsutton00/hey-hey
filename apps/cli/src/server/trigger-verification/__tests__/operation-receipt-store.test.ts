import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OperationReceiptStore } from '../operation-receipt-store';

describe('OperationReceiptStore', () => {
  it('survives restart, suppresses replay, and rejects fingerprint reuse', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-operation-receipts-'));
    const file = path.join(directory, 'receipts.jsonl');
    const operationId = '55555555-5555-4555-8555-555555555555';
    expect(await new OperationReceiptStore(file).claim(operationId, 'a'.repeat(64))).toEqual({
      disposition: 'EXECUTE',
    });
    const restarted = new OperationReceiptStore(file);
    expect(await restarted.claim(operationId, 'a'.repeat(64))).toEqual({
      disposition: 'REPLAY',
      state: 'PROCESSING',
    });
    expect(await restarted.claim(operationId, 'b'.repeat(64))).toEqual({
      disposition: 'MISMATCH',
    });
  });
});
