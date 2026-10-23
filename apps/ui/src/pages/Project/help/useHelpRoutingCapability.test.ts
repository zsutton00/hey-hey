import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@hey-hey/ui-common/services", () => ({
  WebPathService: {
    project: (projectId: string) => `/projects/${projectId}`,
  },
}));

import { useHelpRoutingCapability } from "./useHelpRoutingCapability";

describe("useHelpRoutingCapability", () => {
  it("opens the Your First Project Help subtab", () => {
    const { result } = renderHook(() => useHelpRoutingCapability("project-1"));

    expect(result.current.buildHref("read-first-project")).toBe(
      "/projects/project-1?tab=help&helpSubTab=first-project",
    );
  });

  it("resolves install-agent-bridge to the project settings page", () => {
    const { result } = renderHook(() => useHelpRoutingCapability("project-1"));

    expect(result.current.buildHref("install-agent-bridge")).toBe(
      "/projects/project-1/settings",
    );
  });

  it("resolves node-installer to the external Node.js installer URL", () => {
    const { result } = renderHook(() => useHelpRoutingCapability("project-1"));

    expect(result.current.buildHref("node-installer")).toBe(
      "https://nodejs.org/",
    );
  });

  it("resolves settings-machines to the project settings page", () => {
    const { result } = renderHook(() => useHelpRoutingCapability("project-1"));

    expect(result.current.buildHref("settings-machines")).toBe(
      "/projects/project-1/settings",
    );
  });

  it("resolves open-features to the project features tab", () => {
    const { result } = renderHook(() => useHelpRoutingCapability("project-1"));

    expect(result.current.buildHref("open-features")).toBe(
      "/projects/project-1?tab=features",
    );
  });

  it("resolves open-tasks to the project tasks tab", () => {
    const { result } = renderHook(() => useHelpRoutingCapability("project-1"));

    expect(result.current.buildHref("open-tasks")).toBe(
      "/projects/project-1?tab=tasks",
    );
  });

  it("resolves project-root to the project root", () => {
    const { result } = renderHook(() => useHelpRoutingCapability("project-1"));

    expect(result.current.buildHref("project-root")).toBe("/projects/project-1");
  });

  it("falls back to the project root for unknown intents — never the # stub", () => {
    const { result } = renderHook(() => useHelpRoutingCapability("project-1"));

    const href = result.current.buildHref("totally-unknown-intent");
    expect(href).toBe("/projects/project-1");
    expect(href).not.toBe("#");
  });

  it("returns a stable capability reference across re-renders for the same projectId", () => {
    const { result, rerender } = renderHook(
      ({ projectId }) => useHelpRoutingCapability(projectId),
      { initialProps: { projectId: "project-1" } },
    );

    const first = result.current;
    rerender({ projectId: "project-1" });
    expect(result.current).toBe(first);
  });

  it("returns a new capability reference when projectId changes", () => {
    const { result, rerender } = renderHook(
      ({ projectId }) => useHelpRoutingCapability(projectId),
      { initialProps: { projectId: "project-1" } },
    );

    const first = result.current;
    rerender({ projectId: "project-2" });
    expect(result.current).not.toBe(first);
    expect(result.current.buildHref("project-root")).toBe("/projects/project-2");
  });
});
