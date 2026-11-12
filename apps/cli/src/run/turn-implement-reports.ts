import { createHash } from 'node:crypto';
import { LocalPromptType } from '@hey-hey/contracts/agent-bridge';
import type { ImplementReportEdit, ImplementReportPayload } from '@hey-hey/contracts/api/models';
import type { ExecutionRecorder } from '../agents/providers/execution-recorder/execution-recorder';
import type { CreateReportTool } from '../agents/submission-tools/create-report-tool';
import { anchorBlobs, diffBlobs, writeBlob, type LineRange } from '../git/object-store';
import type { ServerLogger } from '../server/logger';
import { ReportType } from '../shared/api/index';
import type { ImplementReportDecision } from '../turn/turn-change-record';
import type { Turn } from '../turn/turn';
import {
  canonicalFileChangeKey,
  resolveRunServiceRoots,
  type CanonicalFileChangeFact,
} from './file-change-facts';
import type { Run } from './run';
import type { ReportChainEntry } from './types';

const OPEN_SUMMARY =
  "Open completed the requested work and changed this Service's workspace, so this report records the turn's edits for downstream review. Hey Hey recorded each edit's file, versions and changed lines during the turn. No separate implementation decisions were supplied; follow-up phases should inspect the edits for code detail and continue from the normal report chain.";

const TASK_ONLY_SUMMARY =
  "Task Only completed the requested work and changed this Service's workspace, so this report records the turn's edits for downstream review without adding project grounding, feature synchronization, or structured plan creation. Hey Hey recorded each edit's file, versions and changed lines during the turn. No separate implementation decisions were supplied; follow-up phases should inspect the edits for code detail and continue from the normal report chain.";

const CODING_TURN_SUMMARY =
  "This coding turn changed this Service's workspace, so this report records the turn's edits for downstream review. Hey Hey recorded each edit's file, versions and changed lines during the turn. The agent supplied no summary or decisions; follow-up phases should inspect the edits for code detail and continue from the normal report chain.";

const defaultSummary = (promptType: string): string => {
  if (promptType === LocalPromptType.Quick) {
    return TASK_ONLY_SUMMARY;
  }
  if (promptType === LocalPromptType.FreeForm || promptType === LocalPromptType.CodingFreeform) {
    return OPEN_SUMMARY;
  }
  return CODING_TURN_SUMMARY;
};

export interface ServiceImplementReport {
  serviceId: string;
  edits: ImplementReportEdit[];
}

export type TurnImplementReportsResult =
  | {
      status: 'emitted';
      reports: ServiceImplementReport[];
      /** Services whose report could not be persisted; the others are unaffected. */
      failedServiceIds: string[];
    }
  | {
      status: 'skipped';
      reason:
        | 'not-coding-turn'
        | 'no-files-changed'
        | 'already-emitted'
        | 'missing-create-report-tool';
    };

export interface EmitTurnImplementReportsInput {
  run: Run;
  turn: Turn;
  logger: ServerLogger;
  /** Every canonical fact in the Run, in recording order; earlier facts chain before-versions. */
  facts: readonly CanonicalFileChangeFact[];
  /** Hook-captured file versions; null when precise file change tracking is off for the Run. */
  capturedVersions: ExecutionRecorder | null;
  reportsSinceTurnStart: ReadonlyArray<Readonly<ReportChainEntry>>;
  createReportTool: CreateReportTool | null;
}

const isBinaryContent = (content: string | null): boolean =>
  content !== null && (content.includes('\u0000') || content.includes('�'));

