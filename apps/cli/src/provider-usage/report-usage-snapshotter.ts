import {
  ReportUsageCacheAvailability,
  ReportUsageCoverage,
  ReportUsageBreakdownEntryRoleEnum,
  type ReportUsageBreakdownEntry,
  type ReportUsageFigures,
  type ReportUsageMeasurement,
} from '../shared/api';
import type { Run } from '../run/run';
import { NOOP_LOGGER, type ServerLogger } from '../server/logger';
import type { SubAgentUsage } from '../run/subagent';
import { SessionTokenUsageReader } from './session-token-usage';
import {
  reportUsageExecutions,
  ReportUsageExecutions,
  type ReportUsageExecution,
} from './report-usage-executions';

function figures(usage: SubAgentUsage): ReportUsageFigures {
  const freshInputTokens = usage.inputTokens ?? null;
  const cacheReadInputTokens = usage.cacheReadInputTokens ?? null;
  const cacheCreationInputTokens = usage.cacheCreationInputTokens ?? null;
  const inputTokens =
    usage.cacheInclusiveInputTokens ??
    (freshInputTokens !== null && cacheReadInputTokens !== null && cacheCreationInputTokens !== null
      ? freshInputTokens + cacheReadInputTokens + cacheCreationInputTokens
      : null);
  const outputTokens = usage.outputTokens ?? null;
  const toolCalls = usage.toolCalls ?? null;
  const reported = [
    inputTokens,
    freshInputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    outputTokens,
    toolCalls,
  ];
  return {
    inputTokens,
    freshInputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    outputTokens,
    toolCalls,
    cacheAvailability:
      cacheReadInputTokens !== null && cacheCreationInputTokens !== null
        ? ReportUsageCacheAvailability.Reported
        : ReportUsageCacheAvailability.Unreported,
    coverage: reported.every((value) => value !== null)
      ? ReportUsageCoverage.Complete
      : reported.some((value) => value !== null)
        ? ReportUsageCoverage.Partial
        : ReportUsageCoverage.Unavailable,
  };
}

const numericFields = [
  'inputTokens',
  'freshInputTokens',
  'cacheReadInputTokens',
  'cacheCreationInputTokens',
  'outputTokens',
  'toolCalls',
] as const;

/** Copies cumulative measurements once. Never waits for completion or mutates persisted reports. */
export class ReportUsageSnapshotter {
  public constructor(
    private readonly reader = new SessionTokenUsageReader(),
    private readonly executions: ReportUsageExecutions = reportUsageExecutions,
    private readonly logger: ServerLogger = NOOP_LOGGER,
  ) {}

  public async capture(
    run: Run,
    capturedAt: string,
    executionId?: string,
  ): Promise<ReportUsageMeasurement> {
    const child = executionId
      ? this.executions.get(executionId)
      : run.activeTurn?.handler.runnerKind === 'subagent'
        ? this.executions.forTurn(run.runId, run.activeTurn.turnId)
        : undefined;
    if (!child && run.activeTurn?.handler.runnerKind === 'subagent') {
      throw new Error('Reporting child execution is unavailable.');
    }
    if (executionId && (!child || child.runId !== run.runId)) {
      throw new Error('Report usage execution does not belong to this Run.');
    }
    const provider = child ? child.provider : (run.session.provider ?? null);
    const nativeId = child ? child.providerSessionId : run.session.provider_session_id;
    const providerSessionId = nativeId && !nativeId.startsWith('pending_') ? nativeId : null;
    const sourceId = child ? child.executionId : (providerSessionId ?? run.runId);
    const model = child
      ? child.model
      : (run.activeTurn?.effectiveModel ?? run.session.model ?? null);
    const effort = child ? child.effort : (run.activeTurn?.effectiveReasoningEffort ?? null);
    const toolCalls = child ? null : await run.readReportUsageToolCalls(providerSessionId);
    const parentUsage = child
      ? await this.readChild(child)
      : {
          ...(await this.reader.read(provider ?? '', providerSessionId)),
          ...(toolCalls !== null ? { toolCalls } : {}),
        };
    const parent: ReportUsageBreakdownEntry = {
      ...figures(parentUsage),
      executionId: sourceId,
      providerSessionId,
      provider,
      model,
      effort,
      role:
        child?.role === 'reviewer'
          ? ReportUsageBreakdownEntryRoleEnum.Reviewer
          : child
            ? ReportUsageBreakdownEntryRoleEnum.Subagent
            : ReportUsageBreakdownEntryRoleEnum.Parent,
      label: child?.label ?? 'Parent',
    };
    const breakdown = [parent];
    // A child report measures that child only. Parent reports include separately launched
    // research children, never reviewer executions. Native session records are selected by
    // exact session identity, not a family roll-up.
    if (!child) {
      const seen = new Set([providerSessionId ?? sourceId]);
      for (const entry of this.executions.children(run.runId, providerSessionId)) {
        const identity = entry.providerSessionId ?? entry.executionId;
        if (seen.has(identity)) {
          continue;
        }
        seen.add(identity);
        breakdown.push({
          ...figures(await this.readChild(entry)),
          executionId: entry.executionId,
          providerSessionId: entry.providerSessionId,
          provider: entry.provider,
          model: entry.model,
          effort: entry.effort,
          role: ReportUsageBreakdownEntryRoleEnum.Subagent,
          label: entry.label,
        });
      }
    }
    const totals = { ...figures({}) };
    for (const field of numericFields) {
      const values = breakdown.map((entry) => entry[field]);
      totals[field] = values.every((value) => value !== null)
        ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
        : null;
    }
    totals.cacheAvailability = breakdown.every(
      (entry) => entry.cacheAvailability === ReportUsageCacheAvailability.Reported,
    )
      ? ReportUsageCacheAvailability.Reported
      : ReportUsageCacheAvailability.Unreported;
    totals.coverage = breakdown.every((entry) => entry.coverage === ReportUsageCoverage.Complete)
      ? ReportUsageCoverage.Complete
      : breakdown.every((entry) => entry.coverage === ReportUsageCoverage.Unavailable)
        ? ReportUsageCoverage.Unavailable
        : ReportUsageCoverage.Partial;
    return {
      ...totals,
      schemaVersion: 1,
      runId: run.runId,
      agentSessionId: run.session.agentic_session_id,
      turnId: child?.turnId ?? run.activeTurn?.turnId ?? null,
      executionId: sourceId,
      providerSessionId,
      provider,
      model,
      effort,
      capturedAt,
      breakdown,
    };
  }

  private async readChild(child: ReportUsageExecution): Promise<SubAgentUsage> {
    if (child.completed) {
      return { ...child.usage };
    }
    try {
      return {
        ...(await this.reader.read(child.provider ?? '', child.providerSessionId)),
        ...child.usage,
      };
    } catch (error) {
      this.logger.warn('report.usage.child_unavailable', {
        runId: child.runId,
        executionId: child.executionId,
        error,
      });
      // This child remains visible as partial/unavailable; unrelated entries remain usable.
      return { ...child.usage };
    }
  }
}
