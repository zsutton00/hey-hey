import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RelatedEntityDtoWriterPayloadModeEnum } from "../../../api";
import { RelatedEntities } from "./RelatedEntities";

describe("RelatedEntities", () => {
  it("renders related entities summary and opens details modal", () => {
    render(
      <RelatedEntities
        entities={[
          {
            entityId: "task-1",
            entityType: "task",
            entityName: "Task A",
            writerPayloadMode:
              RelatedEntityDtoWriterPayloadModeEnum.FullDocument,
            selectedForHydration: true,
            hydrated: true,
          },
          {
            entityId: "plan-1",
            entityType: "plan",
            entityName: "Plan B",
          },
        ]}
        organizationId="org-1"
        projectId="project-1"
        label="Related entities"
      />,
    );

    expect(
      screen.getByTestId("related-entities-secondary-action"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("entity-evidence-open-more"));

    expect(screen.getByText("Related entities (2)")).toBeInTheDocument();
    expect(screen.getAllByText("Task A").length).toBeGreaterThan(0);
  });
});
