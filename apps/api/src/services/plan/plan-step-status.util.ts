import { AdrStatus, WorkStatus } from '../../generated';

export type PlanStepStatusValue =
  | 'NOT_STARTED'
  | 'READY'
  | 'REFINING'
  | 'IN_PROGRESS'
  | 'VERIFYING'
  | 'BLOCKED'
  | 'SKIPPED'
  | 'COMPLETE';

export function isPreExecutionStepStatus(status: string): boolean {
  return (
    status === 'NOT_STARTED' || status === 'READY' || status === 'REFINING'
  );
}

export function isTerminalStepStatus(status: string): boolean {
  return status === 'COMPLETE' || status === 'SKIPPED';
}

export function getInitialStepStatusForType(
  stepType: string,
): PlanStepStatusValue {
  if (stepType === 'TASK' || stepType === 'DESIGN_DOC') {
    return 'REFINING';
  }
  return 'NOT_STARTED';
}

export function mapTaskStatusToPlanStepStatus(
  status: WorkStatus,
): PlanStepStatusValue {
  switch (status) {
    case WorkStatus.Generated:
    case WorkStatus.RefiningDescription:
    case WorkStatus.RefiningDetails:
    case WorkStatus.RefiningAcceptanceCriteria:
    case WorkStatus.GeneratingDescription:
    case WorkStatus.GeneratingDetails:
    case WorkStatus.GeneratingDescriptionAndDetails:
    case WorkStatus.GeneratingAcceptanceCriteria:
    case WorkStatus.GeneratingAll:
    case WorkStatus.Refining:
      return 'REFINING';
    case WorkStatus.Backlog:
    case WorkStatus.Archived:
      return 'NOT_STARTED';
    case WorkStatus.Ready:
      return 'READY';
    case WorkStatus.Cancelled:
      return 'SKIPPED';
    case WorkStatus.Active:
    case WorkStatus.OnHold:
      return 'IN_PROGRESS';
    case WorkStatus.Verifying:
      return 'VERIFYING';
    case WorkStatus.Blocked:
      return 'BLOCKED';
    case WorkStatus.Completed:
      return 'COMPLETE';
    default:
      throw new Error(
        `Unsupported task status for plan step mapping: ${status}`,
      );
  }
}

export function mapDesignDocStatusToPlanStepStatus(
  status: AdrStatus,
): PlanStepStatusValue {
  switch (status) {
    case AdrStatus.AdrContext:
    case AdrStatus.AdrRefiningContext:
    case AdrStatus.AdrDecision:
    case AdrStatus.AdrGeneratingDecision:
    case AdrStatus.AdrRefiningDecision:
    case AdrStatus.AdrConsequences:
    case AdrStatus.AdrGeneratingConsequences:
    case AdrStatus.AdrRefiningConsequences:
    case AdrStatus.RefiningContent:
    case AdrStatus.InReview:
      return 'REFINING';
    case AdrStatus.Ready:
      return 'COMPLETE';
    default:
      throw new Error(
        `Unsupported design doc status for plan step mapping: ${status}`,
      );
  }
}
