import { describe, expect, it } from "vitest";
import {
  buildTaskAgentSessionPath,
  buildTaskPathWithAgentTab,
} from "./taskSessionRoutes";

describe("taskSessionRoutes", () => {
  it("builds task coding session paths", () => {
    expect(
      buildTaskAgentSessionPath(
        "project-1",
        "initiative-1",
        "task-1",
        "session-1",
      ),
    ).toBe(
      "/projects/project-1/tasks/task-1/agent-sessions/session-1",
    );
  });

  it("builds task paths with coding sessions tab query", () => {
    expect(
      buildTaskPathWithAgentTab("project-1", "initiative-1", "task-1"),
    ).toBe("/projects/project-1/tasks/task-1?tab=agent-sessions");
  });
});
