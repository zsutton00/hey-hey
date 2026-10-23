import { describe, expect, it } from "vitest";
import { buildAgentSessionTaskNavigationPaths } from "./useAgenticAgentSessionPageState";

describe("buildAgentSessionTaskNavigationPaths", () => {
  it("builds the canonical task overview and coding-session destinations", () => {
    expect(
      buildAgentSessionTaskNavigationPaths("project-1", "task-1"),
    ).toEqual({
      taskOverviewPath: "/projects/project-1/tasks/task-1",
      taskCodingTabPath:
        "/projects/project-1/tasks/task-1?tab=agent-sessions",
    });
  });

  it("omits task navigation when the session has no attached task", () => {
    expect(
      buildAgentSessionTaskNavigationPaths("project-1", undefined),
    ).toEqual({
      taskOverviewPath: null,
      taskCodingTabPath: null,
    });
  });
});
