import { z } from 'zod';
import { LocalPromptType } from '@hey-hey/contracts/agent-bridge';
import { ReportType, type CommitReportPayload } from '@hey-hey/contracts/api/models';
import type { RunStore } from '../run-store/run-store';
import type { ReportChainEntry } from './types';

const hashSchema = z.object({
  service: z.string(),
  hash: z.string(),
  branch: z.string(),
  implementReportIds: z.array(z.string().uuid()).optional(),
});
const entrySchema = z.object({
  createdAt: z.string(),
  phase: z.nativeEnum(LocalPromptType),
  reportId: z.string(),
  reportType: z.nativeEnum(ReportType),
  summary: z.string(),
  audience: z.enum(['EXTERNAL', 'INTERNAL']),
  sourceRunId: z.string(),
  serviceId: z.string().optional(),
  commitHashes: z.array(hashSchema).optional(),
});
const pendingSchema = z.object({
  summary: z.string(),
  files: z.array(z.string()),
  hashes: z.array(hashSchema),
});
const recordSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('entry'), entry: entrySchema }),
  z.object({ kind: z.literal('pending'), payload: pendingSchema }),
  z.object({ kind: z.literal('settled') }),
]);
type Record = z.infer<typeof recordSchema>;
export type PendingCommitReport = Pick<CommitReportPayload, 'summary' | 'files' | 'hashes'>;

/** Run-local journal. A pending outcome is replayed before any further git operation. */
export class ReportProvenance {
  pending: PendingCommitReport | undefined;
  constructor(
    private readonly store: RunStore,
    private readonly runId: string,
  ) {}

  async restore(): Promise<ReportChainEntry[]> {
    const entries: ReportChainEntry[] = [];
    for (const event of await this.store.readDurableRunEvents(this.runId)) {
      if (event.payload.kind !== 'report_provenance') {
        continue;
      }
      const record = recordSchema.parse(JSON.parse(event.payload.record));
      if (record.kind === 'entry') {
        const { serviceId, commitHashes, ...base } = record.entry;
        entries.push({
          ...base,
          ...(serviceId !== undefined ? { serviceId } : {}),
          ...(commitHashes !== undefined
            ? {
                commitHashes: commitHashes.map(({ implementReportIds, ...hash }) => ({
                  ...hash,
                  ...(implementReportIds !== undefined ? { implementReportIds } : {}),
                })),
              }
            : {}),
        });
      }
      if (record.kind === 'pending') {
        this.pending = record.payload;
      }
      if (record.kind === 'settled') {
        this.pending = undefined;
      }
    }
    return entries;
  }

  private async append(record: Record): Promise<void> {
    await this.store.appendDurableEvent(this.runId, {
      run_id: this.runId,
      actor: 'app',
      state_version: 0,
      event_type: 'post_processed',
      payload: { kind: 'report_provenance', record: JSON.stringify(record) },
    });
  }
  async recordEntry(entry: ReportChainEntry): Promise<void> {
    await this.append({ kind: 'entry', entry: entrySchema.parse(entry) });
  }
  async retain(payload: PendingCommitReport): Promise<void> {
    await this.append({ kind: 'pending', payload });
    this.pending = payload;
  }
  async settle(): Promise<void> {
    await this.append({ kind: 'settled' });
    this.pending = undefined;
  }
}
