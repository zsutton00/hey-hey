import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentEdgeType,
  EntityType,
  WorkItemTypeEffectiveSource,
  WorkItemTypeLifecycleStatus,
  WorkItemTypeRole,
  WorkStatus,
  type WorkItemTypeDefinitionDto,
  type WorkItemTypeSummaryDto,
} from "../../../api";
import {
  WorkItemTypeCreateProposalPresentation,
  buildWorkItemTypeCreatePreviewModel,
} from "../WorkItemTypeCreateProposalPresentation";

const registryState = vi.hoisted(() => ({
  isReady: true,
  error: null as Error | null,
  workItemTypes: [] as WorkItemTypeSummaryDto[],
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypes: () => registryState,
}));

const summary = (
  key: string,
  name: string,
  definition: Partial<WorkItemTypeDefinitionDto> = {}
): WorkItemTypeSummaryDto => ({
  id: `type-${key}`,
  projectId: "project-1",
  status: WorkItemTypeLifecycleStatus.Active,
  effectiveSource: WorkItemTypeEffectiveSource.Canonical,
  definition: {
    key,
    name,
    role: WorkItemTypeRole.WorkItem,
    sections: [],
    allowedStatuses: [],
    ...definition,
  },
});

const definition: WorkItemTypeDefinitionDto = {
  key: "research_finding",
  name: "Research Finding",
  description: "Capture an evidence-backed customer insight.",
  iconKey: "contract",
  role: WorkItemTypeRole.WorkItem,
  sections: [
    { key: "finding", label: "Finding" },
    { key: "evidence", label: "Evidence" },
    { key: "source", label: "Source" },
    { key: "implications", label: "Implications" },
  ],
  requiredScalars: ["dueDate"],
  allowedStatuses: [WorkStatus.Backlog, WorkStatus.Active],
  allowedParentTypes: ["FEATURE"],
  allowedParentEntityTypes: [EntityType.Task],
  edgeTargets: [
    {
      edgeType: AgentEdgeType.RelatedTo,
      targetTypeKeys: ["FEATURE"],
    },
    {
      edgeType: AgentEdgeType.DependsOn,
      targetTypeKeys: ["STANDARD", "FEATURE"],
    },
    {
      edgeType: AgentEdgeType.RelatedTo,
      targetTypeKeys: ["STANDARD"],
    },
    {
      edgeType: AgentEdgeType.DerivesFrom,
      targetTypeKeys: ["STANDARD"],
    },
    {
      edgeType: AgentEdgeType.Supersedes,
      targetTypeKeys: ["STANDARD"],
    },
    {
      edgeType: AgentEdgeType.Contradicts,
      targetTypeKeys: ["STANDARD"],
    },
    {
      edgeType: AgentEdgeType.Evolves,
      targetTypeKeys: ["STANDARD"],
    },
    {
      edgeType: AgentEdgeType.Tracks,
      targetTypeKeys: ["FEATURE"],
    },
  ],
  tracking: {
    allowedSourceEntityTypes: [EntityType.Task],
    allowedSourceTaskTypes: ["GOAL"],
  },
  capabilities: {
    rendersInline: true,
    requiresParent: true,
    showsInExplorerSidebar: false,
    planEligible: false,
  },
};

beforeEach(() => {
  registryState.isReady = true;
  registryState.error = null;
  registryState.workItemTypes = [
    summary("FEATURE", "Feature", {
      role: WorkItemTypeRole.ProjectInfo,
      iconKey: "feature",
    }),
    summary("GOAL", "Goal", {
      role: WorkItemTypeRole.ProjectInfo,
      iconKey: "goal",
    }),
    summary("STANDARD", "Task", { iconKey: "task" }),
  ];
});

describe("buildWorkItemTypeCreatePreviewModel", () => {
  it("derives ordered sections, dependency-first relationship groups, and target-owned Goal tracking", () => {
    const model = buildWorkItemTypeCreatePreviewModel(
      definition,
      registryState.workItemTypes
    );

    expect(model?.sections.map((section) => section.label)).toEqual([
      "Finding",
      "Evidence",
      "Source",
      "Implications",
    ]);
    expect(model?.initialStatus).toBe(WorkStatus.Backlog);
    expect(model?.parentLabels).toEqual(["Feature", "Task"]);
    expect(model?.parentExamples).toEqual(["Feature", "Task"]);
    expect(model?.relationshipGroups).toHaveLength(2);
    expect(
      model?.relationshipGroups[1].relationships.map(
        (relationship) => relationship.edgeType
      )
    ).toEqual([
      AgentEdgeType.DependsOn,
      AgentEdgeType.DerivesFrom,
      AgentEdgeType.Supersedes,
      AgentEdgeType.Contradicts,
      AgentEdgeType.Evolves,
    ]);
    expect(
      model?.relationshipGroups[1].relationships.map(
        (relationship) => relationship.exampleTitle
      )
    ).toEqual([
      "Sample prerequisite task",
      "Sample source task",
      "Sample predecessor task",
      "Sample conflicting task",
      "Sample ongoing task",
    ]);
    expect(
      model?.relationshipGroups[1].relationships[0].applicableTargetTypes.map(
        (targetType) => targetType.typeKey
      )
    ).toEqual(["STANDARD", "FEATURE"]);
    expect(
      model?.relationshipGroups.flatMap((group) => group.relationships)
    ).toHaveLength(6);
    expect(model?.trackedByGoal).toBe(true);
    expect(model?.capabilities).toEqual([
      { key: "rendersInline", label: "Inline", enabled: true },
      { key: "requiresParent", label: "Parent required", enabled: true },
      {
        key: "showsInExplorerSidebar",
        label: "Sidebar",
        enabled: false,
      },
      { key: "planEligible", label: "Plan eligible", enabled: false },
    ]);
  });

  it("does not infer Goal tracking from an ordinary TRACKS target or a capability", () => {
    const model = buildWorkItemTypeCreatePreviewModel(
      {
        ...definition,
        tracking: undefined,
        capabilities: { requiresParent: true },
      },
      registryState.workItemTypes
    );

    expect(model?.trackedByGoal).toBe(false);
    expect(
      model?.relationshipGroups.flatMap((group) => group.relationships)
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ edgeType: AgentEdgeType.Tracks }),
      ])
    );
  });

  it("fails closed when a referenced type is absent from the active registry", () => {
    expect(
      buildWorkItemTypeCreatePreviewModel(
        { ...definition, allowedParentTypes: ["MISSING"] },
        registryState.workItemTypes
      )
    ).toBeNull();
  });
});

