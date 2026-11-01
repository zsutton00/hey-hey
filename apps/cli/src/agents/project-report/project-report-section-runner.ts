import type { AgenticSession } from '../../session/types';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import {
  PROJECT_REPORT_SECTION_HANDLER_ID,
  type ProjectReportSectionPayload,
  type ProjectReportSectionShard,
} from './project-report-section.handler';
import type {
  ProjectReportEvidenceLedger,
  ProjectReportShardEntry,
} from './project-report-evidence-store';
import type { ProjectReportRequestProjection } from './project-report-request-reader';
import type { ProjectReportGroupKind } from './project-report-grouping';

/** Section children running at once; each holds its own provider session. */
const SECTION_CONCURRENCY = 4;
/** Graph reads a section child is told it may make; the host token budget is the hard stop. */
const SECTION_TOOL_CALL_BUDGET = 12;
/** Provider tokens a child may spend before it reads anything: prompt, tools and its answer. */
const SECTION_BASE_TOKEN_BUDGET = 300_000;
/** Provider tokens per shard byte: the text is read once and re-sent on every later turn. */
const SECTION_TOKENS_PER_SHARD_BYTE = 2;
/** Replacement children in a row that read nothing new before the parent takes the rest. */
const MAX_STALLED_REPLACEMENTS = 2;
const NO_FINDINGS = 'NONE';

interface ShardGroup {
  key: string;
  kind: ProjectReportGroupKind;
  title: string;
  shards: ProjectReportShardEntry[];
}

export interface ProjectReportSectionRunResult {
  /** Findings from every child, grouped by work group, for the parent to read. */
  findings: string;
  /** Shards no child managed to read; the parent reads these itself. */
  parentShardIds: string[];
}

/**
 * Reads every group's shards through one read-only child per group. Budget never
 * leaves data unread: a child that stops early is replaced by another over what
 * is left, and only a group that keeps stalling is handed to the parent.
 */
export class ProjectReportSectionRunner {
  private readonly controller = new AbortController();

  public constructor(
    private readonly run: AgenticSession,
    private readonly request: ProjectReportRequestProjection,
    private readonly ledger: ProjectReportEvidenceLedger,
    private readonly deps: PromptTypeHandlerDeps,
  ) {}

  public async runAll(): Promise<ProjectReportSectionRunResult> {
    const groups = this.groupsOf(this.ledger.manifest.shards);
    this.deps.logger.info('project_report.sections.started', {
      runId: this.run.agentic_session_id,
      groupCount: groups.length,
      shardCount: this.ledger.manifest.shards.length,
    });

    const queue = groups.map((group, index) => ({ group, index }));
    const sections: Array<{ index: number; group: ShardGroup; text: string }> = [];
    const worker = async (): Promise<void> => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        sections.push({
          index: item.index,
          group: item.group,
          text: await this.readGroup(item.group),
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(SECTION_CONCURRENCY, queue.length) }, worker));

    const findings = sections
      .sort((a, b) => a.index - b.index)
      .filter(({ text }) => text.length > 0 && text !== NO_FINDINGS)
      .map(({ group, text }) => `## ${group.title}\n\n${text}`)
      .join('\n\n');
    const parentShardIds = this.ledger.unreadShards().map((shard) => shard.id);

    this.deps.logger.info('project_report.sections.completed', {
      runId: this.run.agentic_session_id,
      groupCount: groups.length,
      parentShardCount: parentShardIds.length,
    });

    return { findings, parentShardIds };
  }

  /** The findings of one group, from as many children as it takes to read all its shards. */
  private async readGroup(group: ShardGroup): Promise<string> {
    const findings: string[] = [];
    let stalledReplacements = 0;

    for (let attempt = 1; ; attempt += 1) {
      const before = this.unreadPageCount(group);
      if (before === 0) {
        break;
      }

      findings.push(...(await this.launchChild(group, attempt)));
      const progressed = this.unreadPageCount(group) < before;

      if (attempt > 1 && !progressed) {
        stalledReplacements += 1;
      } else if (progressed) {
        stalledReplacements = 0;
      }
      if (stalledReplacements >= MAX_STALLED_REPLACEMENTS) {
        this.deps.logger.warn('project_report.section.handed_to_parent', {
          runId: this.run.agentic_session_id,
          groupKind: group.kind,
          unreadPages: this.unreadPageCount(group),
        });
        break;
      }
    }

    return findings.join('\n\n');
  }

  private async launchChild(group: ShardGroup, attempt: number): Promise<string[]> {
    const shards = this.unreadShardsOf(group);
    const bytes = shards.reduce((sum, shard) => sum + shard.byteSize, 0);
    const tokenBudget = SECTION_BASE_TOKEN_BUDGET + SECTION_TOKENS_PER_SHARD_BYTE * bytes;
    const payload: ProjectReportSectionPayload = {
      request: {
        question: this.request.submission.question,
        scope: this.request.submission.scope,
        exclusions: this.request.submission.exclusions,
      },
      group: { key: group.key, kind: group.kind, title: group.title },
      shards,
      toolCallBudget: SECTION_TOOL_CALL_BUDGET,
    };

    try {
      const result = await this.deps.childAgentLauncher.launchRegistered(
        PROJECT_REPORT_SECTION_HANDLER_ID,
        {
          parentSession: this.run,
          payload,
          signal: this.controller.signal,
          serviceIds: [],
          ...(this.run.model ? { model: this.run.model } : {}),
          ...(this.run.reasoningEffort ? { reasoningEffort: this.run.reasoningEffort } : {}),
          tokenBudget,
        },
      );
      this.deps.logger.info('project_report.section.completed', {
        runId: this.run.agentic_session_id,
        groupKind: group.kind,
        attempt,
        shardCount: shards.length,
        tokenBudget,
        budgetExhausted: result.budgetExhausted === true,
      });

      const text = (result.outputText ?? '').trim();
      return text.length > 0 ? [text] : [];
    } catch (error) {
      this.deps.logger.warn('project_report.section.failed', {
        runId: this.run.agentic_session_id,
        groupKind: group.kind,
        attempt,
        shardCount: shards.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private unreadShardsOf(group: ShardGroup): ProjectReportSectionShard[] {
    return group.shards
      .filter((shard) => this.ledger.unreadPages(shard).length > 0)
      .map((shard) => ({ ...shard, pagesToRead: this.ledger.unreadPages(shard) }));
  }

  private unreadPageCount(group: ShardGroup): number {
    return group.shards.reduce((sum, shard) => sum + this.ledger.unreadPages(shard).length, 0);
  }

  /** Groups in manifest order, which is the order of how much changed in them. */
  private groupsOf(shards: readonly ProjectReportShardEntry[]): ShardGroup[] {
    const groups = new Map<string, ShardGroup>();
    for (const shard of shards) {
      const group = groups.get(shard.groupKey) ?? {
        key: shard.groupKey,
        kind: shard.groupKind,
        title: shard.groupTitle,
        shards: [],
      };
      group.shards.push(shard);
      groups.set(shard.groupKey, group);
    }
    return [...groups.values()];
  }
}
