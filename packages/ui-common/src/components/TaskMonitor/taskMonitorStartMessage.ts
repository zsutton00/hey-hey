const storage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const storageKey = (
  organizationId: string,
  projectId: string,
  monitorId: string
): string =>
  ["task-monitor-start-message", organizationId, projectId, monitorId].join(
    ":"
  );

export const writeTaskMonitorStartMessage = (
  organizationId: string,
  projectId: string,
  monitorId: string,
  userMessage: string
): void => {
  const value = userMessage.trim();
  const key = storageKey(organizationId, projectId, monitorId);
  try {
    if (value) storage()?.setItem(key, value);
    else storage()?.removeItem(key);
  } catch {
    // Message handoff is supplemental and must not block monitor creation.
  }
};

export const readTaskMonitorStartMessage = (
  organizationId: string,
  projectId: string,
  monitorId: string
): string | null => {
  try {
    return (
      storage()?.getItem(storageKey(organizationId, projectId, monitorId)) ??
      null
    );
  } catch {
    return null;
  }
};

export const clearTaskMonitorStartMessage = (
  organizationId: string,
  projectId: string,
  monitorId: string
): void => {
  try {
    storage()?.removeItem(storageKey(organizationId, projectId, monitorId));
  } catch {
    // The START command already succeeded; cleanup is best effort.
  }
};
