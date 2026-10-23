import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
} from "../../../api";
import { ProposalStepper } from "../ProposalStepper";
import type { ProposalItemStatus } from "../types";

vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: {},
  tasksClient: {},
}));

vi.mock("../../../data/hooks/usePlan", () => ({
  usePlan: () => ({ data: undefined }),
}));

const ORG_ID = "org-1";
const PROJ_ID = "proj-1";
const STAGE_ID = "stage-1";

function makeProposal(
  id: string,
  title: string,
  status: ProposalStatus = ProposalStatus.Draft,
  targetEntityType: TargetEntityType = TargetEntityType.Task,
): ProposalResponseDto {
  return {
    id,
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    type: ProposalType.Single,
    action: ProposalAction.Create,
    status,
    targetEntityId: STAGE_ID,
    targetEntityType,
    updates: { name: title, parentTaskId: STAGE_ID, type: "STANDARD" },
    requestorId: "user-1",
    createdAt: "2026-05-05T00:00:00Z",
    updatedAt: "2026-05-05T00:00:00Z",
  } as unknown as ProposalResponseDto;
}

const renderActiveLabel = (proposal: ProposalResponseDto) => (
  <div data-testid={`active-${proposal.id}`}>
    Active: {(proposal.updates as { name: string }).name}
  </div>
);

