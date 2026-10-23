import type {
  TaskMonitorCoordinatorCorrection,
  TaskMonitorCoordinatorValidationFailure,
} from '../../shared/agent-bridge-contract/generated/api';

const MAX_COORDINATOR_CORRECTIONS = 2;
export const coordinatorValidationRecovery = (
  correctionAttempts: number,
  failure: TaskMonitorCoordinatorValidationFailure,
):
  | { kind: 'CORRECT'; correction: TaskMonitorCoordinatorCorrection }
  | { kind: 'REQUEST_JUDGMENT'; failure: TaskMonitorCoordinatorValidationFailure } =>
  correctionAttempts < MAX_COORDINATOR_CORRECTIONS
    ? {
        kind: 'CORRECT',
        correction: { attempt: correctionAttempts + 1, validationFailure: failure },
      }
    : { kind: 'REQUEST_JUDGMENT', failure };

export const COORDINATOR_RECOVERY_GUIDANCE =
  'The selected work has not advanced. The coordinator could not produce a valid decision automatically. Please provide guidance to reassess the work, or stop the monitor. You do not need to repair the output format. Rejected output has not been applied.';
