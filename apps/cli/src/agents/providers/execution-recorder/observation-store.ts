import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { version } from '../../../../package.json';
import { DurableDataCompatibilityReader } from '../../../durable-data/compatibility-reader';
import type { ServerLogger } from '../../../server/logger';
import {
  observationSchema,
  type ExecutionObservation,
  type CaptureRoot,
  type CaptureGap,
  type CaptureProvider,
} from './observation';

const envelopeSchema = z.object({
  schemaVersion: z.number().int(),
  applicationVersion: z.string(),
  payload: z.json(),
});
const within = (candidate: string, root: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
};

/** Atomic observation files and immutable blobs are separate from every canonical Run store. */
export class ObservationStore {
  private readonly reader: DurableDataCompatibilityReader;

  public constructor(
    public readonly directory: string,
    private readonly logger: ServerLogger,
  ) {
    this.reader = new DurableDataCompatibilityReader(version, (diagnostic) => {
      logger.warn('execution_capture.incompatible', {
        familyId: diagnostic.familyId,
        reason: diagnostic.reason,
      });
    });
  }

  public contains(candidate: string): boolean {
    return within(candidate, this.directory);
  }

  private async publish(
    filePath: string,
    bytes: Uint8Array,
    immutable = false,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    signal?.throwIfAborted();
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
      const file = await fs.open(temporary, 'wx', 0o600);
      try {
        signal?.throwIfAborted();
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      signal?.throwIfAborted();
      if (immutable) {
        try {
          await fs.link(temporary, filePath);
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
        }
      } else {
        await fs.rename(temporary, filePath);
      }
      const directory = await fs.open(path.dirname(filePath), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  public async putBlob(bytes: Uint8Array): Promise<string> {
    const hash = createHash('sha256').update(bytes).digest('hex');
    await this.publish(path.join(this.directory, 'blobs', hash), bytes, true);
    return hash;
  }

  public async readBlob(hash: string): Promise<Buffer> {
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(hash);
    const bytes = await fs.readFile(path.join(this.directory, 'blobs', hash));
    if (createHash('sha256').update(bytes).digest('hex') !== hash)
      throw new Error('Capture blob checksum mismatch');
    return bytes;
  }

  public async save(observation: ExecutionObservation, signal?: AbortSignal): Promise<void> {
    const validated = observationSchema.parse(observation);
    const bytes = Buffer.from(
      JSON.stringify({ schemaVersion: 1, applicationVersion: version, payload: validated }),
    );
    await this.publish(
      path.join(this.directory, 'observations', `${validated.id}.json`),
      bytes,
      false,
      signal,
    );
    signal?.throwIfAborted();
    const pendingPath = path.join(
      this.directory,
      'pending',
      `${validated.ownerPid}_${validated.id}.json`,
    );
    if (validated.state === 'pending') {
      await this.publish(pendingPath, bytes, false, signal);
    } else {
      await fs.rm(pendingPath, { force: true });
    }
  }

  public async remove(id: string, ownerPid: number): Promise<void> {
    await fs.rm(path.join(this.directory, 'observations', `${id}.json`), { force: true });
    await fs.rm(path.join(this.directory, 'pending', `${ownerPid}_${id}.json`), { force: true });
    for (const name of await this.names('overlaps')) {
      const ids = name.replace(/\.json$/, '').split('_');
      if (!ids.includes(id)) {
        continue;
      }
      const remaining = await Promise.all(
        ids
          .filter((other) => other !== id)
          .map(async (other) => {
            try {
              await fs.access(path.join(this.directory, 'observations', `${other}.json`));
              return true;
            } catch (error) {
              if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                return false;
              }
              throw error;
            }
          }),
      );
      if (!remaining.some(Boolean)) {
        await fs.rm(path.join(this.directory, 'overlaps', name), { force: true });
      }
    }
  }

  private async names(collection: string): Promise<string[]> {
    try {
      return await fs.readdir(path.join(this.directory, collection));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  public async coverage(input: {
    sessionId: string;
    runId: string;
    turnId: string;
    provider: CaptureProvider;
    roots: readonly CaptureRoot[];
    harnessVersion: string;
    reason: CaptureGap;
  }): Promise<void> {
    await this.publish(
      path.join(this.directory, 'coverage', `${randomUUID()}.json`),
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          applicationVersion: version,
          payload: { ...input, state: 'incomplete', recordedAt: Date.now() },
        }),
      ),
      true,
    );
  }

  public async list(
    collection: 'observations' | 'pending' = 'observations',
  ): Promise<ExecutionObservation[]> {
    const directory = path.join(this.directory, collection);
    const names = await this.names(collection);
    const observations: ExecutionObservation[] = [];
    for (const name of names.filter((name) => name.endsWith('.json'))) {
      const filePath = path.join(directory, name);
      if (collection === 'pending') {
        const pid = Number(name.split('_')[0]);
        if (!Number.isInteger(pid) || pid <= 0) {
          this.logger.warn('execution_capture.pending_invalid', {
            filePath,
            reason: 'invalid-owner-pid',
          });
          continue;
        }
        try {
          process.kill(pid, 0);
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
            await fs.rm(filePath, { force: true });
            continue;
          }
          this.logger.warn('execution_capture.owner_check_failed', { filePath, error });
        }
      }
      const result = await this.reader.open({
        familyId: 'tool-execution-observation',
        currentSchemaVersion: 1,
        readSource: async () => {
          try {
            return {
              paths: [filePath],
              bytesByPath: new Map([[filePath, await fs.readFile(filePath)]]),
            };
          } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
              this.logger.warn('execution_capture.observation_read_failed', { filePath, error });
            }
            return null;
          }
        },
        decodeSource: (source) => {
          const bytes = source.bytesByPath.get(filePath);
          if (!bytes) throw new Error('Missing observation source');
          const decoded = envelopeSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
          return {
            source,
            sourceSchemaVersion: decoded.schemaVersion,
            writerApplicationVersion: decoded.applicationVersion,
            payload: decoded.payload,
          };
        },
        migrations: new Map(),
        validateCurrent: (payload) => observationSchema.parse(payload),
        promoteAtomically: async () => {
          throw new Error('No observation migrations are supported');
        },
      });
      if (result.status === 'incompatible') {
        this.logger.warn('execution_capture.observation_unreadable', {
          filePath,
          reason: 'incompatible-evidence-retained',
        });
        continue;
      }
      if (result.status === 'ready') {
        if (collection === 'pending' && result.value.state !== 'pending') {
          await fs.rm(filePath, { force: true });
          continue;
        }
        observations.push(result.value);
      }
    }
    return observations;
  }

  /** Pair files avoid lost updates when independent processes observe the same roots. */
  public async recordOverlaps(
    observation: ExecutionObservation,
    signal?: AbortSignal,
  ): Promise<void> {
    for (const other of await this.list('pending')) {
      if (other.id === observation.id) continue;
      const sharedRoot = observation.roots.some((left) =>
        other.roots.some((right) => within(left.root, right.root) || within(right.root, left.root)),
      );
      if (
        !sharedRoot ||
        (other.endedAt !== null && other.endedAt < observation.startedAt) ||
        (observation.endedAt !== null && observation.endedAt < other.startedAt)
      )
        continue;
      const ids = [other.id, observation.id].sort();
      await this.publish(
        path.join(this.directory, 'overlaps', `${ids.join('_')}.json`),
        Buffer.from(JSON.stringify(ids)),
        true,
        signal,
      );
    }
  }

  public async read(): Promise<ExecutionObservation[]> {
    const observations = await this.list();
    let overlaps: string[] = [];
    try {
      overlaps = await fs.readdir(path.join(this.directory, 'overlaps'));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    return observations.map((observation) => {
      const gaps = new Set(observation.gaps);
      if (overlaps.some((name) => name.split(/[_.]/).includes(observation.id))) gaps.add('overlap');
      if (observation.state === 'pending') {
        try {
          process.kill(observation.ownerPid, 0);
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
            gaps.add('interrupted');
            if (observation.before === null) gaps.add('missing_baseline');
          }
        }
      }
      return {
        ...observation,
        gaps: [...gaps],
        state: gaps.size ? 'incomplete' : observation.state,
      };
    });
  }
}
