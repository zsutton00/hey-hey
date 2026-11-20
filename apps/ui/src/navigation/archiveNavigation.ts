import {
  matchPath,
  type Location,
  type NavigationType,
} from "react-router-dom";

const itemRoutes = [
  "/projects/:projectId/tasks/:itemId/*",
  "/projects/:projectId/features/:itemId/*",
  "/projects/:projectId/initiatives/:initiativeId/tasks/:itemId/*",
  "/tasks/:itemId/*",
  "/work-items/:itemId/*",
  // Step pages show the task; stage pages still show the owning Plan.
  "/projects/:projectId/plans/:planId/stages/:stageId/steps/:itemId/*",
  "/projects/:projectId/plans/:itemId/*",
];

export function workItemId(pathname: string): string | undefined {
  for (const path of itemRoutes) {
    const match = matchPath(path, pathname);
    if (match) {
      return match.params.itemId;
    }
  }
}

type Entry = { key: string; url: string; previous?: string };
type HistoryState = { current?: string; entries: Entry[] };

function isHistoryState(value: unknown): value is HistoryState {
  if (
    !value ||
    typeof value !== "object" ||
    !("entries" in value) ||
    !Array.isArray(value.entries)
  ) {
    return false;
  }
  if ("current" in value && typeof value.current !== "string") {
    return false;
  }
  return value.entries.every((entry: unknown) => {
    return (
      !!entry &&
      typeof entry === "object" &&
      "key" in entry &&
      typeof entry.key === "string" &&
      "url" in entry &&
      typeof entry.url === "string" &&
      (!("previous" in entry) || typeof entry.previous === "string")
    );
  });
}

export function parseArchiveHistory(saved: string | null): ArchiveHistory {
  if (!saved) {
    return new ArchiveHistory();
  }
  const value: unknown = JSON.parse(saved);
  if (!isHistoryState(value)) {
    throw new Error(
      "INVALID_ARCHIVE_HISTORY: saved history has an invalid shape",
    );
  }
  return new ArchiveHistory(value);
}

// Browser history exposes keys, not prior URLs. Remember only entries observed
// by this app; unknown POP destinations deliberately discard predecessor evidence.
export class ArchiveHistory {
  private state: HistoryState;

  constructor(saved: HistoryState = { entries: [] }) {
    this.state = saved;
  }

  record(location: Location, action: NavigationType): void {
    if (this.state.current === location.key) {
      const current = this.state.entries.find(
        (entry) => entry.key === location.key,
      );
      if (current) {
        current.url = location.pathname + location.search + location.hash;
      }
      return;
    }
    const current = this.state.entries.find(
      (entry) => entry.key === this.state.current,
    );
    const known = this.state.entries.find(
      (entry) => entry.key === location.key,
    );
    const previous =
      action === "PUSH"
        ? current?.key
        : action === "REPLACE"
          ? current?.previous
          : known?.previous;
    if (action === "REPLACE" && current) {
      for (const entry of this.state.entries) {
        if (entry.previous === current.key) {
          entry.previous = location.key;
        }
      }
    }
    this.state.entries = this.state.entries.filter(
      (entry) => entry.key !== location.key,
    );
    this.state.entries.push({
      key: location.key,
      url: location.pathname + location.search + location.hash,
      previous,
    });
    this.state.current = location.key;
  }

  previous(itemId: string): string | undefined {
    const current = this.state.entries.find(
      (entry) => entry.key === this.state.current,
    );
    const previous = this.state.entries.find(
      (entry) => entry.key === current?.previous,
    );
    if (
      !previous ||
      !previous.url.startsWith("/") ||
      previous.url.startsWith("//")
    ) {
      return;
    }
    const pathname = previous.url.split(/[?#]/)[0];
    if (workItemId(pathname) === itemId) {
      return;
    }
    return previous.url;
  }

  snapshot(): HistoryState {
    return this.state;
  }
}