const wholeFileRanges = (content: string): LineRange[] => {
  const lines = content.split('\n');
  const lineCount = content.endsWith('\n') ? lines.length - 1 : lines.length;
  return lineCount === 0 ? [] : [{ startLine: 1, endLine: lineCount }];
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Builds one Service's edits from its canonical facts. Each edit's before
 * version is the Run's previous recorded version of the file, or HEAD for the
 * file's first recorded edit. Content is written to git and never returned.
 *
 * An edit is approximate unless a hook captured the file's version just before
 * the tool ran: the CLI otherwise reads a file only after the tool has run, so
 * another session's, script's or editor's change made in between lands in the
 * same ranges. A captured before-version that equals the version the Run
 * expects, with a captured after-version that equals what the CLI read, makes
 * the edit exact. Captured versions never add a file to the Run's changes.
 */
class ServiceEditBuilder {
  /** After-version object id per fact, null when the fact deleted the file. */
  private readonly afterObjectIds = new Map<string, string | null>();
  private readonly objectIds = new Set<string>();

  public constructor(
    private readonly run: Run,
    private readonly logger: ServerLogger,
    private readonly facts: readonly CanonicalFileChangeFact[],
    private readonly serviceId: string,
    private readonly fallbackRoot: string | null,
    private readonly captured: ExecutionRecorder | null,
  ) {}

  private readonly usedCaptures = new Set<unknown>();

  public get anchoredObjectIds(): string[] {
    return [...this.objectIds];
  }

  public async build(
    fact: CanonicalFileChangeFact,
    factIndex: number,
  ): Promise<ImplementReportEdit> {
    const root = fact.executionRoot ?? this.fallbackRoot;
    const base = {
      path: fact.repoRelativePath,
      occurredAt: fact.occurredAt,
      turnId: fact.turnId,
    };
    const unrecorded: ImplementReportEdit = {
      ...base,
      beforeObjectId: null,
      afterObjectId: null,
      beforeRanges: [],
      afterRanges: [],
      approximate: true,
      versionsRecorded: false,
    };

    const afterContent = fact.evidence.postContent;
    const expected = this.beforeVersion(fact, factIndex);
    const capture = await this.capturedVersion(fact);
    const before = this.withCapturedBefore(expected, capture);
    const exact =
      capture !== null && expected.source !== 'unknown' && capture.agrees(expected.content);
    if (root === null || isBinaryContent(afterContent) || isBinaryContent(before.content)) {
      this.logger.info('local.run.turn_implement_reports.edit_without_versions', {
        runId: this.run.runId,
        serviceId: this.serviceId,
        repoRelativePath: fact.repoRelativePath,
        reason: root === null ? 'unknown-root' : 'binary-content',
      });
      return unrecorded;
    }

    try {
      const beforeObjectId =
        before.source === 'chain'
          ? await this.storeAfterOf(before.fact, root)
          : before.content === null
            ? null
            : await this.store(root, before.content);
      const afterObjectId = afterContent === null ? null : await this.store(root, afterContent);
      this.afterObjectIds.set(fact.factId, afterObjectId);

      // Without a known before-version, a null id would read as a created file.
      if (before.source === 'unknown') {
        return { ...unrecorded, afterObjectId };
      }

      const ranges = await this.ranges(
        root,
        beforeObjectId,
        before.content,
        afterObjectId,
        afterContent,
      );

      return {
        ...base,
        beforeObjectId,
        afterObjectId,
        ...ranges,
        approximate: !exact,
        versionsRecorded: true,
      };
    } catch (error) {
      this.logger.warn('local.run.turn_implement_reports.version_write_failed', {
        runId: this.run.runId,
        serviceId: this.serviceId,
        repoRelativePath: fact.repoRelativePath,
        error: errorMessage(error),
      });
      return unrecorded;
    }
  }

  /**
   * The tool's own before and after versions of this file, or null when no hook captured
   * them. Failures reading the captured content are logged and leave the edit approximate.
   */
  private async capturedVersion(
    fact: CanonicalFileChangeFact,
  ): Promise<{ before: string | null; agrees: (expected: string | null) => boolean } | null> {
    if (this.captured === null) {
      return null;
    }
    const startedBefore = Date.parse(fact.occurredAt);
    const change = this.captured
      .capturedFileChanges(this.run.runId, fact.turnId, fact.serviceId, fact.repoRelativePath)
      .find(
        (candidate) => candidate.startedAt <= startedBefore && !this.usedCaptures.has(candidate),
      );
    if (change === undefined) {
      return null;
    }
    this.usedCaptures.add(change);
    try {
      const before =
        change.beforeHash === null
          ? null
          : (await this.captured.readCapturedContent(change.beforeHash)).toString('utf8');
      const post = fact.evidence.postContent;
      const postHash =
        post === null ? null : createHash('sha256').update(post, 'utf8').digest('hex');
      const afterAgrees = change.afterHash === postHash;
      return { before, agrees: (expected) => afterAgrees && expected === before };
    } catch (error) {
      this.logger.warn('local.run.turn_implement_reports.captured_version_unreadable', {
        runId: this.run.runId,
        serviceId: this.serviceId,
        repoRelativePath: fact.repoRelativePath,
        error: errorMessage(error),
      });
      return null;
    }
  }

  /**
   * The hook-captured before-version is the file as the tool found it, so it replaces the
   * expected one for the stored version and the line ranges. When the two differ, someone
   * else changed the file in between: the ranges then cover only this edit, but the edit
   * stays approximate and no longer chains to the Run's previous version.
   */
  private withCapturedBefore(
    expected: ReturnType<ServiceEditBuilder['beforeVersion']>,
    capture: { before: string | null } | null,
  ): ReturnType<ServiceEditBuilder['beforeVersion']> {
    if (capture === null) {
      return expected;
    }
    return { source: 'head', content: capture.before };
  }

  private beforeVersion(
    fact: CanonicalFileChangeFact,
    factIndex: number,
  ):
    | { source: 'chain'; fact: CanonicalFileChangeFact; content: string | null }
    | { source: 'head'; content: string | null }
    | { source: 'unknown'; content: null } {
    const key = canonicalFileChangeKey(fact.serviceId, fact.repoRelativePath);
    for (let index = factIndex - 1; index >= 0; index -= 1) {
      const earlier = this.facts[index]!;
      if (canonicalFileChangeKey(earlier.serviceId, earlier.repoRelativePath) === key) {
        return { source: 'chain', fact: earlier, content: earlier.evidence.postContent };
      }
    }
    // Evidence pre-content is the HEAD version, so it is only the true
    // before-version for the file's first recorded edit.
    if (fact.evidence.kind === 'patch') {
      return { source: 'head', content: fact.evidence.preContent };
    }
    if (fact.evidence.baselineContent !== null) {
      return { source: 'head', content: fact.evidence.baselineContent };
    }
    // Baseline evidence without content means git could not be read.
    return { source: 'unknown', content: null };
  }

  private async storeAfterOf(fact: CanonicalFileChangeFact, root: string): Promise<string | null> {
    const recorded = this.afterObjectIds.get(fact.factId);
    if (recorded !== undefined) {
      return recorded;
    }
    const content = fact.evidence.postContent;
    const objectId = content === null ? null : await this.store(root, content);
    this.afterObjectIds.set(fact.factId, objectId);
    return objectId;
  }

  private async store(root: string, content: string): Promise<string> {
    const objectId = await writeBlob(root, content);
    this.objectIds.add(objectId);
    return objectId;
  }

  private async ranges(
    root: string,
    beforeObjectId: string | null,
    beforeContent: string | null,
    afterObjectId: string | null,
    afterContent: string | null,
  ): Promise<{ beforeRanges: LineRange[]; afterRanges: LineRange[] }> {
    if (beforeObjectId !== null && afterObjectId !== null) {
      return await diffBlobs(root, beforeObjectId, afterObjectId);
    }
    return {
      beforeRanges:
        beforeObjectId !== null && beforeContent !== null ? wholeFileRanges(beforeContent) : [],
      afterRanges:
        afterObjectId !== null && afterContent !== null ? wholeFileRanges(afterContent) : [],
    };
  }
}

const withoutLocation = (decision: ImplementReportDecision): ImplementReportDecision => {
  const { location: _location, ...rest } = decision;
  return rest;
};

/**
 * Routes the agent's decisions: a located decision goes only to the Service
 * whose edits contain its file, an unlocated one to every Service. A decision
 * whose file no Service edited keeps its content but loses its location.
 */
const decisionsForService = (
  decisions: readonly ImplementReportDecision[],
  serviceId: string,
  editedPathsByService: ReadonlyMap<string, ReadonlySet<string>>,
): ImplementReportDecision[] =>
  decisions.flatMap((decision) => {
    const file = decision.location?.file;
    if (file === undefined) {
      return [decision];
    }
    const owners = [...editedPathsByService.entries()]
      .filter(([, paths]) => paths.has(file))
      .map(([owner]) => owner);
    if (owners.length === 0) {
      return [withoutLocation(decision)];
    }
    return owners.includes(serviceId) ? [decision] : [];
  });

const emittedServiceIds = (reports: ReadonlyArray<Readonly<ReportChainEntry>>): Set<string> =>
  new Set(
    reports
      .filter((entry) => entry.reportType === ReportType.Implement && entry.serviceId)
      .map((entry) => entry.serviceId!),
  );

/**
 * Emits exactly one IMPLEMENT report per Service the Turn changed, after
 * changed-file reconciliation has settled. A Turn with no canonical
 * file-change facts emits nothing, whatever the agent submitted.
 */
export const emitTurnImplementReports = async (
  input: EmitTurnImplementReportsInput,
): Promise<TurnImplementReportsResult> => {
  const { run, turn, logger, facts } = input;
  const promptType = turn.handler.promptType;
  const held = turn.changeRecord.heldReport();
  const turnFacts = facts
    .map((fact, index) => ({ fact, index }))
    .filter(({ fact }) => fact.turnId === turn.turnId);

  logger.debug('local.run.turn_implement_reports.evaluate', {
    runId: run.runId,
    turnId: turn.turnId,
    promptType,
    turnFactCount: turnFacts.length,
    hasHeldReport: held !== null,
    reportsSinceTurnStart: input.reportsSinceTurnStart.length,
  });

  if (!turn.handler.requiresChangedFileReporting) {
    return { status: 'skipped', reason: 'not-coding-turn' };
  }

  if (turnFacts.length === 0) {
    logger.info('local.run.turn_implement_reports.skipped', {
      runId: run.runId,
      turnId: turn.turnId,
      promptType,
      reason: 'no-files-changed',
      discardedHeldReport: held !== null,
    });
    return { status: 'skipped', reason: 'no-files-changed' };
  }

  const factsByService = new Map<string, Array<{ fact: CanonicalFileChangeFact; index: number }>>();
  for (const entry of turnFacts) {
    const serviceFacts = factsByService.get(entry.fact.serviceId) ?? [];
    serviceFacts.push(entry);
    factsByService.set(entry.fact.serviceId, serviceFacts);
  }
  const editedPathsByService = new Map(
    [...factsByService.entries()].map(([serviceId, entries]) => [
      serviceId,
      new Set(entries.map(({ fact }) => fact.repoRelativePath)),
    ]),
  );

  const emitted = emittedServiceIds(input.reportsSinceTurnStart);
  const pendingServiceIds = [...factsByService.keys()]
    .filter((serviceId) => !emitted.has(serviceId))
    .sort();
  if (pendingServiceIds.length === 0) {
    logger.info('local.run.turn_implement_reports.skipped', {
      runId: run.runId,
      turnId: turn.turnId,
      promptType,
      reason: 'already-emitted',
      serviceIds: [...factsByService.keys()].sort(),
    });
    return { status: 'skipped', reason: 'already-emitted' };
  }

  if (input.createReportTool === null) {
    logger.error('local.run.turn_implement_reports.create_report_tool_missing', {
      runId: run.runId,
      turnId: turn.turnId,
      promptType,
      serviceIds: pendingServiceIds,
    });
    return { status: 'skipped', reason: 'missing-create-report-tool' };
  }

  const decisions = held?.decisions ?? [];
  const unplacedDecisionFiles = decisions
    .map((decision) => decision.location?.file)
    .filter(
      (file): file is string =>
        file !== undefined && ![...editedPathsByService.values()].some((paths) => paths.has(file)),
    );
  if (unplacedDecisionFiles.length > 0) {
    logger.warn('local.run.turn_implement_reports.decision_location_dropped', {
      runId: run.runId,
      turnId: turn.turnId,
      files: unplacedDecisionFiles,
    });
  }

  const serviceRoots = new Map(
    resolveRunServiceRoots(run.session).map((entry) => [entry.serviceId, entry.root]),
  );
  const reports: ServiceImplementReport[] = [];
  const failedServiceIds: string[] = [];

  for (const serviceId of pendingServiceIds) {
    const serviceFacts = factsByService.get(serviceId)!;
    const builder = new ServiceEditBuilder(
      run,
      logger,
      facts,
      serviceId,
      serviceRoots.get(serviceId) ?? null,
      input.capturedVersions,
    );
    let edits: ImplementReportEdit[] = [];
    for (const { fact, index } of serviceFacts) {
      edits.push(await builder.build(fact, index));
    }

    const anchorRoot = serviceFacts[0]!.fact.executionRoot ?? serviceRoots.get(serviceId) ?? null;
    if (anchorRoot !== null) {
      try {
        await anchorBlobs(
          anchorRoot,
          run.runId,
          `Hey Hey run ${run.runId} turn ${turn.turnId}`,
          builder.anchoredObjectIds,
        );
      } catch (error) {
        logger.warn('local.run.turn_implement_reports.anchor_failed', {
          runId: run.runId,
          serviceId,
          paths: [...editedPathsByService.get(serviceId)!].sort(),
          error: errorMessage(error),
        });
        edits = edits.map((edit) => ({
          ...edit,
          beforeObjectId: null,
          afterObjectId: null,
          beforeRanges: [],
          afterRanges: [],
          approximate: true,
          versionsRecorded: false,
        }));
      }
    }

    // Stable sort keeps recording order for edits with the same time.
    edits.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const filesChanged = [...new Set(edits.map((edit) => edit.path))].sort();
    const payload: ImplementReportPayload = {
      reportType: ReportType.Implement,
      summary: held?.summary ?? defaultSummary(promptType),
      filesChanged,
      edits,
      decisions: decisionsForService(decisions, serviceId, editedPathsByService),
    };
    const entities = [
      ...(run.taskId !== null
        ? [{ entityType: 'TASK', entityId: run.taskId, relation: 'PRIMARY' as const }]
        : []),
      {
        entityType: 'AGENT_SESSION',
        entityId: run.session.agentic_session_id,
        relation: 'CONTEXT' as const,
      },
      { entityType: 'SERVICE', entityId: serviceId, relation: 'CONTEXT' as const },
    ];

    logger.info('local.run.turn_implement_reports.emit.start', {
      runId: run.runId,
      turnId: turn.turnId,
      promptType,
      serviceId,
      filesChanged,
      editCount: edits.length,
      approximateEditCount: edits.filter((edit) => edit.approximate).length,
    });

    // One Service's failed write must not cost the other Services their reports.
    try {
      await input.createReportTool.persistImplementReport({
        run,
        serviceId,
        args: {
          reportType: ReportType.Implement,
          audience: 'PROJECT_VISIBLE',
          payload,
          entities,
        },
      });
    } catch (error) {
      logger.error('local.run.turn_implement_reports.emit.failed', {
        runId: run.runId,
        turnId: turn.turnId,
        promptType,
        serviceId,
        filesChanged,
        error: errorMessage(error),
      });
      failedServiceIds.push(serviceId);
      continue;
    }

    logger.info('local.run.turn_implement_reports.emit.succeeded', {
      runId: run.runId,
      turnId: turn.turnId,
      serviceId,
    });
    reports.push({ serviceId, edits });
  }

  return { status: 'emitted', reports, failedServiceIds };
};
