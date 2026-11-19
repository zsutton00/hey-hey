import { describe, expect, it } from "vitest";
import { FakeWorkItemServer } from "../../../test/workItemGraphQL";
import { workItemGraphRead } from "../workItemGraphs";

const scope = { organizationId: "org-1", projectId: "project-1" };

describe("workItemGraphs collection", () => {
  it("keeps the complete graph aggregate: root, children, relationships, layout, references and participation", async () => {
    const server = new FakeWorkItemServer([
      {
        id: "workflow-1",
        name: "Workflow",
        type: "workflow",
        status: "BACKLOG",
      },
      {
        id: "step-1",
        name: "Step",
        type: "workflow-step",
        status: "BACKLOG",
        parentTaskId: "workflow-1",
      },
    ]);
    const read = workItemGraphRead(scope, "workflow-1", [
      "GUARANTEES" as never,
    ]);

    const { data } = await server.graphql.forProject(scope).query({
      query: read.document,
      variables: read.variables,
      context: scope,
    });
    const aggregate = read.select(data!);

    expect(server.received("GetWorkItemGraph")[0]).toEqual({
      id: "workflow-1",
      incidentRelationshipTypes: ["GUARANTEES"],
    });
    expect(aggregate).toMatchObject({
      root: { id: "workflow-1", type: "workflow", sections: [] },
      children: [{ id: "step-1", type: "workflow-step" }],
      relationships: [],
      layout: null,
      derivedReferences: [],
      participation: { entries: [], summary: {} },
    });
  });
});
