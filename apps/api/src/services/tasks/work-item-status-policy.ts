export function formatWorkItemStatusNotAllowedMessage(
  status: string,
  typeKey: string,
  allowedStatuses: readonly string[],
): string {
  return `Status ${status} is not allowed for ${typeKey} (allowed: ${allowedStatuses.join(', ')}).`;
}
