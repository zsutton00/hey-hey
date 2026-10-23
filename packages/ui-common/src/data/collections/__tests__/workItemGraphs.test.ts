import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TaskSource,
  WorkStatus,
  type WorkItemGraphAggregateResponseDto,
} from "../../../api";
import { unifiedApiClient } from "../../../clients/serviceClients";
import {
  workItemGraphKeys,
  workItemGraphQueryOptions,
} from "../workItemGraphs";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { getWorkItemGraph: vi.fn() },
}));

const aggregate: WorkItemGraphAggregateResponseDto = {
  root: {
    id: "workflow-1",
    name: "Workflow",
    type: "workflow",
    sections: [],
    organizationId: "org-1",
    projectId: "project-1",
    status: WorkStatus.Backlog,
    source: TaskSource.System,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
  },
  children: [],
  relationships: [],
  layout: null,
  derivedReferences: [],
};

describe("workItemGraphs collection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keys aggregate reads by organization, project, and root identity", () => {
    expect(
      workItemGraphKeys.byId("org-1", "project-1", "workflow-1")
    ).toContain("workflow-1");
  });

  it("preserves the complete graph aggregate response", async () => {
    vi.mocked(unifiedApiClient.getWorkItemGraph).mockResolvedValue({
      data: {
        success: true,
        message: "ok",
        data: aggregate,
        timestamp: "2026-08-18T00:00:00.000Z",
        statusCode: 200,
      },
      status: 200,
      statusText: "OK",
      headers: {},
      config: {},
    });

    const options = workItemGraphQueryOptions(
      "org-1",
      "project-1",
      "workflow-1"
    );
    const result = await new QueryClient().fetchQuery(options);

    expect(unifiedApiClient.getWorkItemGraph).toHaveBeenCalledWith(
      {
        organizationId: "org-1",
        projectId: "project-1",
        workItemId: "workflow-1",
        incidentRelationshipTypes: undefined,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(result).toEqual(aggregate);
  });
});
