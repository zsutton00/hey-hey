/**
 * File-backed evidence for one report attempt.
 *
 * The reader writes every matching record into JSONL shards under a Run-owned
 * directory, and a manifest describes them. Agents never receive evidence in
 * their prompt: they read shards one page at a time through the host-owned
 * `read_evidence_shard` tool. The ledger below records every page the host hands
 * out, so "every record was read" is observed by the host, never claimed by an
 * agent, and `create_report` is refused until it holds.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ProjectReportEvidenceReferenceKindEnum } from '../../shared/api/generated/api';
import type { ProjectReportGroupKind } from './project-report-grouping';

/** Largest shard the writer cuts; a subject is never split, so one oversized subject may exceed it. */
export const PROJECT_REPORT_SHARD_BYTES = 150_000;
/** Largest page the tool returns; a single line larger than this is a page of its own. */
export const PROJECT_REPORT_PAGE_BYTES = 48_000;
/** Document id under which the host serves section findings to the parent. */
export const PROJECT_REPORT_FINDINGS_DOCUMENT_ID = 'findings';

const EVIDENCE_SUBDIRECTORY = 'project-report-evidence';
const FINDINGS_FILE_NAME = 'findings.md';

export interface ProjectReportShardEntry {
  id: string;
  /** Relative to the evidence directory. */
  path: string;
  groupKey: string;
  groupKind: ProjectReportGroupKind;
  groupTitle: string;
  subjectCount: number;
  /** Lines in the shard: one current-state line and every activity line per subject. */
  recordCount: number;
  activityCount: number;
  byteSize: number;
  pageCount: number;
}

export interface ProjectReportEvidenceManifest {
  shards: ProjectReportShardEntry[];
  totalRecordCount: number;
  totalActivityCount: number;
}

/** Every line of a document, in order, cut into pages that each fit the page size. */
export const paginateLines = (lines: readonly string[]): string[][] => {
  const pages: string[][] = [];
  let current: string[] = [];
  let currentBytes = 0;
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
    if (current.length > 0 && currentBytes + lineBytes > PROJECT_REPORT_PAGE_BYTES) {
      pages.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(line);
    currentBytes += lineBytes;
  }
  if (current.length > 0) {
    pages.push(current);
  }
  return pages;
};

export const evidenceDirectoryOf = (runDirectory: string): string =>
  path.join(runDirectory, EVIDENCE_SUBDIRECTORY);

/** The line that opens each subject in a shard, as far as the host reads it back. */
const contextLineSchema = z.object({
  kind: z.literal(ProjectReportEvidenceReferenceKindEnum.CurrentStateContext),
  evidenceReferences: z.array(z.object({ key: z.string() }).passthrough()),
});

export interface ProjectReportEvidencePage {
  documentId: string;
  page: number;
  pageCount: number;
  recordCount: number;
  text: string;
}

export class ProjectReportEvidenceReadError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ProjectReportEvidenceReadError';
  }
}

/** Pages handed out for one report attempt, keyed to the manifest the host wrote. */
export class ProjectReportEvidenceLedger {
  private readonly servedPages = new Map<string, Set<number>>();
  private findingsPageCount: number | null = null;

  public constructor(
    private readonly evidenceDirectory: string,
    public readonly manifest: ProjectReportEvidenceManifest,
  ) {}

  /**
   * Makes the section findings readable by the parent, followed by the full
   * evidence-reference objects for every key the findings cite, so the parent can
   * cite them without reading shards a child already read. Findings do not gate
   * submission.
   */
  public async publishFindings(findings: string): Promise<void> {
    const cited = await this.referencesCitedIn(findings);
    const document =
      cited.length === 0
        ? findings
        : [
            findings,
            '',
            '## Evidence references for the keys cited above',
            '',
            '```json',
            JSON.stringify(cited, null, 2),
            '```',
          ].join('\n');

    await fs.writeFile(path.join(this.evidenceDirectory, FINDINGS_FILE_NAME), document, 'utf8');
    this.findingsPageCount = paginateLines(document.split('\n')).length;
  }

