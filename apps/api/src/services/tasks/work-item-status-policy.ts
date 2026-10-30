export function formatWorkItemStatusNotAllowedMessage(
  status: string,
  typeKey: string,
  allowedStatuses: readonly string[],
): string {
  return `Status ${status} is not allowed for ${typeKey} (allowed: ${allowedStatuses.join(', ')}).`;
}
import { WorkStatus } from '../../generated/model/workStatus';

export function isOrdinaryStatusAssignmentAllowed(
  status: string,
  allowedStatuses: readonly string[],
): boolean {
  return status !== WorkStatus.Superseded && allowedStatuses.includes(status);
}
