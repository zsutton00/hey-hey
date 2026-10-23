import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TargetEntityType, TaskSource, WorkStatus } from "../../../api";
import type { PlanWorkItem } from "../../../data/plans/canonicalPlan";
import { PlanList } from "../PlanList";

// Capture every InteractionComponent invocation so the test can assert each
// plan is wrapped with the right entity context.
const interactionProps: Array<{
  entityId: string;
  entityType: string;
  hasProposalSupport: boolean;
  entityTitle?: string;
  organizationId?: string;
  projectId?: string;
}> = [];

vi.mock("../../InteractionComponent", () => ({
  InteractionComponent: (props: {
    entityId: string;
    entityType: string;
    entitySubtype: string;
    hasProposalSupport: boolean;
    entityTitle?: string;
    organizationId?: string;
    projectId?: string;
    children: React.ReactNode;
  }) => {
    interactionProps.push(props);
    return (
      <div
        data-testid="interaction-component"
        data-entity-id={props.entityId}
        data-entity-type={props.entityType}
        data-entity-subtype={props.entitySubtype}
        data-org-id={props.organizationId}
        data-project-id={props.projectId}
        data-has-proposal-support={String(props.hasProposalSupport)}
      >
        {props.children}
      </div>
    );
  },
}));

// EntityGrid renders each item through renderItem; EntityListItem and
// planAdapter are stubbed so the test isolates PlanList's wrapping logic.
vi.mock("../../Entity", () => ({
  EntityGrid: ({
    items,
    renderItem,
    keyExtractor,
    emptyMessage,
  }: {
    items: PlanWorkItem[];
    renderItem: (item: PlanWorkItem) => React.ReactNode;
    keyExtractor: (item: PlanWorkItem) => string;
    emptyMessage?: string;
  }) =>
    items.length === 0 ? (
      <div data-testid="empty-message">{emptyMessage}</div>
    ) : (
      <div>
        {items.map((item) => (
          <React.Fragment key={keyExtractor(item)}>
            {renderItem(item)}
          </React.Fragment>
        ))}
      </div>
    ),
  EntityListItem: ({ title }: { title?: string }) => (
    <div data-testid="entity-list-item">{title}</div>
  ),
  planAdapter: {
    toEntityListItemProps: (plan: PlanWorkItem) => ({ title: plan.name }),
  },
}));

function buildPlan(overrides: Partial<PlanWorkItem> = {}): PlanWorkItem {
  return {
    id: "plan-1",
    organizationId: "org-1",
    projectId: "proj-1",
    parentTaskId: "feature-1",
    name: "Plan One",
    type: "PLAN",
    sections: [],
    status: WorkStatus.Ready,
    source: TaskSource.System,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  interactionProps.length = 0;
});

describe("PlanList", () => {
  it("wraps each plan in an InteractionComponent with plan entity context", () => {
    const plans = [
      buildPlan({ id: "plan-1", name: "Plan One" }),
      buildPlan({ id: "plan-2", name: "Plan Two" }),
    ];

    render(
      <PlanList plans={plans} projectId="proj-1" organizationId="org-1" />,
    );

    const wrappers = screen.getAllByTestId("interaction-component");
    expect(wrappers).toHaveLength(2);

    wrappers.forEach((wrapper) => {
      expect(wrapper).toHaveAttribute(
        "data-entity-type",
        TargetEntityType.Task,
      );
      expect(wrapper).toHaveAttribute("data-entity-subtype", "PLAN");
      expect(wrapper).toHaveAttribute("data-org-id", "org-1");
      expect(wrapper).toHaveAttribute("data-project-id", "proj-1");
      expect(wrapper).toHaveAttribute("data-has-proposal-support", "true");
    });

    expect(wrappers.map((w) => w.getAttribute("data-entity-id"))).toEqual([
      "plan-1",
      "plan-2",
    ]);

    // Each wrapper renders the underlying EntityListItem as its child.
    expect(screen.getAllByTestId("entity-list-item")).toHaveLength(2);
    expect(interactionProps.map((p) => p.entityTitle)).toEqual([
      "Plan One",
      "Plan Two",
    ]);
  });

  it("renders the empty message and no wrappers when there are no plans", () => {
    render(
      <PlanList
        plans={[]}
        projectId="proj-1"
        organizationId="org-1"
        emptyMessage="No plans yet"
      />,
    );

    expect(screen.getByTestId("empty-message")).toHaveTextContent(
      "No plans yet",
    );
    expect(
      screen.queryByTestId("interaction-component"),
    ).not.toBeInTheDocument();
  });
});
