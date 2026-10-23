import { useEffect, useMemo, useState } from "react";
import {
  DIAGRAM_LAYOUT_CANDIDATES,
  type DiagramLayoutCandidate,
  type DiagramLayoutDirection,
} from "./diagramLayoutCandidates";

interface DiagramScope {
  organizationId: string;
  projectId: string;
  diagramId: string;
}

interface LayoutPreference {
  candidate: DiagramLayoutCandidate;
  direction: DiagramLayoutDirection;
}

// Without a saved choice, use the first layout offered in the selector.
const DEFAULT_PREFERENCE: LayoutPreference = {
  candidate: DIAGRAM_LAYOUT_CANDIDATES[0].key,
  direction: "RIGHT",
};

export function diagramLayoutPreferenceKey(scope: DiagramScope): string {
  return `diagram-layout-preference:v1:${JSON.stringify([
    scope.organizationId,
    scope.projectId,
    scope.diagramId,
  ])}`;
}

function readPreference(key: string | undefined): LayoutPreference {
  if (!key) return DEFAULT_PREFERENCE;
  try {
    const raw = window.localStorage.getItem(key);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (
      typeof value !== "object" ||
      value === null ||
      !("candidate" in value) ||
      !("direction" in value)
    )
      return DEFAULT_PREFERENCE;
    const candidate = DIAGRAM_LAYOUT_CANDIDATES.find(
      (option) => option.key === value.candidate,
    )?.key;
    const direction = value.direction;
    return candidate && (direction === "RIGHT" || direction === "DOWN")
      ? { candidate, direction }
      : DEFAULT_PREFERENCE;
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

function writePreference(
  key: string | undefined,
  preference: LayoutPreference,
): void {
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(preference));
  } catch {
    // Storage may be unavailable. The selected layout still works in this view.
  }
}

export function useDiagramLayoutPreference(scope: DiagramScope | undefined) {
  const key = scope ? diagramLayoutPreferenceKey(scope) : undefined;
  const storedPreference = useMemo(() => readPreference(key), [key]);
  const [selection, setSelection] = useState<{
    key: string | undefined;
    preference: LayoutPreference;
    previewRequested: boolean;
  }>();
  useEffect(() => setSelection(undefined), [key]);
  // Key the in-memory choice too: navigating to a different diagram must not
  // display or persist the previous diagram's preference.
  const currentSelection = selection?.key === key ? selection : undefined;
  const preference = currentSelection?.preference ?? storedPreference;
  const select = (next: LayoutPreference) => {
    writePreference(key, next);
    setSelection({ key, preference: next, previewRequested: true });
  };
  return {
    ...preference,
    automaticCandidate: storedPreference.candidate,
    automaticDirection: storedPreference.direction,
    previewRequested: currentSelection?.previewRequested ?? false,
    onPreviewCancel: () =>
      setSelection({ key, preference, previewRequested: false }),
    onCandidateChange: (candidate: DiagramLayoutCandidate) =>
      select({ ...preference, candidate }),
    onDirectionChange: (direction: DiagramLayoutDirection) =>
      select({ ...preference, direction }),
  };
}
