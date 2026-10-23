import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  PreviewHostProvider,
  usePreviewHost,
  type PreviewHost,
  createProjectCollectionPreviewRequest,
  isProjectCollectionPreviewRequest,
} from "../PreviewHostContext";
import { createOpenItemEntity } from "../../types/openItems";

describe("PreviewHostContext", () => {
  it("fails loudly when Preview is invoked without an application host", () => {
    const { result } = renderHook(() => usePreviewHost());

    expect(() =>
      result.current.openPreview(
        createOpenItemEntity("agent_session", "session-123")
      )
    ).toThrow(
      "PreviewHostProvider is required for previewable InteractionComponent entities."
    );
  });

  it("forwards Preview through the required provider host", () => {
    const host: PreviewHost = { openPreview: vi.fn() };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PreviewHostProvider host={host}>{children}</PreviewHostProvider>
    );
    const { result } = renderHook(() => usePreviewHost(), { wrapper });
    const request = createOpenItemEntity("task", "task-123");

    result.current.openPreview(request);

    expect(host.openPreview).toHaveBeenCalledWith(request);
  });

  it("forwards project collection requests through the stable host", () => {
    const host: PreviewHost = { openPreview: vi.fn() };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PreviewHostProvider host={host}>{children}</PreviewHostProvider>
    );
    const { result } = renderHook(() => usePreviewHost(), { wrapper });
    const request = createProjectCollectionPreviewRequest("features");

    result.current.openPreview(request);

    expect(isProjectCollectionPreviewRequest(request)).toBe(true);
    expect(host.openPreview).toHaveBeenCalledWith(request);
  });
});
