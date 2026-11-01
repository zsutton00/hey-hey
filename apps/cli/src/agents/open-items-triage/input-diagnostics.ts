import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { CanonicalJsonValue } from '../../shared/canonical-json';
import type { ServerLogger } from '../../server/logger';
import type { TriageInput } from './input-owner';

const packageSchema = z.object({ name: z.string() });

// Resolve from the CLI module, not the agent workspace or the caller's cwd.
// Works both from src/ in development and from the bundled dist/index.mjs.
function cliLogsDirectory(): string {
  let directory = __dirname;
  while (true) {
    const manifest = join(directory, 'package.json');
    if (
      existsSync(manifest) &&
      packageSchema.parse(JSON.parse(readFileSync(manifest, 'utf8'))).name === '@hey-hey/cli'
    )
      return join(directory, 'logs');
    const parent = dirname(directory);
    if (parent === directory) throw new Error('Cannot locate the CLI package root.');
    directory = parent;
  }
}

/** One preparation's fetched data and the exact budgeted input sent to the agent. */
export class TriageInputDiagnostics {
  private readonly reads: {
    path: string;
    query: string;
    status: number;
    data?: CanonicalJsonValue;
  }[] = [];

  public record(url: string, status: number, data?: CanonicalJsonValue): void {
    const parsed = new URL(url);
    this.reads.push({
      path: parsed.pathname,
      query: parsed.search,
      status,
      ...(data !== undefined ? { data } : {}),
    });
  }

  public async write(
    metadata: { runId: string; projectId: string; requestKind: string; mode: string },
    input: TriageInput | null,
    logger: ServerLogger,
    directory?: string,
  ): Promise<void> {
    try {
      const capturedAt = new Date().toISOString();
      // Serialize before yielding so later activity cannot change this snapshot.
      // Deliberately excludes request headers, access tokens and user messages.
      const contents = JSON.stringify(
        {
          capturedAt,
          ...metadata,
          outcome: input === null ? 'input_failed' : 'input_ready',
          reads: this.reads,
          input,
        },
        null,
        2,
      );
      const destination = directory ?? cliLogsDirectory();
      await mkdir(destination, { recursive: true });
      const path = join(
        destination,
        `open-items-triage-${capturedAt.replace(/:/gu, '-')}-${randomUUID()}.json`,
      );
      await writeFile(path, `${contents}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      logger.info('open_items_triage.input.dump_written', { ...metadata, path });
    } catch {
      logger.warn('open_items_triage.input.dump_failed', metadata);
    }
  }
}
