import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLockedEditorSync } from "../useLockedEditorSync";

interface WorkItemContent {
  description: string;
  details: string;
  acceptanceCriteria: string;
}

const EMPTY_CONTENT: WorkItemContent = {
  description: "",
  details: "",
  acceptanceCriteria: "",
};

const WORK_ITEM_FIELDS = [
  "description",
  "details",
  "acceptanceCriteria",
] as const;

describe("useLockedEditorSync", () => {
  it("keeps draft locked while dirty when a server refresh arrives", () => {
    const { result } = renderHook(() =>
      useLockedEditorSync<WorkItemContent, keyof WorkItemContent>({
        documentKey: "work-item-1",
        initialDocument: EMPTY_CONTENT,
        fields: WORK_ITEM_FIELDS,
      })
    );

    act(() => {
      result.current.applyUserPatch({ description: "local description" });
    });

    act(() => {
      result.current.applyServerRefresh({
        description: "server description",
        details: "",
        acceptanceCriteria: "",
      });
    });

    expect(result.current.state.draft.description).toBe("local description");
    expect(result.current.state.base.description).toBe("");
    expect(result.current.state.hasPendingServerUpdate).toBe(true);
    expect(result.current.state.pendingServer?.description).toBe(
      "server description"
    );
  });

  it("applies accepted suggestions to both draft and base", () => {
    const { result } = renderHook(() =>
      useLockedEditorSync<WorkItemContent, keyof WorkItemContent>({
        documentKey: "work-item-1",
        initialDocument: EMPTY_CONTENT,
        fields: WORK_ITEM_FIELDS,
      })
    );

    act(() => {
      result.current.applyUserPatch({ description: "local description" });
      result.current.applyAcceptedSuggestion({
        details: "accepted details",
      });
    });

    expect(result.current.state.draft.description).toBe("local description");
    expect(result.current.state.base.description).toBe("");
    expect(result.current.state.draft.details).toBe("accepted details");
    expect(result.current.state.base.details).toBe("accepted details");
    expect(result.current.state.dirtyKeys.has("description")).toBe(true);
    expect(result.current.state.dirtyKeys.has("details")).toBe(false);
  });

  it("hydrates from server refresh when there are no local edits", () => {
    const { result } = renderHook(() =>
      useLockedEditorSync<WorkItemContent, keyof WorkItemContent>({
        documentKey: "work-item-1",
        initialDocument: EMPTY_CONTENT,
        fields: WORK_ITEM_FIELDS,
      })
    );

    act(() => {
      result.current.applyServerRefresh({
        description: "fresh description",
        details: "fresh details",
        acceptanceCriteria: "",
      });
    });

    expect(result.current.state.base.description).toBe("fresh description");
    expect(result.current.state.draft.description).toBe("fresh description");
    expect(result.current.state.dirtyKeys.size).toBe(0);
    expect(result.current.hasUnsavedChanges).toBe(false);
  });

  it("adopts pending server update when discarding local changes", () => {
    const { result } = renderHook(() =>
      useLockedEditorSync<WorkItemContent, keyof WorkItemContent>({
        documentKey: "work-item-1",
        initialDocument: EMPTY_CONTENT,
        fields: WORK_ITEM_FIELDS,
      })
    );

    act(() => {
      result.current.applyUserPatch({ description: "local description" });
      result.current.applyServerRefresh({
        description: "server description",
        details: "server details",
        acceptanceCriteria: "",
      });
      result.current.discardDraft();
    });

    expect(result.current.state.base.description).toBe("server description");
    expect(result.current.state.draft.description).toBe("server description");
    expect(result.current.state.draft.details).toBe("server details");
    expect(result.current.state.dirtyKeys.size).toBe(0);
    expect(result.current.state.hasPendingServerUpdate).toBe(false);
  });

  it("resets state when the document key changes", () => {
    const { result, rerender } = renderHook(
      ({
        documentKey,
        initialDocument,
      }: {
        documentKey: string;
        initialDocument: WorkItemContent;
      }) =>
        useLockedEditorSync<WorkItemContent, keyof WorkItemContent>({
          documentKey,
          initialDocument,
          fields: WORK_ITEM_FIELDS,
        }),
      {
        initialProps: {
          documentKey: "work-item-1",
          initialDocument: EMPTY_CONTENT,
        },
      }
    );

    act(() => {
      result.current.applyUserPatch({ description: "local description" });
    });

    rerender({
      documentKey: "work-item-2",
      initialDocument: {
        description: "new description",
        details: "",
        acceptanceCriteria: "",
      },
    });

    expect(result.current.state.base.description).toBe("new description");
    expect(result.current.state.draft.description).toBe("new description");
    expect(result.current.state.dirtyKeys.size).toBe(0);
  });
});
