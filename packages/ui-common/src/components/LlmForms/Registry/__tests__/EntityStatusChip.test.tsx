import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { workItemTypeByKeyQueryOptions } from "../../../../data/collections/workItemTypes";
import { FakeWorkItemServer } from "../../../../test/workItemGraphQL";
import { statusDefinition } from "../../../../test/statusDefinitionFixture";
import { EntityStatusChip } from "../EntityStatusChip";

describe("EntityStatusChip", () => {
  it.each([
    { status: "QA", label: "QA" },
    { status: "ACTIVE", label: "Ready for QA" },
    { status: "Retired QA", label: "Retired QA" },
  ])(
    "displays the project's label or retained name for $status",
    async ({ status, label }) => {
      const server = new FakeWorkItemServer([
        { id: "item", name: "Item", type: "STANDARD", status },
      ]);
      server.queryClient.setQueryData(
        workItemTypeByKeyQueryOptions(
          server.queryClient,
          "org-1",
          "project-1",
          "STANDARD",
        ).queryKey,
        {
          definition: statusDefinition([], {
            statuses: [
              { name: "QA", label: "QA", meaning: "IN_PROGRESS" },
              { name: "ACTIVE", label: "Ready for QA", meaning: "IN_PROGRESS" },
            ],
          }),
        },
      );
      render(
        <EntityStatusChip
          entityId="item"
          entityType="task"
          organizationId="org-1"
          projectId="project-1"
        />,
        { wrapper: server.wrapper },
      );
      expect(await screen.findByText(label)).toBeVisible();
      server.queryClient.clear();
    },
  );
});
