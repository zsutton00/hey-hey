import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgenticSession, AgenticSessionEvent } from '../session/types';
import { RunIndexStore } from './run-index';
import type { RunIndex, RunStorePaths } from './types';
import type { ResolvedServiceBinding } from '../shared/agent-bridge-contract/contract';
import { persistedRunEntitySchema } from '../run/run-entity';

export interface MigrationResult {
  migratedRunCount: number;
  migratedEventFileCount: number;
  skippedCorruptedSessions: string[];
}

export interface MigrateSessionsOptions {
  /** Preview eligible legacy Runs without writing Run files or the index. */
  readonly apply?: boolean;
}

interface SessionJson {
  agenticSessions?: unknown[];
  /** @deprecated Old field name kept for backward compat with existing JSON files. */
  agenticCodingSessions?: unknown[];
  [key: string]: unknown;
}

const tryParseEventLine = (line: string): AgenticSessionEvent | null => {
  try {
    return JSON.parse(line) as AgenticSessionEvent;
  } catch {
    return null;
  }
};

const extractRunMetadata = (raw: Record<string, unknown>): AgenticSession | null => {
  if (typeof raw['agentic_session_id'] !== 'string') return null;
  if (typeof raw['provider'] !== 'string') return null;
  if (!Object.hasOwn(raw, 'entity')) return null;

  const parsedEntity = persistedRunEntitySchema.safeParse(raw['entity']);
  if (!parsedEntity.success) return null;

  const legacyServiceId = raw['serviceId'];
  const persistedServices = raw['services'];
  let services: ResolvedServiceBinding[];
  let launchServiceId: string | undefined;
  if (Array.isArray(persistedServices)) {
    services = persistedServices as ResolvedServiceBinding[];
    launchServiceId =
      typeof raw['launchServiceId'] === 'string' ? (raw['launchServiceId'] as string) : undefined;
  } else if (typeof legacyServiceId === 'string' && legacyServiceId.length > 0) {
    services = [{ id: legacyServiceId, path: '' }];
    launchServiceId = legacyServiceId;
  } else {
    return null;
  }

  const { events: _events, ...metadata } = raw;
  return {
    ...metadata,
    entity: parsedEntity.data,
    services,
    ...(launchServiceId ? { launchServiceId } : {}),
    events: [],
  } as unknown as AgenticSession;
};

export const migrateSessionsToRuns = async (
  sessionsDir: string,
  paths: RunStorePaths,
  options: MigrateSessionsOptions = {},
): Promise<MigrationResult> => {
  const apply = options.apply ?? true;
  const result: MigrationResult = {
    migratedRunCount: 0,
    migratedEventFileCount: 0,
    skippedCorruptedSessions: [],
  };

  let sessionDirs: string[];
  try {
    sessionDirs = await fs.readdir(sessionsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result;
    throw error;
  }

  if (apply) await fs.mkdir(paths.runsDir, { recursive: true });

  const indexStore = new RunIndexStore();
  const allRuns: AgenticSession[] = [];

  for (const cliSessionId of sessionDirs) {
    const sessionJsonPath = path.join(sessionsDir, cliSessionId, 'session.json');

    let sessionData: SessionJson;
    try {
      const text = await fs.readFile(sessionJsonPath, 'utf8');
      sessionData = JSON.parse(text) as SessionJson;
    } catch {
      result.skippedCorruptedSessions.push(cliSessionId);
      continue;
    }

    const agenticSessions = sessionData.agenticSessions ?? sessionData.agenticCodingSessions;
    if (!Array.isArray(agenticSessions)) continue;

    for (const rawEntry of agenticSessions) {
      if (typeof rawEntry !== 'object' || rawEntry === null) continue;

      const record = rawEntry as Record<string, unknown>;
      const run = extractRunMetadata(record);
      if (!run) continue;

      const runId = run.agentic_session_id;
      const targetMetadataPath = path.join(paths.runsDir, `${runId}.json`);
      const targetManifestPath = path.join(paths.runsDir, `${runId}.family.json`);

      try {
        await fs.access(targetMetadataPath);
        continue;
      } catch {
        // The flat metadata file does not exist yet; a manifest-owned family
        // is also an existing target and must not be imported again.
        try {
          await fs.access(targetManifestPath);
          continue;
        } catch {
          // Neither target representation exists yet, proceed.
        }
      }

      // Handle inline events: if events are in the session JSON, write them
      // to a JSONL file before checking for an existing events file.
      const inlineEvents = Array.isArray(record['events']) ? record['events'] : [];
      const sourceEventPath = path.join(sessionsDir, cliSessionId, 'events', `${runId}.jsonl`);
      const targetEventPath = path.join(paths.runsDir, `${runId}.events.jsonl`);

      let hasSourceJsonl = false;
      try {
        await fs.access(sourceEventPath);
        hasSourceJsonl = true;
      } catch {
        // no JSONL file
      }

      // Write metadata
      const { events: _events, ...metadata } = run;
      if (apply) {
        await fs.writeFile(targetMetadataPath, JSON.stringify(metadata, null, 2), 'utf8');
      }
      result.migratedRunCount++;
      allRuns.push(run);

      // Migrate events
      if (hasSourceJsonl) {
        try {
          if (apply) await fs.copyFile(sourceEventPath, targetEventPath);
          result.migratedEventFileCount++;
        } catch {
          // best-effort event migration
        }
      } else if (inlineEvents.length > 0) {
        const lines: string[] = [];
        for (const rawEvent of inlineEvents) {
          if (typeof rawEvent === 'object' && rawEvent !== null) {
            const eventStr = JSON.stringify(rawEvent);
            const parsed = tryParseEventLine(eventStr);
            if (parsed) lines.push(eventStr);
          }
        }
        if (lines.length > 0) {
          if (apply) await fs.writeFile(targetEventPath, lines.join('\n') + '\n', 'utf8');
          result.migratedEventFileCount++;
        }
      }
    }
  }

  // Build and persist index
  if (apply) {
    const index: RunIndex = indexStore.rebuildFromRuns(allRuns);
    await indexStore.save(paths.indexPath, index);
  }

  return result;
};

export const hasLegacySessions = async (baseDir: string): Promise<boolean> => {
  const sessionsDir = path.join(baseDir, 'sessions');
  try {
    const entries = await fs.readdir(sessionsDir);
    for (const entry of entries) {
      const sessionJson = path.join(sessionsDir, entry, 'session.json');
      try {
        await fs.access(sessionJson);
        return true;
      } catch {
        continue;
      }
    }
    return false;
  } catch {
    return false;
  }
};
