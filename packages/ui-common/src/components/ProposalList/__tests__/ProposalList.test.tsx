import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
} from "../../../api";
import { ProposalList } from "../ProposalList";

class MockIntersectionObserver {
  private callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
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
  overrides: Partial<ProposalResponseDto> = {}
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
    influences: [],
    createdAt: "2026-04-16T00:00:00.000Z",
    updatedAt: "2026-04-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("ProposalList — row navigation", () => {
  it("renders rows as anchors with href when getProposalHref is provided", () => {
    render(
      <ProposalList
        proposals={[buildProposal()]}
        getProposalHref={(p) => `/projects/proj-1/proposals/${p.id}`}
      />
    );

    const anchor = screen.getByRole("link");
    expect(anchor).toHaveAttribute(
      "href",
      "/projects/proj-1/proposals/proposal-1"
    );
  });

  it("invokes onClickProposal on a plain left click", () => {
    const onClick = vi.fn();
    render(
      <ProposalList
        proposals={[buildProposal()]}
        getProposalHref={(p) => `/projects/proj-1/proposals/${p.id}`}
        onClickProposal={onClick}
      />
    );

    fireEvent.click(screen.getByRole("link"));

    expect(onClick).toHaveBeenCalledTimes(1);
    const [proposalArg, eventArg] = onClick.mock.calls[0];
    expect(proposalArg.id).toBe("proposal-1");
    expect(eventArg.metaKey).toBe(false);
  });

  it("does not preventDefault on a metaKey click so the browser opens the link natively", () => {
    const onClick = vi.fn(
      (
        _proposal: ProposalResponseDto,
        event: React.MouseEvent<HTMLElement>
      ) => {
        if (
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.button !== 0
        ) {
          return;
        }
        event.preventDefault();
      }
    );

    render(
      <ProposalList
        proposals={[buildProposal()]}
        getProposalHref={(p) => `/projects/proj-1/proposals/${p.id}`}
        onClickProposal={onClick}
      />
    );

    const link = screen.getByRole("link");
    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    Object.defineProperty(clickEvent, "metaKey", { value: true });
    link.dispatchEvent(clickEvent);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(clickEvent.defaultPrevented).toBe(false);
  });
});
