import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { workItemDetailQueryOptions } from "../../../../data/collections/workItemLists";
import { workItemTypeByKeyQueryOptions } from "../../../../data/collections/workItemTypes";
import { statusDefinition } from "../../../../test/statusDefinitionFixture";
import { EntityStatusChip } from "../EntityStatusChip";

describe("EntityStatusChip", () => {
  it.each([
    { status: "QA", label: "QA" },
    { status: "ACTIVE", label: "Ready for QA" },
    { status: "Retired QA", label: "Retired QA" },
  ])(
    "displays the project's label or retained name for $status",
    ({ status, label }) => {
      const client = new QueryClient();
      client.setQueryData(
        workItemDetailQueryOptions("org", "", "item").queryKey,
        {
          id: "item",
          organizationId: "org",
          projectId: "project",
          type: "STANDARD",
          status,
        },
      );
      client.setQueryData(
        workItemTypeByKeyQueryOptions(client, "org", "project", "STANDARD")
          .queryKey,
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
        <QueryClientProvider client={client}>
          <EntityStatusChip
            entityId="item"
            entityType="task"
            organizationId="org"
          />
        </QueryClientProvider>,
      );
      expect(screen.getByText(label)).toBeVisible();
      client.clear();
    },
  );
});
