import { beforeEach, describe, expect, it, vi } from "vitest";
import { EntityType } from "../../api";
import { FakeWorkItemServer } from "../../test/workItemGraphQL";
import { triageReopenRequest } from "./reopen";

const clients = vi.hoisted(() => ({
  getEntityContext: vi.fn(),
}));
vi.mock("../../clients/serviceClients", () => ({
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
  const reopen = (server: FakeWorkItemServer) =>
    triageReopenRequest(server.graphql.apollo, scope, item, "intent");
  it.each(["parent", "stage", "plan"])(
    "preserves plan/stage ancestry with %s parent without duplicates",
    async (parentTaskId) => {
      const server = new FakeWorkItemServer([
        {
          id: "child",
          name: "Canonical title",
          type: "STANDARD",
          status: "ACTIVE",
          parentTaskId,
        },
      ]);
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
      const request = await reopen(server);
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
    const server = new FakeWorkItemServer([
      {
        id: "child",
        name: "Child",
        type: "STANDARD",
        status: "ACTIVE",
        parentTaskId: "parent",
      },
    ]);
    clients.getEntityContext.mockResolvedValue({ data: { data: {} } });
    expect((await reopen(server)).lineage).toEqual([
      { entityType: EntityType.Task, entityId: "parent" },
      { entityType: EntityType.Task, entityId: "child" },
    ]);
  });
  it("fails before activation if canonical ancestry cannot be read", async () => {
    const server = new FakeWorkItemServer([
      { id: "child", name: "Child", type: "STANDARD", status: "ACTIVE" },
    ]);
    clients.getEntityContext.mockRejectedValue(
      new Error("ancestry unavailable"),
    );
    await expect(reopen(server)).rejects.toThrow("ancestry unavailable");
  });
});
