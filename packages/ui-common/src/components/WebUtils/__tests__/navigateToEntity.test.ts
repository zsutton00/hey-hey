import { describe, expect, it, vi } from "vitest";
import { getPathService } from "../../../services";
import { navigateToEntity } from "../navigateToEntity";

describe("navigateToEntity", () => {
  it("navigates Plan mentions to their plan route", async () => {
    const navigate = vi.fn();
    await navigateToEntity({
      entity: { id: "plan-1", type: "plan", name: "Delivery" },
      navigate,
      projectId: "project-1",
      pathService: getPathService(),
    });
    expect(navigate).toHaveBeenCalledWith("/projects/project-1/plans/plan-1");
  });
  it("routes BUG entities through the task-backed work-item path", async () => {
    const navigate = vi.fn();

    await navigateToEntity({
      entity: {
        id: "bug-1",
        type: "BUG",
        name: "Mention does not navigate",
      },
      navigate,
      projectId: "project-1",
      pathService: getPathService(),
    });

    expect(navigate).toHaveBeenCalledWith("/projects/project-1/tasks/bug-1");
  });

  it.each(["STANDARD", "mockups_v2", "mockups_v3", "CONTRACT"])(
    "routes the registry work-item key %s through the task-backed path",
    async (type) => {
      const navigate = vi.fn();

      await navigateToEntity({
        entity: { id: "item-1", type, name: "Work item" },
        navigate,
        projectId: "project-1",
        pathService: getPathService(),
      });

      expect(navigate).toHaveBeenCalledWith("/projects/project-1/tasks/item-1");
    },
  );

  it("routes workflow entities through the task-backed work-item path", async () => {
    const navigate = vi.fn();

    await navigateToEntity({
      entity: {
        id: "workflow-1",
        type: "workflow",
        name: "Plan review workflow",
      },
      navigate,
      projectId: "project-1",
      pathService: getPathService(),
    });

    expect(navigate).toHaveBeenCalledWith(
      "/projects/project-1/tasks/workflow-1",
    );
  });

  it("routes report entities through the project report path", async () => {
    const navigate = vi.fn();

    await navigateToEntity({
      entity: {
        id: "report-1",
        type: "report",
        name: "Feature sync decision",
      },
      navigate,
      projectId: "project-1",
      pathService: getPathService(),
    });

    expect(navigate).toHaveBeenCalledWith(
      "/projects/project-1/reports/report-1",
    );
  });

  it("routes conversation entities through the agent-session resolver", async () => {
    const navigate = vi.fn();

    await navigateToEntity({
      entity: {
        id: "conversation-1",
        type: "conversation",
        name: "Plan work item type migration",
      },
      navigate,
      projectId: "project-1",
      pathService: getPathService(),
    });

    expect(navigate).toHaveBeenCalledWith(
      "/projects/project-1/resolve-agent-session/conversation-1",
    );
  });
});
