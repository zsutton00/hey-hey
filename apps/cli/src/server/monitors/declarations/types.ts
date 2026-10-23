import type { LocalPromptType } from '../../../shared/agent-bridge-contract/generated';
import type { CanonicalMonitorEvent } from '../normalizer';

interface MonitorGateAcceptResult {
  fired: boolean;
  batch: readonly CanonicalMonitorEvent[];
}

interface MonitorGateState {
  /** Events currently accumulated toward the next fire. */
  pending: number;
  /** Fire threshold, or null for gates that fire on every event. */
  threshold: number | null;
}

export interface MonitorGate {
  accept(event: CanonicalMonitorEvent): MonitorGateAcceptResult;
  /** Read-only accumulation state, surfaced by the pipeline's /debug snapshot. */
  inspect(): MonitorGateState;
}

/** Real polymorphic contract implemented by each production monitor. */
export interface Monitor {
  readonly id: string;
  readonly gate: MonitorGate;
  readonly route: LocalPromptType;
  subscribes(event: CanonicalMonitorEvent): boolean;
  admits(event: CanonicalMonitorEvent): Promise<boolean>;
}
