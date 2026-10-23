import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { version as applicationVersion } from '../../../package.json';
import { DurableDataCompatibilityReader, type JsonValue } from '../../durable-data';
import { MachineStateStore, type MachineStateStoreCodec } from '../../state-machine/state-store';
import type { ServerLogger } from '../logger';
import {
  INPUT_QUEUE_SCHEMA_VERSION,
  decodeStoredRecord,
  quarantinedRecordSchema,
  type QuarantinedRecord,
  type ReadableInputRecord,
} from './input-admission-codec';
import { INPUT_QUEUE_MIGRATIONS } from './input-queue-schema-versions';

export interface InputAdmissionStorePaths {
  /** Holds one `<agentSessionId>.json` file per session, plus the open-session index. */
  readonly directory: string;
  /** The retired single-file event-sourced store, migrated once and removed. */
  readonly legacyStoreFile: string;
}

/** Derived index of sessions that may still owe work; never a session file. */
export const OPEN_SESSION_INDEX_FILE = 'open-sessions.json';

/** One session's records this build can read, and the ones it keeps without reading. */
export interface SessionRead {
  readonly records: readonly ReadableInputRecord[];
  readonly quarantined: readonly QuarantinedRecord[];
}

const sessionFileHeaderSchema = z.object({
  schemaVersion: z.number().int().positive(),
  writerApplicationVersion: z.string().optional(),
});
const currentSessionBodySchema = z.strictObject({
  records: z.array(z.json()),
  quarantined: z.array(quarantinedRecordSchema),
});

const openSessionIndexSchema = z.object({
  schemaVersion: z.literal(1),
  sessionIds: z.array(z.string()),
});

const legacyContextSchema = z.object({ records: z.array(z.json()) });
const legacyCodec: MachineStateStoreCodec<
  'input-admission',
  'ready',
  z.infer<typeof legacyContextSchema>,
  never,
  never
> = {
  decodeMachineType: (value) => z.literal('input-admission').parse(value),
  decodeState: (value) => z.literal('ready').parse(value),
  decodeContext: (value) => legacyContextSchema.parse(value),
  decodeEffect: () => {
    throw new Error('Input admission never declared effects.');
  },
  decodeOutcome: () => {
    throw new Error('Input admission never recorded outcomes.');
  },
  payloadCompatibility: () => ({
    currentSchemaVersion: 1,
    migrations: new Map<number, (value: JsonValue) => JsonValue>(),
  }),
};

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

/** Readable records are re-encoded through JSON so absent optionals stay absent on disk. */
const encodeRecords = (records: readonly ReadableInputRecord[]): JsonValue =>
  z.array(z.json()).parse(JSON.parse(JSON.stringify(records)));

/**
 * One small file per agent session, so committing an input never rewrites another session's
 * inputs. Files are a versioned data family: older versions migrate when opened, each record
 * decodes on its own, and a record this build cannot read is quarantined rather than making
 * its whole session unreadable.
 */
export class InputAdmissionStore {
  private readonly reader: DurableDataCompatibilityReader;

  constructor(
    private readonly paths: InputAdmissionStorePaths,
    private readonly logger: ServerLogger,
  ) {
    this.reader = new DurableDataCompatibilityReader(applicationVersion, (diagnostic) =>
      this.logger.error('input_admission.session_incompatible', {
        familyId: diagnostic.familyId,
        reason: diagnostic.reason,
        sourceSchemaVersion: diagnostic.sourceSchemaVersion,
        currentSchemaVersion: diagnostic.currentSchemaVersion,
        writerApplicationVersion: diagnostic.writerApplicationVersion,
        readerApplicationVersion: diagnostic.readerApplicationVersion,
        error: diagnostic.errorMessage,
        preserved: true,
      }),
    );
  }

  private sessionFile(sessionId: string): string {
    return path.join(this.paths.directory, `${sessionId}.json`);
  }

