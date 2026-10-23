import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const receiptSchema = z
  .object({
    operationId: z.string().uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum(['PROCESSING', 'SUCCEEDED', 'FAILED']),
    recordedAt: z.string().datetime(),
  })
  .strict();

type Receipt = z.infer<typeof receiptSchema>;
export type OperationReceiptClaim =
  | { disposition: 'EXECUTE' }
  | { disposition: 'REPLAY'; state: Receipt['state'] }
  | { disposition: 'MISMATCH' };

export class OperationReceiptStore {
  private readonly receipts = new Map<string, Receipt>();
  private loaded: Promise<void> | null = null;
  private appendTail: Promise<void> = Promise.resolve();

  public constructor(private readonly filePath: string) {}

  public async inspect(operationId: string): Promise<Receipt | null> {
    await this.ensureLoaded();
    return this.receipts.get(operationId) ?? null;
  }

  public async claim(operationId: string, fingerprint: string): Promise<OperationReceiptClaim> {
    await this.ensureLoaded();
    const existing = this.receipts.get(operationId);
    if (existing) {
      return existing.fingerprint === fingerprint
        ? { disposition: 'REPLAY', state: existing.state }
        : { disposition: 'MISMATCH' };
    }
    await this.record({
      operationId,
      fingerprint,
      state: 'PROCESSING',
      recordedAt: new Date().toISOString(),
    });
    return { disposition: 'EXECUTE' };
  }

  public async complete(
    operationId: string,
    fingerprint: string,
    succeeded: boolean,
  ): Promise<void> {
    await this.ensureLoaded();
    const existing = this.receipts.get(operationId);
    if (!existing || existing.fingerprint !== fingerprint)
      throw new Error('Agent operation receipt identity mismatch.');
    await this.record({
      operationId,
      fingerprint,
      state: succeeded ? 'SUCCEEDED' : 'FAILED',
      recordedAt: new Date().toISOString(),
    });
  }

  private async record(receipt: Receipt): Promise<void> {
    this.receipts.set(receipt.operationId, receipt);
    this.appendTail = this.appendTail.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.appendFile(this.filePath, `${JSON.stringify(receipt)}\n`, 'utf8');
    });
    await this.appendTail;
  }

  private ensureLoaded(): Promise<void> {
    return (this.loaded ??= (async () => {
      try {
        const content = await fs.readFile(this.filePath, 'utf8');
        for (const [index, line] of content.split('\n').entries()) {
          if (!line.trim()) continue;
          const parsed = receiptSchema.safeParse(JSON.parse(line));
          if (!parsed.success)
            throw new Error(`Invalid agent operation receipt at JSONL line ${index + 1}`, {
              cause: parsed.error,
            });
          this.receipts.set(parsed.data.operationId, parsed.data);
        }
      } catch (error) {
        if (
          typeof error !== 'object' ||
          error === null ||
          !('code' in error) ||
          error.code !== 'ENOENT'
        )
          throw error;
      }
    })());
  }
}