describe("WorkItemTypeCreateProposalPresentation", () => {
  it("renders a complete observational example and keeps status changes local", async () => {
    const user = userEvent.setup();
    render(
      <WorkItemTypeCreateProposalPresentation
        definition={definition}
        organizationId="organization-1"
        projectId="project-1"
      />
    );

    const preview = screen.getByTestId("work-item-type-create-example");
    expect(preview).toHaveTextContent(
      "Capture an evidence-backed customer insight."
    );
    expect(preview).toHaveTextContent("Role: work-item");
    expect(preview).toHaveTextContent("Parents:");
    expect(preview).toHaveTextContent("Feature");
    expect(preview).toHaveTextContent("Task");
    expect(preview).toHaveTextContent("illustrative only");
    expect(preview).toHaveTextContent("Feature");
    expect(preview).toHaveTextContent("Task");
    expect(preview).toHaveTextContent("Sample prerequisite task");
    expect(preview).toHaveTextContent("Sample related feature");
    expect(preview).toHaveTextContent("Sample source task");
    expect(preview).toHaveTextContent("Sample predecessor task");
    expect(preview).toHaveTextContent("Sample conflicting task");
    expect(preview).toHaveTextContent("Sample ongoing task");
    expect(preview).toHaveTextContent("Tracked by Goal");
    expect(preview).toHaveTextContent("Parent required: Yes");
    expect(preview).toHaveTextContent("Sidebar: No");
    expect(preview).toHaveTextContent("Plan eligible: No");
    expect(
      within(preview).getByRole("img", { name: "Contract icon" })
    ).toBeInTheDocument();
    expect(
      within(preview).getAllByText("Depends On", { exact: true })
    ).toHaveLength(1);

    const parent = within(preview).getByTestId("work-item-type-preview-parent");
    expect(within(parent).getByText("Feature")).toBeInTheDocument();
    expect(within(parent).getByText("Task")).toBeInTheDocument();
    expect(within(preview).getAllByText("View all types")).toHaveLength(6);
    const content = within(preview).getByTestId(
      "work-item-type-preview-content"
    );
    expect(
      parent.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    const styles = [...document.querySelectorAll("style")]
      .map((style) => style.textContent)
      .join("")
      .replace(/\s+/g, "");
    expect(styles).toContain(
      "grid-template-columns:minmax(0,1.25fr)minmax(260px,0.75fr)"
    );

    const sections = within(preview).getAllByTestId(
      "work-item-type-preview-section"
    );
    expect(sections.map((section) => section.dataset.sectionKey)).toEqual([
      "finding",
      "evidence",
      "source",
      "implications",
    ]);
    const sectionCopy = sections.map((section) => section.textContent);
    expect(new Set(sectionCopy)).toHaveLength(4);
    sectionCopy.forEach((copy) =>
      expect(copy?.split(".").length).toBeGreaterThan(2)
    );

    await user.click(
      within(preview).getByRole("button", {
        name: "View all target types for Depends On",
      })
    );
    const targetListHeading = screen.getByText("Depends On can target");
    const targetList = targetListHeading.parentElement;
    expect(targetList).not.toBeNull();
    expect(
      within(targetList as HTMLElement).getByText("Task")
    ).toBeInTheDocument();
    expect(
      within(targetList as HTMLElement).getByText("STANDARD")
    ).toBeInTheDocument();
    expect(
      within(targetList as HTMLElement).getByText("Feature")
    ).toBeInTheDocument();
    expect(
      within(targetList as HTMLElement).getByText("FEATURE")
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent(
      "Backlog"
    );
    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(screen.getByRole("option", { name: "In progress" }));
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent(
      "In progress"
    );
  });

  it("withholds the example until registry state is authoritative", () => {
    registryState.isReady = false;
    render(
      <WorkItemTypeCreateProposalPresentation
        definition={definition}
        organizationId="organization-1"
        projectId="project-1"
      />
    );

    expect(
      screen.getByTestId("work-item-type-preview-unavailable")
    ).toHaveTextContent("Loading the project type registry");
    expect(
      screen.queryByTestId("work-item-type-create-example")
    ).not.toBeInTheDocument();
  });
});