  /**
   * A session with no file has never admitted an input. Throws, leaving the file untouched,
   * only when the file as a whole cannot be read: bad JSON, a newer schemaVersion, or a
   * failed migration or promotion.
   */
  async readSession(sessionId: string): Promise<SessionRead> {
    const file = this.sessionFile(sessionId);
    const result = await this.reader.open<SessionRead>({
      familyId: `input-queue:${sessionId}`,
      currentSchemaVersion: INPUT_QUEUE_SCHEMA_VERSION,
      readSource: async () => {
        try {
          return { paths: [file], bytesByPath: new Map([[file, await fs.readFile(file)]]) };
        } catch (error) {
          if (isMissing(error)) return null;
          throw error;
        }
      },
      decodeSource: (source) => {
        const bytes = source.bytesByPath.get(file);
        if (!bytes) throw new Error('Input queue session source is missing.');
        const value = z
          .record(z.string(), z.json())
          .parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
        const header = sessionFileHeaderSchema.parse(value);
        const body = Object.fromEntries(
          Object.entries(value).filter(
            ([field]) => field !== 'schemaVersion' && field !== 'writerApplicationVersion',
          ),
        );
        return {
          source,
          sourceSchemaVersion: header.schemaVersion,
          writerApplicationVersion: header.writerApplicationVersion ?? null,
          payload: body,
        };
      },
      migrations: INPUT_QUEUE_MIGRATIONS,
      validateCurrent: (payload) => {
        const body = currentSessionBodySchema.parse(payload);
        const records: ReadableInputRecord[] = [];
        const quarantined = [...body.quarantined];
        for (const raw of body.records) {
          const decoded = decodeStoredRecord(raw);
          if (decoded.status === 'readable') records.push(decoded.record);
          else
            quarantined.push({
              key: decoded.key,
              reason: decoded.reason,
              sourceSchemaVersion: INPUT_QUEUE_SCHEMA_VERSION,
              raw,
            });
        }
        return { records, quarantined };
      },
      promoteAtomically: ({ value }) => this.writeSession(sessionId, value),
    });
    if (result.status === 'absent') return { records: [], quarantined: [] };
    if (result.status === 'incompatible')
      throw new Error(
        `Input queue session ${sessionId} is unreadable (${result.diagnostic.reason}); its file is preserved.`,
      );
    for (const record of result.value.quarantined)
      this.logger.warn('input_admission.record_quarantined', {
        agentSessionId: sessionId,
        recordKey: record.key,
        reason: record.reason,
        sourceSchemaVersion: record.sourceSchemaVersion,
        preserved: true,
      });
    return result.value;
  }

  /** Every stored session id. Only the open-session index rebuild may call this. */
  async listSessionIds(): Promise<string[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.paths.directory);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    return names
      .filter((name) => name.endsWith('.json') && name !== OPEN_SESSION_INDEX_FILE)
      .map((name) => name.slice(0, -'.json'.length));
  }

  /**
   * `null` when the index is missing, unreadable or of an unsupported version. It is derived
   * from the session files, so the caller rebuilds it rather than reading it as empty.
   */
  async readOpenSessionIndex(): Promise<string[] | null> {
    let bytes: string;
    try {
      bytes = await fs.readFile(path.join(this.paths.directory, OPEN_SESSION_INDEX_FILE), 'utf8');
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    try {
      return openSessionIndexSchema.parse(JSON.parse(bytes)).sessionIds;
    } catch (error) {
      this.logger.warn('input_admission.open_index_unreadable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  writeOpenSessionIndex(sessionIds: readonly string[]): Promise<void> {
    return this.atomicWrite(OPEN_SESSION_INDEX_FILE, { schemaVersion: 1, sessionIds });
  }

  /** Quarantined records are written back unchanged, so no commit ever drops them. */
  writeSession(sessionId: string, session: SessionRead): Promise<void> {
    return this.atomicWrite(`${sessionId}.json`, {
      schemaVersion: INPUT_QUEUE_SCHEMA_VERSION,
      writerApplicationVersion: applicationVersion,
      records: encodeRecords(session.records),
      quarantined: session.quarantined,
    });
  }

  private async atomicWrite(name: string, content: unknown): Promise<void> {
    const directory = this.paths.directory;
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const target = path.join(directory, name);
    const temp = `${target}.tmp-${randomUUID()}`;
    try {
      const file = await fs.open(temp, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(content), 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await fs.rename(temp, target);
      // POSIX requires syncing the parent directory for the rename itself to
      // survive a crash. Windows does not support opening directories this way.
      if (process.platform !== 'win32') {
        const handle = await fs.open(directory, 'r');
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
    } finally {
      await fs.rm(temp, { force: true }).catch(() => undefined);
    }
  }

  /**
   * The retired store appended a full session snapshot on every write and never pruned it.
   * Only the current records carry obligations, so they alone move, as the schemaVersion 1
   * session file they were, and migrate like any other v1 file when first read. Nothing
   * writes before the owner opens, so a crash mid-migration simply migrates again from the
   * intact legacy file. Returns whether a migration ran, since migrated sessions are absent
   * from the index.
   */
  async migrateLegacyStore(): Promise<boolean> {
    try {
      await fs.access(this.paths.legacyStoreFile);
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
    const instances = await new MachineStateStore(
      this.paths.legacyStoreFile,
      legacyCodec,
    ).listInstances();
    let records = 0;
    for (const instance of instances) {
      const sessionRecords = instance.snapshot.context.records;
      if (sessionRecords.length === 0) continue;
      await this.atomicWrite(`${instance.snapshot.identity.instanceId}.json`, {
        schemaVersion: 1,
        records: sessionRecords,
      });
      records += sessionRecords.length;
    }
    await fs.rm(this.paths.legacyStoreFile);
    this.logger.info('input_admission.legacy_store_migrated', {
      sessions: instances.length,
      records,
    });
    return true;
  }
}
