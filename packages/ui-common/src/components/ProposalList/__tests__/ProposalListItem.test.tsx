import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalOutOfDateStatus,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
} from "../../../api";
import { ProposalListItem } from "../ProposalListItem";

class MockIntersectionObserver {
  private callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(() => vi.fn()),
}));

vi.mock("../../WebUtils/navigateToEntity", () => ({
  navigateToEntity: vi.fn(),
}));

vi.mock("../../../data/hooks/useEntityContext", () => ({
  useEntityContext: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
    fetch: vi.fn(),
  })),
}));

vi.mock("../../InteractionComponent/useEntityConversationLauncher", () => ({
  useEntityConversationLauncher: vi.fn(() => ({
    launch: vi.fn().mockResolvedValue(true),
    isLoading: false,
    error: null,
  })),
}));

function buildProposal(
  overrides: Partial<ProposalResponseDto> = {},
): ProposalResponseDto {
  return {
    id: "proposal-1",
    organizationId: "org-1",
    projectId: "proj-1",
    type: ProposalType.Single,
    action: ProposalAction.Create,
    status: ProposalStatus.Draft,
    targetEntityId: "task-abc",
    targetEntityType: TargetEntityType.Task,
    updates: {},
    requestorId: "user-1",
    approvals: [],
    requiredApprovals: 1,
    outOfDateStatus: ProposalOutOfDateStatus.NotApplicable,
    influences: [],
    createdAt: "2026-04-16T00:00:00.000Z",
    updatedAt: "2026-04-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("ProposalListItem — InteractionComponent wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows API-owned out-of-date state without deriving it locally", () => {
    const { rerender } = render(
      <ProposalListItem
        proposal={buildProposal({
          action: ProposalAction.Update,
          outOfDateStatus: ProposalOutOfDateStatus.OutOfDate,
        })}
      />,
    );

    expect(
      screen.getByTestId("proposal-list-out-of-date-warning"),
    ).toBeVisible();

    rerender(
      <ProposalListItem
        proposal={buildProposal({
          action: ProposalAction.Update,
          outOfDateStatus: ProposalOutOfDateStatus.Current,
        })}
      />,
    );
    expect(
      screen.queryByTestId("proposal-list-out-of-date-warning"),
    ).not.toBeInTheDocument();
  });

  it("wraps row in an interactive InteractionComponent when status is Draft", () => {
    render(<ProposalListItem proposal={buildProposal()} />);

    const wrapper = screen.getByTestId("interaction-component");
    expect(wrapper).toHaveAttribute("data-entity-type", "PROPOSAL");
    expect(wrapper).toHaveAttribute("data-entity-id", "proposal-1");
    expect(screen.getByTestId("interaction-indicator")).toBeInTheDocument();
  });

  it("shows proposal ELI5 below the title when present", () => {
    render(
      <ProposalListItem
        proposal={buildProposal({ eli5: "Summarizes the change." })}
      />,
    );
    expect(screen.getByTestId("proposal-eli5")).toHaveTextContent(
      "Summarizes the change.",
    );
  });

  it("opens a context menu with Discuss entry on right-click of a Draft proposal", () => {
    render(<ProposalListItem proposal={buildProposal()} />);

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    expect(screen.getByTestId("interaction-context-menu")).toBeInTheDocument();
    expect(screen.getByTestId("interaction-menu-discuss")).toBeInTheDocument();
  });

  it("shows Discuss for Approved proposals as well", () => {
    render(
      <ProposalListItem
        proposal={buildProposal({ status: ProposalStatus.Approved })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    expect(screen.getByTestId("interaction-menu-discuss")).toBeInTheDocument();
  });

  it("shows Discuss for Rejected proposals as well", () => {
    render(
      <ProposalListItem
        proposal={buildProposal({ status: ProposalStatus.Rejected })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    expect(screen.getByTestId("interaction-menu-discuss")).toBeInTheDocument();
  });

  it("renders the title from updates.name on a CREATE proposal", () => {
    render(
      <ProposalListItem
        proposal={buildProposal({
          action: ProposalAction.Create,
          updates: { name: "Implement onboarding flow" },
        })}
      />,
    );

    expect(screen.getByText("Implement onboarding flow")).toBeInTheDocument();
  });

  it("falls back to action+target when updates carry no title", () => {
    render(
      <ProposalListItem
        proposal={buildProposal({
          action: ProposalAction.Update,
          updates: {},
        })}
      />,
    );

    expect(screen.getByText("Update Task")).toBeInTheDocument();
  });
});