describe("ProposalStepper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders rail labels from proposal title with target-type fallback", () => {
    const proposals = [
      makeProposal("p-1", "Step one"),
      {
        ...makeProposal("p-2", ""),
        updates: {},
      } as unknown as ProposalResponseDto,
    ];

    render(
      <MemoryRouter>
        <ProposalStepper
          proposals={proposals}
          getItemState={() => ({ state: "pending" })}
          onApply={vi.fn()}
          renderProposal={renderActiveLabel}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Step one")).toBeInTheDocument();
    expect(screen.getByText("Create Task")).toBeInTheDocument();
  });

  it("can render single-line title labels without proposal header metadata", () => {
    const proposals = [
      {
        ...makeProposal(
          "p-1",
          "A very long visual preview step name that should be truncated",
        ),
        eli5: "This explanation belongs in the proposal panel.",
      },
    ];

    render(
      <MemoryRouter>
        <ProposalStepper
          proposals={proposals}
          getItemState={() => ({ state: "pending" })}
          onApply={vi.fn()}
          renderProposal={renderActiveLabel}
          hideHeaderMetadata
        />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("proposal-eli5")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("proposal-header-action"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("proposal-header-type"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("proposal-title")).toHaveStyle({
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
  });

  it("derives status dots from each proposal's lifecycle", () => {
    const proposals = [
      makeProposal("p-1", "Pending"),
      makeProposal("p-2", "Approved", ProposalStatus.Approved),
      makeProposal("p-3", "Rejected", ProposalStatus.Rejected),
    ];

    render(
      <MemoryRouter>
        <ProposalStepper
          proposals={proposals}
          getItemState={(id) => ({
            state: id === "p-2" ? "applied" : "pending",
          })}
          onApply={vi.fn()}
          renderProposal={renderActiveLabel}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("proposal-stepper-dot-0").dataset.lifecycle).toBe(
      "pending",
    );
    expect(screen.getByTestId("proposal-stepper-dot-1").dataset.lifecycle).toBe(
      "applied",
    );
    expect(screen.getByTestId("proposal-stepper-dot-2").dataset.lifecycle).toBe(
      "rejected",
    );
  });

  it("distinguishes an approved future from its later application outcome", () => {
    const staged = {
      ...makeProposal(
        "future-proposal",
        "Future task",
        ProposalStatus.Approved,
      ),
      action: ProposalAction.VersionedUpdate,
      reviewedFuture: { outcome: "STAGED" },
    } as unknown as ProposalResponseDto;
    const { rerender } = render(
      <MemoryRouter>
        <ProposalStepper
          proposals={[staged]}
          getItemState={() => ({ state: "applied" })}
          onApply={vi.fn()}
          renderProposal={renderActiveLabel}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("proposal-stepper-dot-0").dataset.lifecycle).toBe(
      "approved",
    );

    const applied = {
      ...staged,
      reviewedFuture: { outcome: "APPLIED" },
    } as unknown as ProposalResponseDto;
    rerender(
      <MemoryRouter>
        <ProposalStepper
          proposals={[applied]}
          getItemState={() => ({ state: "applied" })}
          onApply={vi.fn()}
          renderProposal={renderActiveLabel}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("proposal-stepper-dot-0").dataset.lifecycle).toBe(
      "applied",
    );
  });

  it("auto-advances active index when the active proposal becomes applied", async () => {
    const proposals = [
      makeProposal("p-1", "First"),
      makeProposal("p-2", "Second"),
      makeProposal("p-3", "Third"),
    ];

    let appliedId: string | null = null;
    const getItemState = (id: string): ProposalItemStatus =>
      id === appliedId ? { state: "applied" } : { state: "pending" };

    const Harness: React.FC = () => {
      const [, force] = React.useReducer((n: number) => n + 1, 0);
      // Expose force-update via global so the test can trigger re-render
      (window as unknown as { __forceUpdate: () => void }).__forceUpdate =
        force;
      return (
        <ProposalStepper
          proposals={proposals}
          getItemState={getItemState}
          onApply={vi.fn()}
          renderProposal={renderActiveLabel}
        />
      );
    };

    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("active-p-1")).toBeInTheDocument();

    appliedId = "p-1";
    act(() => {
      (window as unknown as { __forceUpdate: () => void }).__forceUpdate();
    });

    await waitFor(() => {
      expect(screen.getByTestId("active-p-2")).toBeInTheDocument();
    });
  });

  it("auto-advances when the active proposal moves to rejected", async () => {
    const proposals = [
      makeProposal("p-1", "First"),
      makeProposal("p-2", "Second"),
    ];

    let firstStatus: ProposalStatus = ProposalStatus.Draft;
    const Harness: React.FC = () => {
      const [, force] = React.useReducer((n: number) => n + 1, 0);
      (window as unknown as { __forceUpdate: () => void }).__forceUpdate =
        force;
      const liveProposals = proposals.map((p, i) =>
        i === 0 ? { ...p, status: firstStatus } : p,
      );
      return (
        <ProposalStepper
          proposals={liveProposals}
          getItemState={() => ({ state: "pending" })}
          onApply={vi.fn()}
          renderProposal={renderActiveLabel}
        />
      );
    };

    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("active-p-1")).toBeInTheDocument();

    firstStatus = ProposalStatus.Rejected;
    act(() => {
      (window as unknown as { __forceUpdate: () => void }).__forceUpdate();
    });

    await waitFor(() => {
      expect(screen.getByTestId("active-p-2")).toBeInTheDocument();
    });
  });

  it("navigates between proposals with Previous and Next", async () => {
    const proposals = [
      makeProposal("p-1", "First"),
      makeProposal("p-2", "Second"),
      makeProposal("p-3", "Third"),
    ];

    render(
      <MemoryRouter>
        <ProposalStepper
          proposals={proposals}
          getItemState={() => ({ state: "pending" })}
          onApply={vi.fn()}
          renderProposal={renderActiveLabel}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("active-p-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByTestId("active-p-2")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByTestId("active-p-3")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => {
      expect(screen.getByTestId("active-p-2")).toBeInTheDocument();
    });
  });

  it("keeps an approved middle step selected when navigating back after auto-advance", async () => {
    const proposals = [
      makeProposal("p-1", "First"),
      makeProposal("p-2", "Second"),
      makeProposal("p-3", "Third"),
    ];
    let approvedId: string | null = null;
    const renderStepper = () => (
      <MemoryRouter>
        <ProposalStepper
          proposals={proposals}
          getItemState={(id) => ({
            state: id === approvedId ? "applied" : "pending",
          })}
          onApply={vi.fn()}
          renderProposal={renderActiveLabel}
        />
      </MemoryRouter>
    );
    const { rerender } = render(renderStepper());

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByTestId("active-p-2")).toBeInTheDocument();
    });

    approvedId = "p-2";
    rerender(renderStepper());
    await waitFor(() => {
      expect(screen.getByTestId("active-p-3")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => {
      expect(screen.getByTestId("active-p-2")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => {
      expect(screen.getByTestId("active-p-1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Second/ }));
    await waitFor(() => {
      expect(screen.getByTestId("active-p-2")).toBeInTheDocument();
    });
    expect(screen.getByTestId("proposal-stepper-dot-1")).toHaveAttribute(
      "data-lifecycle",
      "applied",
    );
  });

  it("allows direct inspection of a previously rejected step", async () => {
    const proposals = [
      makeProposal("p-1", "Rejected", ProposalStatus.Rejected),
      makeProposal("p-2", "Pending"),
    ];

    render(
      <MemoryRouter>
        <ProposalStepper
          proposals={proposals}
          getItemState={() => ({ state: "pending" })}
          onApply={vi.fn()}
          renderProposal={renderActiveLabel}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("active-p-2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Rejected/ }));
    await waitFor(() => {
      expect(screen.getByTestId("active-p-1")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByTestId("proposal-stepper-dot-0")).toHaveAttribute(
      "data-lifecycle",
      "rejected",
    );
  });

  it("initialises the active index to the first still-pending entry", () => {
    const proposals = [
      makeProposal("p-1", "First", ProposalStatus.Approved),
      makeProposal("p-2", "Second", ProposalStatus.Rejected),
      makeProposal("p-3", "Third"),
    ];

    render(
      <MemoryRouter>
        <ProposalStepper
          proposals={proposals}
          getItemState={(id) => ({
            state: id === "p-1" ? "applied" : "pending",
          })}
          onApply={vi.fn()}
          renderProposal={renderActiveLabel}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("active-p-3")).toBeInTheDocument();
  });
});
