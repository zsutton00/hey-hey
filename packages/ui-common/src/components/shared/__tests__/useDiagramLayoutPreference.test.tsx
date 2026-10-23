import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  diagramLayoutPreferenceKey,
  useDiagramLayoutPreference,
} from "../useDiagramLayoutPreference";

const scope = {
  organizationId: "org",
  projectId: "project",
  diagramId: "journey",
};

beforeEach(() => {
  localStorage.clear();
});

describe("diagram layout preferences", () => {
  it("cancels preview intent without forgetting the explicit choice", () => {
    const first = renderHook(() => useDiagramLayoutPreference(scope));
    act(() => first.result.current.onCandidateChange("elk-layered"));
    act(() => first.result.current.onDirectionChange("DOWN"));
    act(() => first.result.current.onPreviewCancel());
    expect(first.result.current.previewRequested).toBe(false);
    expect(first.result.current.candidate).toBe("elk-layered");
    expect(first.result.current.automaticCandidate).toBe("dagre");
    first.unmount();
    const reopened = renderHook(() => useDiagramLayoutPreference(scope));
    expect(reopened.result.current.automaticCandidate).toBe("elk-layered");
    expect(reopened.result.current.automaticDirection).toBe("DOWN");
    expect(reopened.result.current.previewRequested).toBe(false);
  });
  it("defaults to Flow and remembers explicit layout and direction choices after remount", () => {
    const first = renderHook(() => useDiagramLayoutPreference(scope));
    expect(first.result.current.candidate).toBe("dagre");
    expect(first.result.current.previewRequested).toBe(false);
    act(() => first.result.current.onCandidateChange("elk-layered"));
    act(() => first.result.current.onDirectionChange("DOWN"));
    expect(first.result.current.previewRequested).toBe(true);
    expect(
      JSON.parse(localStorage.getItem(diagramLayoutPreferenceKey(scope))!),
    ).toEqual({ candidate: "elk-layered", direction: "DOWN" });
    first.unmount();
    const reopened = renderHook(() => useDiagramLayoutPreference(scope));
    expect(reopened.result.current.candidate).toBe("elk-layered");
    expect(reopened.result.current.direction).toBe("DOWN");
    expect(reopened.result.current.previewRequested).toBe(false);
  });

  it("isolates diagrams and projects during navigation without overwriting either preference", () => {
    const other = { ...scope, diagramId: "architecture" };
    localStorage.setItem(
      diagramLayoutPreferenceKey(other),
      JSON.stringify({ candidate: "elk-stress", direction: "RIGHT" }),
    );
    const { result, rerender } = renderHook(
      (value) => useDiagramLayoutPreference(value),
      { initialProps: scope },
    );
    act(() => result.current.onCandidateChange("elk-layered"));
    rerender(other);
    expect(result.current.candidate).toBe("elk-stress");
    expect(result.current.previewRequested).toBe(false);
    rerender(scope);
    expect(result.current.candidate).toBe("elk-layered");
    expect(result.current.previewRequested).toBe(false);
    rerender(other);
    act(() => result.current.onDirectionChange("DOWN"));
    rerender(scope);
    expect(result.current.candidate).toBe("elk-layered");
    expect(result.current.direction).toBe("RIGHT");
    rerender({ ...scope, projectId: "other-project" });
    expect(result.current.candidate).toBe("dagre");
    rerender({ ...scope, organizationId: "other-organization" });
    expect(result.current.candidate).toBe("dagre");
    expect(result.current.previewRequested).toBe(false);
    expect(
      JSON.parse(localStorage.getItem(diagramLayoutPreferenceKey(other))!),
    ).toEqual({ candidate: "elk-stress", direction: "DOWN" });
  });

  it.each([
    '{"candidate":"current","direction":"DOWN"}',
    "broken json",
    "null",
    '{"candidate":"unknown","direction":"RIGHT"}',
    '{"candidate":"dagre","direction":"diagonal"}',
  ])("uses the default for invalid stored preferences: %s", (raw) => {
    localStorage.setItem(diagramLayoutPreferenceKey(scope), raw);
    const { result } = renderHook(() => useDiagramLayoutPreference(scope));
    expect(result.current.candidate).toBe("dagre");
    expect(result.current.direction).toBe("RIGHT");
  });

  it("keeps controls usable if localStorage cannot be accessed", () => {
    const read = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("Unavailable");
      });
    const write = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("Quota");
      });
    try {
      const { result } = renderHook(() => useDiagramLayoutPreference(scope));
      act(() => result.current.onCandidateChange("elk-stress"));
      expect(result.current.candidate).toBe("elk-stress");
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });
});
