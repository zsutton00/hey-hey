import {
  LocalPromptType,
  LocalReasoningEffort,
  LocalRunProvider,
} from '../../../shared/agent-bridge-contract/contract';
import { SessionMethod } from '../../../shared/agent-bridge-contract/generated';
import {
  ReportType,
  type ReportType as CanonicalReportType,
} from '../../../shared/api/generated/api';
import type { CanonicalMonitorEvent } from '../normalizer';
import { EveryEventGate } from '../rules/gate';
import { sessionMonitorSubscribe } from '../rules/subscribe';
import type { Monitor, MonitorGate } from './types';

export const SESSION_MONITOR_REPORT_TYPE_SUBSCRIPTION: readonly CanonicalReportType[] =
  Object.freeze([
    ReportType.Plan,
    ReportType.FeatureSyncDecision,
    ReportType.FeatureSyncHandoff,
    ReportType.DecisionNeeded,
  ]);

export const SESSION_MONITOR_RUN_CONFIG = Object.freeze({
  provider: LocalRunProvider.Codex,
  model: 'gpt-5.6-luna',
  reasoningEffort: LocalReasoningEffort.Xhigh,
  method: SessionMethod.Quick,
});

/**
 * Exclusive Session Monitor declaration for canonical settled-Turn liveness.
 * Report emissions are observed separately and never trigger evaluation.
 */
export class SessionMonitor implements Monitor {
  public readonly id = 'session-monitor';
  public readonly route = LocalPromptType.SessionMonitor;
  public readonly gate: MonitorGate = new EveryEventGate();
  public readonly reportTypeSubscription = SESSION_MONITOR_REPORT_TYPE_SUBSCRIPTION;
  public readonly runConfig = SESSION_MONITOR_RUN_CONFIG;
  public subscribes(event: CanonicalMonitorEvent): boolean {
    return sessionMonitorSubscribe(event);
  }

  public admits(_event: CanonicalMonitorEvent): Promise<boolean> {
    return Promise.resolve(true);
  }
}
