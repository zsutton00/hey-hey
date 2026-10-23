import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkItemReferenceDto } from "../../../api";
import {
  buildFeatureHierarchy,
  getFeatureFromHierarchy,
  resolveFeatureAncestry,
  useFeatureHierarchy,
  useFeatureLookup,
} from "../useFeatureHierarchy";

const { useReferences } = vi.hoisted(() => ({ useReferences: vi.fn() }));
vi.mock("../useWorkItemReferences", () => ({
  useWorkItemReferences: useReferences,
}));

const reference = (
  id: string,
  name: string,
  parentTaskId: string | null = null
): WorkItemReferenceDto => ({ id, name, parentTaskId, type: "FEATURE" });

describe("reference-backed feature hierarchy", () => {
  it("retains more than 500 references and resolves a nested selection to its root", () => {
    const references = [
      reference("root", "Root"),
      ...Array.from({ length: 700 }, (_, i) =>
        reference(`child-${i}`, `Child ${String(i).padStart(3, "0")}`, "root")
      ),
    ];
    references.push(reference("nested", "Nested", "child-699"));
    const hierarchy = buildFeatureHierarchy(references.reverse());
    expect(hierarchy.nodes.size).toBe(702);
    expect(hierarchy.roots[0].children).toHaveLength(700);
    expect(hierarchy.roots[0].children[0].feature.id).toBe("child-0");
    expect(hierarchy.resolveRoot("nested")?.feature.id).toBe("root");
    expect(hierarchy.resolveRoot("missing")).toBeNull();
  });

  it("uses stable alphabetical order and treats an absent feature parent as a root boundary", () => {
    const hierarchy = buildFeatureHierarchy([
      reference("z", "zebra"),
      reference("b", "Alpha", "non-feature-parent"),
      reference("a", "alpha"),
      reference("child", "Child", "b"),
    ]);
    expect(hierarchy.roots.map((node) => node.feature.id)).toEqual([
      "a",
      "b",
      "z",
    ]);
    expect(hierarchy.resolveRoot("child")?.feature.id).toBe("b");
  });

  it("rejects cycles instead of reporting an incomplete hierarchy as complete", () => {
    expect(() =>
      buildFeatureHierarchy([
        reference("a", "A", "b"),
        reference("b", "B", "a"),
      ])
    ).toThrow("parent cycle");
  });

  it("shares the scoped reference hook and reflects authoritative reparenting", () => {
    useReferences.mockReturnValue({
      status: "ready",
      isFetching: false,
      references: [
        reference("a", "A"),
        reference("b", "B"),
        reference("child", "Child", "a"),
      ],
    });
    const { result, rerender } = renderHook(() =>
      useFeatureHierarchy("org", "project")
    );
    expect(useReferences).toHaveBeenCalledWith({
      organizationId: "org",
      projectId: "project",
      workItemType: "FEATURE",
    });
    expect(result.current.resolveRoot("child")?.feature.id).toBe("a");
    useReferences.mockReturnValue({
      status: "updating",
      isFetching: true,
      references: [
        reference("a", "A"),
        reference("b", "B"),
        reference("child", "Child", "b"),
      ],
    });
    rerender();
    expect(result.current.resolveRoot("child")?.feature.id).toBe("b");
    expect(result.current.isLoading).toBe(false);
  });
});

describe("cached feature lookup", () => {
  it.each(["loading", "disabled", "empty", "error"])(
    "keeps lookup identity stable across fresh empty arrays in %s states",
    (status) => {
      useReferences.mockImplementation(() => ({
        status,
        isFetching: status === "loading",
        references: [],
        error: status === "error" ? new Error("Unavailable") : undefined,
      }));
      const { result, rerender } = renderHook(() =>
        useFeatureLookup("org", "project")
      );
      const lookup = result.current;
      rerender();
      expect(result.current).toBe(lookup);
      expect(result.current.get("missing")).toBeUndefined();
    }
  );

  const { nodes } = buildFeatureHierarchy([
    reference("root", "Root"),
    reference("mid", "Mid", "root"),
    reference("leaf", "Leaf", "mid"),
    reference("orphan", "Orphan", "non-feature-parent"),
  ]);

  it("returns name and parent for features and misses for anything else", () => {
    expect(getFeatureFromHierarchy(nodes, "mid")).toEqual({
      id: "mid",
      name: "Mid",
      parentTaskId: "root",
    });
    expect(getFeatureFromHierarchy(nodes, "unknown")).toBeUndefined();
  });

  it("resolves structural ancestry root-first", () => {
    expect(resolveFeatureAncestry(nodes, "leaf")).toEqual({
      ancestors: [
        { id: "root", name: "Root" },
        { id: "mid", name: "Mid" },
        { id: "leaf", name: "Leaf" },
      ],
      complete: true,
    });
    expect(resolveFeatureAncestry(nodes, null)).toEqual({
      ancestors: [],
      complete: true,
    });
  });

  it("reports incomplete ancestry when the walk leaves the cached hierarchy", () => {
    expect(resolveFeatureAncestry(nodes, "orphan").complete).toBe(false);
    expect(resolveFeatureAncestry(nodes, "created-after-load")).toEqual({
      ancestors: [],
      complete: false,
    });
  });

  it("derives from the shared reference read and reports readiness", () => {
    useReferences.mockReturnValue({
      status: "loading",
      isFetching: true,
      references: [],
    });
    const { result, rerender } = renderHook(() =>
      useFeatureLookup("org", "project")
    );
    expect(result.current.isReady).toBe(false);
    expect(result.current.isLoading).toBe(true);
    useReferences.mockReturnValue({
      status: "ready",
      isFetching: false,
      references: [reference("root", "Root"), reference("a", "A", "root")],
    });
    rerender();
    expect(result.current.isReady).toBe(true);
    expect(result.current.get("a")?.name).toBe("A");
    expect(result.current.resolveAncestry("a").ancestors).toEqual([
      { id: "root", name: "Root" },
      { id: "a", name: "A" },
    ]);
  });
});
