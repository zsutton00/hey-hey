import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectReportGroup, ProjectReportSubjectSummary } from './project-report-grouping';
import {
  PROJECT_REPORT_SHARD_BYTES,
  paginateLines,
  type ProjectReportEvidenceManifest,
  type ProjectReportShardEntry,
} from './project-report-evidence-store';

interface SpooledLine {
  offset: number;
  length: number;
  timestamp: string;
}

/**
 * Holds activity lines on disk while pages are still being read, so the reader
 * never accumulates the whole activity population in memory. It lives outside
 * the shard files and is removed once the shards are written.
 */
export class ProjectReportActivitySpool {
  private readonly lines = new Map<string, SpooledLine[]>();
  private size = 0;

  private constructor(
    private readonly filePath: string,
    private readonly handle: fs.FileHandle,
  ) {}

  public static async open(filePath: string): Promise<ProjectReportActivitySpool> {
    const handle = await fs.open(filePath, 'w+', 0o600);
    return new ProjectReportActivitySpool(filePath, handle);
  }

  public async append(subjectKey: string, timestamp: string, line: string): Promise<void> {
    const bytes = Buffer.from(line, 'utf8');
    await this.handle.write(bytes, 0, bytes.length, this.size);
    const entries = this.lines.get(subjectKey) ?? [];
    entries.push({ offset: this.size, length: bytes.length, timestamp });
    this.lines.set(subjectKey, entries);
    this.size += bytes.length;
  }

  /** One subject's activity lines, oldest first. */
  public async readSubject(subjectKey: string): Promise<string[]> {
    const entries = [...(this.lines.get(subjectKey) ?? [])].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );
    const lines: string[] = [];
    for (const entry of entries) {
      const buffer = Buffer.alloc(entry.length);
      await this.handle.read(buffer, 0, entry.length, entry.offset);
      lines.push(buffer.toString('utf8'));
    }
    return lines;
  }

  public async dispose(): Promise<void> {
    await this.handle.close();
    await fs.rm(this.filePath, { force: true });
  }
}

export interface ProjectReportSubjectLines {
  lines: string[];
  activityCount: number;
}

interface PendingShard {
  lines: string[];
  bytes: number;
  subjectCount: number;
  activityCount: number;
}

/**
 * Writes each group's subjects into shards of about PROJECT_REPORT_SHARD_BYTES.
 * A subject is never split across shards; one larger than a shard gets its own.
 */
export class ProjectReportShardWriter {
  private readonly shards: ProjectReportShardEntry[] = [];

  public constructor(private readonly evidenceDirectory: string) {}

  public async write(
    groups: readonly ProjectReportGroup[],
    linesFor: (subject: ProjectReportSubjectSummary) => Promise<ProjectReportSubjectLines>,
  ): Promise<ProjectReportEvidenceManifest> {
    for (const group of groups) {
      let pending: PendingShard = { lines: [], bytes: 0, subjectCount: 0, activityCount: 0 };

      for (const subject of group.subjects) {
        const subjectLines = await linesFor(subject);
        const subjectBytes = subjectLines.lines.reduce(
          (sum, line) => sum + Buffer.byteLength(line, 'utf8') + 1,
          0,
        );

        if (pending.subjectCount > 0 && pending.bytes + subjectBytes > PROJECT_REPORT_SHARD_BYTES) {
          await this.flush(group, pending);
          pending = { lines: [], bytes: 0, subjectCount: 0, activityCount: 0 };
        }

        pending.lines.push(...subjectLines.lines);
        pending.bytes += subjectBytes;
        pending.subjectCount += 1;
        pending.activityCount += subjectLines.activityCount;
      }

      if (pending.subjectCount > 0) {
        await this.flush(group, pending);
      }
    }

    return {
      shards: this.shards,
      totalRecordCount: this.shards.reduce((sum, shard) => sum + shard.recordCount, 0),
      totalActivityCount: this.shards.reduce((sum, shard) => sum + shard.activityCount, 0),
    };
  }

  private async flush(group: ProjectReportGroup, pending: PendingShard): Promise<void> {
    const id = `shard-${String(this.shards.length + 1).padStart(4, '0')}`;
    const relativePath = `${id}.jsonl`;
    const content = `${pending.lines.join('\n')}\n`;
    await fs.writeFile(path.join(this.evidenceDirectory, relativePath), content, {
      encoding: 'utf8',
      mode: 0o600,
    });

    this.shards.push({
      id,
      path: relativePath,
      groupKey: group.key,
      groupKind: group.kind,
      groupTitle: group.title,
      subjectCount: pending.subjectCount,
      recordCount: pending.lines.length,
      activityCount: pending.activityCount,
      byteSize: Buffer.byteLength(content, 'utf8'),
      pageCount: paginateLines(pending.lines).length,
    });
  }
}
