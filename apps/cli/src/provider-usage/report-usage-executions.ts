import { randomUUID } from 'node:crypto';
import type { SubAgentUsage } from '../run/subagent';

/** Host-owned identities; a child token selects one execution, never model-authored arguments. */
export interface ReportUsageExecution {
  executionId: string;
  runId: string;
  turnId: string | null;
  providerSessionId: string | null;
  parentProviderSessionId?: string | null;
  provider: string | null;
  model: string | null;
  effort: string | null;
  role: 'subagent' | 'reviewer';
  label: string;
  usage: SubAgentUsage;
  completed: boolean;
}

export class ReportUsageExecutions {
  private readonly records = new Map<string, ReportUsageExecution>();
  private readonly openRuns = new Set<string>();

  public open(runId: string): void {
    this.openRuns.add(runId);
  }

  public isOpen(runId: string): boolean {
    return this.openRuns.has(runId);
  }

  public start(
    input: Omit<ReportUsageExecution, 'executionId' | 'usage' | 'completed' | 'providerSessionId'>,
  ): ReportUsageExecution {
    const execution: ReportUsageExecution = {
      ...input,
      executionId: randomUUID(),
      providerSessionId: null,
      usage: {},
      completed: false,
    };
    this.records.set(execution.executionId, execution);
    return execution;
  }

  public get(executionId: string): ReportUsageExecution | undefined {
    return this.records.get(executionId);
  }

  public children(runId: string, parentProviderSessionId: string | null): ReportUsageExecution[] {
    return [...this.records.values()].filter(
      (entry) =>
        entry.runId === runId &&
        entry.role !== 'reviewer' &&
        (!entry.parentProviderSessionId ||
          entry.parentProviderSessionId === parentProviderSessionId),
    );
  }

  public forTurn(runId: string, turnId: string): ReportUsageExecution | undefined {
    return [...this.records.values()].find(
      (entry) => entry.runId === runId && entry.turnId === turnId,
    );
  }

  public release(runId: string): void {
    this.openRuns.delete(runId);
    for (const [id, entry] of this.records) {
      if (entry.runId === runId) {
        this.records.delete(id);
      }
    }
  }
}

export const reportUsageExecutions = new ReportUsageExecutions();
