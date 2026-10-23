import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ActivityCorrelationLinkType,
  EntityType,
  type ActivityCorrelationLinkedEntityDto,
} from "../../../api";
import { ActivityTaskRelationships } from "../ActivityTaskRelationships";

const linkedEntitiesFixture: ActivityCorrelationLinkedEntityDto[] = [
  {
    entityId: "task-parent",
    entityType: EntityType.Task,
    linkType: ActivityCorrelationLinkType.Parent,
    title: "Parent Task",
  },
  {
    entityId: "task-child",
    entityType: EntityType.Task,
    linkType: ActivityCorrelationLinkType.Child,
    title: "Child Task",
  },
  {
    entityId: "task-blocking",
    entityType: EntityType.Task,
    linkType: ActivityCorrelationLinkType.Blocks,
    title: "Blocking Task",
  },
  {
    entityId: "task-dependency",
    entityType: EntityType.Task,
    linkType: ActivityCorrelationLinkType.DependsOn,
    title: "Dependency Task",
  },
];

describe("ActivityTaskRelationships", () => {
  it("renders hierarchy and blocking relationship groups", () => {
    render(
      <ActivityTaskRelationships
        linkedEntities={linkedEntitiesFixture}
        originTitle="Root Task"
      />
    );

    expect(
      screen.getByTestId("activity-task-relationships-origin")
    ).toHaveTextContent("Root Task");
    expect(
      screen.getByTestId("activity-task-relationships-parent-TASK-task-parent")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("activity-task-relationships-child-TASK-task-child")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "activity-task-relationships-blocks-TASK-task-blocking"
      )
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "activity-task-relationships-depends-on-TASK-task-dependency"
      )
    ).toBeInTheDocument();
  });

  it("renders empty state when no linked entities are available", () => {
    render(
      <ActivityTaskRelationships linkedEntities={[]} originTitle="Root Task" />
    );

    expect(
      screen.getByTestId("activity-task-relationships-empty")
    ).toHaveTextContent("No linked relationships");
  });
});
