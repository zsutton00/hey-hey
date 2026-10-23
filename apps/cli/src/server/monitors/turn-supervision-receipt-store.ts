import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  completedTurnSupervisionDispositionSchema,
  type CompletedTurnSupervisionDisposition,
  type TurnSupervisionClaim,
  turnSupervisionDispositionSchema,
  type TurnSupervisionReceiptStore,
} from './turn-supervision-chain';

const currentStoredStateSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('PROCESSING'),
    turnId: z.string().min(1),
    recordedAt: z.string().datetime(),
  }),
  z.object({
    status: z.literal('RECORDED'),
    turnId: z.string().min(1),
    disposition: completedTurnSupervisionDispositionSchema,
    recordedAt: z.string().datetime(),
  }),
]);

const legacyStoredStateSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('PROCESSING'),
    eventId: z.string().min(1),
    recordedAt: z.string().datetime(),
  }),
  z.object({
    status: z.literal('RECORDED'),
    eventId: z.string().min(1),
    disposition: turnSupervisionDispositionSchema,
    recordedAt: z.string().datetime(),
  }),
]);

const storedStateSchema = z.union([currentStoredStateSchema, legacyStoredStateSchema]);

type StoredState =
  | { status: 'PROCESSING' }
  | { status: 'RECORDED'; disposition: CompletedTurnSupervisionDisposition };

/** Durable JSONL receipts for completed supervision chains. */
export class FileTurnSupervisionReceiptStore implements TurnSupervisionReceiptStore {
  private readonly states = new Map<string, StoredState>();
  private loaded: Promise<void> | null = null;
  private appendTail: Promise<void> = Promise.resolve();

  public constructor(private readonly filePath: string) {}

  public async claim(turnId: string): Promise<TurnSupervisionClaim> {
    await this.ensureLoaded();
    const prior = this.states.get(turnId);
    if (prior?.status === 'RECORDED') {
      return { status: 'RECORDED', disposition: prior.disposition };
    }
    if (prior?.status === 'PROCESSING') {
      throw new Error(`Settled Turn ${turnId} already has an active receipt claim.`);
    }
    this.states.set(turnId, { status: 'PROCESSING' });
    try {
      await this.append({
        status: 'PROCESSING',
        turnId,
        recordedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.states.delete(turnId);
      throw error;
    }
    return { status: 'CLAIMED' };
  }

  public async record(
    turnId: string,
    disposition: CompletedTurnSupervisionDisposition,
  ): Promise<CompletedTurnSupervisionDisposition> {
    await this.ensureLoaded();
    const prior = this.states.get(turnId);
    if (prior?.status === 'RECORDED') return prior.disposition;
    await this.append({
      status: 'RECORDED',
      turnId,
      disposition,
      recordedAt: new Date().toISOString(),
    });
    this.states.set(turnId, { status: 'RECORDED', disposition });
    return disposition;
  }

  public async releaseClaim(turnId: string): Promise<void> {
    await this.ensureLoaded();
    if (this.states.get(turnId)?.status === 'PROCESSING') this.states.delete(turnId);
  }

  private async append(value: z.infer<typeof currentStoredStateSchema>): Promise<void> {
    this.appendTail = this.appendTail
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.appendFile(this.filePath, `${JSON.stringify(value)}\n`, 'utf8');
      });
    await this.appendTail;
  }

  private ensureLoaded(): Promise<void> {
    if (this.loaded) return this.loaded;
    this.loaded = this.load();
    return this.loaded;
  }

  private async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      const lines = content.split('\n');
      for (const [index, line] of lines.entries()) {
        if (!line.trim()) continue;
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch (error) {
          const tornFinalRecord = index === lines.length - 1 && !content.endsWith('\n');
          if (!tornFinalRecord) throw error;
          const validPrefix = content.slice(0, content.lastIndexOf('\n') + 1);
          await fs.truncate(this.filePath, Buffer.byteLength(validPrefix, 'utf8'));
          continue;
        }
        const parsed = storedStateSchema.safeParse(value);
        if (!parsed.success) {
          throw new Error(
            `Invalid settled-Turn supervision receipt at JSONL line ${String(index + 1)}.`,
            { cause: parsed.error },
          );
        }
        if (parsed.data.status === 'RECORDED' && parsed.data.disposition.status !== 'FAILED') {
          const turnId = 'turnId' in parsed.data ? parsed.data.turnId : parsed.data.eventId;
          this.states.set(turnId, {
            status: 'RECORDED',
            disposition: parsed.data.disposition,
          });
        }
        // PROCESSING and legacy FAILED records are not completed semantic
        // operations. Omitting them makes interrupted and failed attempts retryable.
      }
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error;
      }
    }
  }
}
