import { beforeEach, describe, expect, it, vi } from "vitest";
import { EntityType } from "../../api";
import { triageReopenRequest } from "./reopen";

const clients = vi.hoisted(() => ({
  getTask: vi.fn(),
  getEntityContext: vi.fn(),
}));
vi.mock("../../clients/serviceClients", () => ({
  unifiedApiClient: { getTask: clients.getTask },
  entityContextClient: { getEntityContext: clients.getEntityContext },
  agentSessionsClient: {},
  conversationsClient: {},
  designDocsClient: {},
  proposalsClient: {},
}));
const scope = { organizationId: "org", projectId: "project" };
const item = {
  entityType: EntityType.Task,
  entityId: "child",
  title: "Old title",
};
describe("triage canonical reopening lineage", () => {
  beforeEach(() => vi.resetAllMocks());
  it.each(["parent", "stage", "plan"])(
    "preserves plan/stage ancestry with %s parent without duplicates",
    async (parentTaskId) => {
      clients.getTask.mockResolvedValue({
        data: {
          data: {
            id: "child",
            name: "Canonical title",
            type: "STANDARD",
            status: "ACTIVE",
            parentTaskId,
          },
        },
      });
      clients.getEntityContext.mockResolvedValue({
        data: {
          data: {
            planContext: {
              parentPlan: { id: "plan" },
              parentStage: { id: "stage" },
            },
          },
        },
      });
      const request = await triageReopenRequest(scope, item, "intent");
      expect(request.lineage).toEqual(
        [...new Set(["plan", "stage", parentTaskId, "child"])].map(
          (entityId) => ({ entityType: EntityType.Task, entityId }),
        ),
      );
      expect(request.presentation.label).toBe("Canonical title");
      expect(request.idempotencyKey).toBe("intent");
    },
  );
  it("retains ordinary nested parent lineage without a plan", async () => {
    clients.getTask.mockResolvedValue({
      data: {
        data: {
          id: "child",
          name: "Child",
          type: "STANDARD",
          parentTaskId: "parent",
        },
      },
    });
    clients.getEntityContext.mockResolvedValue({ data: { data: {} } });
    expect((await triageReopenRequest(scope, item, "intent")).lineage).toEqual([
      { entityType: EntityType.Task, entityId: "parent" },
      { entityType: EntityType.Task, entityId: "child" },
    ]);
  });
  it("fails before activation if canonical ancestry cannot be read", async () => {
    clients.getTask.mockResolvedValue({
      data: { data: { id: "child", name: "Child" } },
    });
    clients.getEntityContext.mockRejectedValue(
      new Error("ancestry unavailable"),
    );
    await expect(triageReopenRequest(scope, item, "intent")).rejects.toThrow(
      "ancestry unavailable",
    );
  });
});
