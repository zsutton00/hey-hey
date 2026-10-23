import { describe, expect, it } from "vitest";
import {
  SESSION_METHOD_REGISTRY,
  buildDefaultStartupSessionPayload,
  buildTaskEntity,
  listCompatibleSessionMethods,
  listSessionMethods,
} from "./sessionMethodRegistry";

describe("session method work-item compatibility", () => {
  const existingMethods = Object.keys(SESSION_METHOD_REGISTRY);

  it.each(["STANDARD", "BUG"])(
    "preserves the full existing catalog for %s",
    (workItemTypeKey) => {
      expect(listCompatibleSessionMethods(workItemTypeKey)).toEqual(
        existingMethods,
      );
    },
  );

  it("fails closed for a type no method declares", () => {
    expect(listCompatibleSessionMethods("EVAL")).toEqual([]);
  });

  it("lists the complete catalog for sessions without a work item", () => {
    expect(listSessionMethods()).toEqual(existingMethods);
  });
});

describe("start-run payload identity", () => {
  const launch = { taskId: "job-application-1" };

  it("identifies the focal work item by its TASK entity reference only", () => {
    expect(buildTaskEntity({ taskId: " job-application-1 " })).toEqual({
      entityType: "TASK",
      entityId: "job-application-1",
    });
    expect(() => buildTaskEntity({ taskId: " " })).toThrow(
      "A task-scoped Run requires a task id.",
    );
  });

  it("never emits copied task-shaped startup input from any handler arm", () => {
    for (const config of Object.values(SESSION_METHOD_REGISTRY)) {
      if (config.dispatch.kind !== "handler") continue;
      const payload = config.dispatch.buildPayload({ launch, userMessage: "" });
      expect(payload).toMatchObject({
        entity: { entityType: "TASK", entityId: "job-application-1" },
      });
      expect(payload).not.toHaveProperty("startupInput");
    }
    expect(
      buildDefaultStartupSessionPayload({ launch, userMessage: "" }),
    ).not.toHaveProperty("startupInput");
  });
});
