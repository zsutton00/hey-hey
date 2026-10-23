import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
  type TaskResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import { UpdateProposal } from "../UpdateProposal";

const { entities, definitions, registryState } = vi.hoisted(() => ({
  entities: {} as Record<string, { type: "task"; data: TaskResponseDto }>,
  definitions: [] as WorkItemTypeDefinitionDto[],
  registryState: {
    isLoading: false,
    error: null as Error | null,
  },
}));

vi.mock("../useEntityData", () => ({
  useEntityData: () => ({ entities, loading: false, error: null }),
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: true,
    isReady: true,
    isLoading: false,
    error: null,
  }),
  useWorkItemTypes: () => ({
    workItemTypes: definitions.map((definition) => ({
      definition,
      status: "ACTIVE",
      projectId: "project-1",
    })),
    isLoading: registryState.isLoading,
    error: registryState.error,
  }),
}));

vi.mock("../TaskUpdateRenderer", () => ({
  TaskUpdateRenderer: ({
    workItemTypeDefinition,
  }: {
    workItemTypeDefinition: WorkItemTypeDefinitionDto;
  }) => (
    <div
      data-section-keys={workItemTypeDefinition.sections
        .map(({ key }) => key)
        .join(",")}
    >
      Update {workItemTypeDefinition.name}
    </div>
  ),
}));

vi.mock("../WorkflowProposalRenderer", () => ({
  WorkflowProposalRenderer: ({
    workItemTypeDefinition,
  }: {
    workItemTypeDefinition: WorkItemTypeDefinitionDto;
  }) => <div>Update {workItemTypeDefinition.name}</div>,
}));

vi.mock("../../InteractionComponent", () => ({
  InteractionComponent: ({
    entityTitle,
    children,
  }: {
    entityTitle: string;
    children: React.ReactNode;
  }) => <section aria-label={entityTitle}>{children}</section>,
}));

const definition = (
  key: string,
  name: string,
  sections: WorkItemTypeDefinitionDto["sections"] = [],
): WorkItemTypeDefinitionDto => ({
  key,
  name,
  sections,
  allowedStatuses: [],
});

const proposal = (
  id: string,
  type: string,
  workflow = false,
): ProposalResponseDto =>
  ({
    id: `proposal-${id}`,
    organizationId: "org-1",
    projectId: "project-1",
    type: ProposalType.Single,
    action: ProposalAction.Update,
    status: ProposalStatus.Pending,
    targetEntityId: id,
    targetEntityType: TargetEntityType.Task,
    updates: workflow
      ? { type, name: `Updated ${name}` }
      : { name: `Updated ${name}`, type },
    requestorId: "user-1",
    requiredApprovals: 1,
    approvals: [],
    createdAt: "2026-07-25T00:00:00Z",
    updatedAt: "2026-07-25T00:00:00Z",
  }) as ProposalResponseDto;

const task = (id: string, type: string): TaskResponseDto =>
  ({
    id,
    name: id,
    type,
    organizationId: "org-1",
    projectId: "project-1",
    sections: [],
  }) as TaskResponseDto;

beforeEach(() => {
  definitions.splice(
    0,
    definitions.length,
    definition("workflow_step", "Workflow Step"),
    definition("RESEARCH_BRIEF", "Research Brief", [
      { key: "audience", label: "Audience" },
      { key: "summary", label: "Summary" },
    ]),
  );
  registryState.isLoading = false;
  registryState.error = null;
  Object.keys(entities).forEach((key) => delete entities[key]);
  entities["step-1"] = {
    type: "task",
    data: task("step-1", "workflow_step"),
  };
  entities["brief-1"] = {
    type: "task",
    data: task("brief-1", "RESEARCH_BRIEF"),
  };
});

describe("UpdateProposal registry-defined labels", () => {
  it.each([
    ["workflow_step", "step-1", true, "Update Workflow Step"],
    ["custom work-item type", "brief-1", false, "Update Research Brief"],
  ])("uses the registry name for %s updates", (_case, id, workflow, label) => {
    render(
      <UpdateProposal
        proposals={[proposal(id, entities[id].data.type, workflow)]}
        onApply={async () => {}}
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: label })).toBeInTheDocument();
  });

  it("withholds task-backed presentation while the registry is loading", () => {
    registryState.isLoading = true;

    render(
      <UpdateProposal
        proposals={[proposal("brief-1", "RESEARCH_BRIEF")]}
        onApply={async () => {}}
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    expect(
      screen
        .getAllByRole("progressbar")
        .filter(
          (el) => el.getAttribute("aria-label") !== "Checking current content",
        ),
    ).toHaveLength(1);
    expect(screen.queryByText("Update Task")).not.toBeInTheDocument();
    expect(screen.queryByText("Update Research Brief")).not.toBeInTheDocument();
  });

  it("passes the proposed target type definition to a type-changing update", () => {
    entities["legacy-1"] = {
      type: "task",
      data: task("legacy-1", "workflow_step"),
    };

    render(
      <UpdateProposal
        proposals={[proposal("legacy-1", "RESEARCH_BRIEF")]}
        onApply={async () => {}}
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    expect(screen.getByText("Update Research Brief")).toHaveAttribute(
      "data-section-keys",
      "audience,summary",
    );
  });

  it("renders an explicit unavailable state instead of a task fallback", () => {
    definitions.splice(0, definitions.length);

    render(
      <UpdateProposal
        proposals={[proposal("brief-1", "RESEARCH_BRIEF")]}
        onApply={async () => {}}
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    expect(
      screen.getByText(
        "The work-item type details are unavailable for this update.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Update Task")).not.toBeInTheDocument();
  });
});
