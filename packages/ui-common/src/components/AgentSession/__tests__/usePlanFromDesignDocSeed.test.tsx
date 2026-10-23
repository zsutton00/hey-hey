import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlanFromDesignDocSeed } from "../usePlanFromDesignDocSeed";

const mocks = vi.hoisted(() => ({
  documents: vi.fn(),
  relationships: vi.fn(),
  document: vi.fn(),
}));
vi.mock("../../../data/hooks/useDesignDocs", () => ({
  useDesignDocs: mocks.documents,
}));
vi.mock("../../../data/hooks/usePlanRelationships", () => ({
  usePlanRelationships: mocks.relationships,
}));
vi.mock("../../../data/hooks/useDesignDoc", () => ({
  useDesignDoc: mocks.document,
}));

describe("Plan generation design doc preview", () => {
  const list = (designDocs: { id: string; createdAt: string }[] = []) => ({
    designDocs,
    isFetched: true,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.documents.mockImplementation((_org, options) =>
      options.taskId
        ? list()
        : list([{ id: "legacy-doc", createdAt: "2026-09-01" }])
    );
    mocks.relationships.mockReturnValue({
      relationships: [{ entityType: "DESIGN_DOC", entityId: "legacy-doc" }],
      isLoading: false,
      error: null,
    });
    mocks.document.mockReturnValue({
      data: {
        name: "Seed",
        sections: [
          { key: "content", order: 0, materializedMarkdown: "Current design" },
        ],
      },
      isLoading: false,
      error: null,
    });
  });

  it("uses the latest document owned by the PLAN work item", () => {
    mocks.documents.mockReturnValue({
      designDocs: [
        { id: "older", createdAt: "2026-08-01" },
        { id: "newer", createdAt: "2026-09-01" },
      ],
      isFetched: true,
      isLoading: false,
    });
    const { result } = renderHook(() =>
      usePlanFromDesignDocSeed("org", "project", "plan")
    );
    expect(mocks.documents).toHaveBeenCalledWith(
      "org",
      expect.objectContaining({ taskId: "plan", projectId: "project" })
    );
    expect(mocks.relationships).not.toHaveBeenCalled();
    expect(mocks.documents).toHaveBeenCalledWith(
      "org",
      expect.objectContaining({ planId: "plan", enabled: false })
    );
    expect(result.current.designDocId).toBe("newer");
    expect(result.current.seed?.sections[0].materializedMarkdown).toBe(
      "Current design"
    );
  });

  it("retains the linked document preview for a migrated legacy Plan", () => {
    const { result } = renderHook(() =>
      usePlanFromDesignDocSeed("org", "project", "plan")
    );
    expect(mocks.relationships).not.toHaveBeenCalled();
    expect(mocks.documents).toHaveBeenCalledWith("org", {
      projectId: "project",
      planId: "plan",
      enabled: true,
    });
    expect(result.current.designDocId).toBe("legacy-doc");
  });

  it("treats a work-item Plan with no document links as empty, without calling the legacy Plan endpoint", () => {
    mocks.documents.mockReturnValue(list());
    mocks.document.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });
    mocks.relationships.mockImplementation(() => {
      throw new Error("Plan not found");
    });
    const { result } = renderHook(() =>
      usePlanFromDesignDocSeed("org", "project", "plan")
    );
    expect(result.current).toMatchObject({
      seed: null,
      designDocId: undefined,
      isLoading: false,
      error: null,
    });
    expect(mocks.relationships).not.toHaveBeenCalled();
  });

  it("keeps loading while the next document lookup has not started yet", () => {
    mocks.documents.mockImplementation((_org, options) =>
      options.taskId ? list() : { ...list(), isFetched: false }
    );
    mocks.document.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });
    const { result } = renderHook(() =>
      usePlanFromDesignDocSeed("org", "project", "plan")
    );
    expect(result.current.isLoading).toBe(true);
  });

  it("preserves the failed request's message and retries that lookup", async () => {
    const refetch = vi.fn().mockResolvedValue([]);
    mocks.documents.mockImplementation((_org, options) =>
      options.taskId
        ? list()
        : {
            ...list(),
            error: new Error("Request failed with status code 403"),
            refetch,
          }
    );
    mocks.document.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });
    const { result } = renderHook(() =>
      usePlanFromDesignDocSeed("org", "project", "plan")
    );
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toEqual(
      new Error(
        "Unable to find this Plan’s linked design doc: Request failed with status code 403"
      )
    );
    await result.current.retry();
    expect(refetch).toHaveBeenCalledOnce();
  });
});
