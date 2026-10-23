import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAttention } from "../useAttention";
import * as navigationModule from "../useNavigationAttention";
import * as heartbeatModule from "../useAttentionHeartbeat";

vi.mock("../../contexts/TrackingContext", () => ({
  useUserAction: () => ({
    trackAttention: vi.fn(),
  }),
}));

describe("useAttention", () => {
  it("should call both useNavigationAttention and useAttentionHeartbeat", () => {
    const navigationSpy = vi.spyOn(navigationModule, "useNavigationAttention");
    const heartbeatSpy = vi.spyOn(heartbeatModule, "useAttentionHeartbeat");

    renderHook(() =>
      useAttention({
        entityType: "task",
        entityId: "task-123",
        tab: "editor",
      })
    );

    expect(navigationSpy).toHaveBeenCalledWith(
      "task",
      "task-123",
      expect.any(Function),
      "editor"
    );
    expect(heartbeatSpy).toHaveBeenCalledWith(
      "task",
      "task-123",
      expect.any(Function),
      "editor"
    );

    navigationSpy.mockRestore();
    heartbeatSpy.mockRestore();
  });
});
