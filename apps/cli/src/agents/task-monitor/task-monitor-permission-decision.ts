import type {
  LocalTaskMonitorCoordinatorDecision,
  TaskMonitorLifecycleCause,
} from '@hey-hey/contracts/agent-bridge';

export type TaskMonitorPermissionDecision = Extract<
  LocalTaskMonitorCoordinatorDecision,
  { action: 'APPROVE_PERMISSION' | 'DENY_PERMISSION' | 'ESCALATE_PERMISSION' }
>;

/** Every decision that judges a settled Run or lifecycle moment, never a permission request. */
export type TaskMonitorCoordinationDecision = Exclude<
  LocalTaskMonitorCoordinatorDecision,
  TaskMonitorPermissionDecision
>;

export const isTaskMonitorPermissionDecision = (
  decision: LocalTaskMonitorCoordinatorDecision,
): decision is TaskMonitorPermissionDecision =>
  decision.action === 'APPROVE_PERMISSION' ||
  decision.action === 'DENY_PERMISSION' ||
  decision.action === 'ESCALATE_PERMISSION';

/** A permission trigger accepts only permission decisions; every other trigger accepts none of them. */
export const decisionActionAllowedForCause = (
  cause: TaskMonitorLifecycleCause,
  action: LocalTaskMonitorCoordinatorDecision['action'],
): boolean => {
  const permissionAction =
    action === 'APPROVE_PERMISSION' ||
    action === 'DENY_PERMISSION' ||
    action === 'ESCALATE_PERMISSION';
  return cause === 'PERMISSION_REQUEST' ? permissionAction : !permissionAction;
};