  public async readPage(documentId: string, page: number): Promise<ProjectReportEvidencePage> {
    const filePath = this.pathOf(documentId);
    const text = await fs.readFile(filePath, 'utf8');
    const lines = text.split('\n');
    if (lines.at(-1) === '') {
      lines.pop();
    }
    const pages = paginateLines(lines);
    const pageLines = pages[page - 1];
    if (!pageLines) {
      throw new ProjectReportEvidenceReadError(
        `${documentId} has ${String(pages.length)} page${pages.length === 1 ? '' : 's'}; page ${String(page)} does not exist.`,
      );
    }

    const served = this.servedPages.get(documentId) ?? new Set<number>();
    served.add(page);
    this.servedPages.set(documentId, served);

    return {
      documentId,
      page,
      pageCount: pages.length,
      recordCount: pageLines.length,
      text: pageLines.join('\n'),
    };
  }

  /** Shards with at least one page the host has not yet handed out, in manifest order. */
  public unreadShards(): ProjectReportShardEntry[] {
    return this.manifest.shards.filter(
      (shard) => (this.servedPages.get(shard.id)?.size ?? 0) < shard.pageCount,
    );
  }

  public unreadPages(shard: ProjectReportShardEntry): number[] {
    const served = this.servedPages.get(shard.id) ?? new Set<number>();
    return Array.from({ length: shard.pageCount }, (_, index) => index + 1).filter(
      (page) => !served.has(page),
    );
  }

  public get findingsPublished(): boolean {
    return this.findingsPageCount !== null;
  }

  /** Scans the shard files directly; scanning is the host's, so it marks nothing as read. */
  private async referencesCitedIn(findings: string): Promise<object[]> {
    const citedKeys = new Set(findings.match(/[\w-]+/gu));
    const cited: object[] = [];
    for (const shard of this.manifest.shards) {
      const text = await fs.readFile(path.join(this.evidenceDirectory, shard.path), 'utf8');
      for (const line of text.split('\n')) {
        if (!line.includes(ProjectReportEvidenceReferenceKindEnum.CurrentStateContext)) {
          continue;
        }
        const parsed = contextLineSchema.safeParse(JSON.parse(line));
        if (!parsed.success) {
          continue;
        }
        cited.push(
          ...parsed.data.evidenceReferences.filter((reference) => citedKeys.has(reference.key)),
        );
      }
    }
    return cited;
  }

  private pathOf(documentId: string): string {
    if (documentId === PROJECT_REPORT_FINDINGS_DOCUMENT_ID) {
      if (this.findingsPageCount === null) {
        throw new ProjectReportEvidenceReadError(
          'No section findings were written for this report.',
        );
      }
      return path.join(this.evidenceDirectory, FINDINGS_FILE_NAME);
    }
    const shard = this.manifest.shards.find((entry) => entry.id === documentId);
    if (!shard) {
      throw new ProjectReportEvidenceReadError(
        `${documentId} is not a shard of this report. Shards: ${this.manifest.shards.map((entry) => entry.id).join(', ')}.`,
      );
    }
    return path.join(this.evidenceDirectory, shard.path);
  }
}

/** The ledgers of reports running in this CLI, keyed by the report's AgentSession. */
export class ProjectReportEvidenceLedgers {
  private readonly ledgers = new Map<string, ProjectReportEvidenceLedger>();

  public register(agentSessionId: string, ledger: ProjectReportEvidenceLedger): void {
    this.ledgers.set(agentSessionId, ledger);
  }

  public get(agentSessionId: string): ProjectReportEvidenceLedger | undefined {
    return this.ledgers.get(agentSessionId);
  }
}

export const projectReportEvidenceLedgers = new ProjectReportEvidenceLedgers();
