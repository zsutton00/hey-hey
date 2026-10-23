import { writeFile } from 'node:fs/promises';
import type { DiagnosticFeedSnapshot, DiagnosticMetadata } from './diagnostic-feed';

export interface DiagnosticFeedExport {
  readonly path: string;
  readonly count: number;
  readonly evictedCount: number;
  readonly expiredCount: number;
}

interface DiagnosticExportMetadata extends DiagnosticMetadata {
  readonly kind: 'diagnostic_metadata';
  readonly version: 1;
  readonly evictedCount: number;
  readonly droppedReentrantCount: number;
  readonly retainedCount: number;
}

/** The filename suggested to the user when they choose where an export goes. */
export const diagnosticExportFilename = (now: Date): string =>
  `debug-${now.toISOString().replace(/:/gu, '-')}.jsonl`;

/**
 * Writes one snapshot of the bounded Debug feed as JSONL to a destination the
 * user confirmed. The caller captures the snapshot before choosing the
 * destination so entries appended meanwhile are not exported.
 */
export const writeDiagnosticExport = async (
  snapshot: DiagnosticFeedSnapshot,
  path: string,
): Promise<DiagnosticFeedExport> => {
  const metadata = {
    kind: 'diagnostic_metadata',
    version: 1,
    policy: snapshot.policy,
    coverage: snapshot.coverage,
    losses: snapshot.losses,
    evictedCount: snapshot.evictedCount,
    expiredCount: snapshot.expiredCount,
    droppedReentrantCount: snapshot.droppedReentrantCount,
    repetitionCount: snapshot.repetitionCount,
    retainedCount: snapshot.records.length,
  } satisfies DiagnosticExportMetadata;
  const contents = [
    JSON.stringify(metadata),
    ...snapshot.records.map((record) => JSON.stringify(record)),
  ].join('\n');

  // The save dialog already asked the user before replacing an existing file.
  await writeFile(path, `${contents}\n`, { encoding: 'utf8', mode: 0o600 });

  return {
    path,
    count: snapshot.records.length,
    evictedCount: snapshot.evictedCount,
    expiredCount: snapshot.expiredCount,
  };
};
