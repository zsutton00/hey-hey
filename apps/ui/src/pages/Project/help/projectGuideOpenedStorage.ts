import { useSyncExternalStore } from "react";

const PROJECT_GUIDE_OPENED_EVENT = "heyhey:project-guide-opened";

const getStorageKey = (projectId: string): string =>
  `heyhey:help:first-project-opened:${projectId}`;

export function isProjectGuideOpened(projectId: string): boolean {
  return window.localStorage.getItem(getStorageKey(projectId)) === "true";
}

export function markProjectGuideOpened(projectId: string): void {
  window.localStorage.setItem(getStorageKey(projectId), "true");
  window.dispatchEvent(new Event(PROJECT_GUIDE_OPENED_EVENT));
}

function subscribeToProjectGuideOpened(onChange: () => void): () => void {
  window.addEventListener(PROJECT_GUIDE_OPENED_EVENT, onChange);
  window.addEventListener("storage", onChange);

  return () => {
    window.removeEventListener(PROJECT_GUIDE_OPENED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useProjectGuideOpened(projectId: string): boolean {
  const getSnapshot = (): boolean => isProjectGuideOpened(projectId);
  return useSyncExternalStore(
    subscribeToProjectGuideOpened,
    getSnapshot,
    getSnapshot,
  );
}
