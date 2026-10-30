import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

const FOOTPRINT_TIMEOUT_MS = 30_000;

const footprintReportSchema = z.object({
  processes: z.array(z.object({ auxiliary: z.object({ phys_footprint: z.number() }) })).min(1),
});

/**
 * Reads the process's physical footprint, the number macOS `footprint` and
 * Activity Monitor report. It includes native allocations that `rss` and the V8
 * statistics miss, such as memory macOS has compressed or swapped out.
 *
 * The latest value is cached so a synchronous sampler can log it; each
 * `refresh()` replaces it. Returns null on platforms without `footprint`.
 */
export class PhysicalFootprintReader {
  private latestBytes: number | null = null;
  private refreshing: Promise<void> | null = null;

  public get bytes(): number | null {
    return this.latestBytes;
  }

  public refresh(): Promise<void> {
    if (process.platform !== 'darwin') return Promise.resolve();
    this.refreshing ??= this.read().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async read(): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'heyhey-footprint-'));
    try {
      const reportPath = join(directory, 'footprint.json');
      await execFileAsync('footprint', ['-p', String(process.pid), '-j', reportPath], {
        timeout: FOOTPRINT_TIMEOUT_MS,
      });
      const report = footprintReportSchema.parse(JSON.parse(await readFile(reportPath, 'utf8')));
      this.latestBytes = report.processes[0]?.auxiliary.phys_footprint ?? null;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
