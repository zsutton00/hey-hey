import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FutureApplyFooter } from "../FutureApplyFooter";

const hooks = vi.hoisted(() => ({
  proposals: new Map<string, unknown>(),
  members: [] as Array<{ userId: string; user: { name: string } }>,
}));
vi.mock("../../../data/hooks/useProposal", () => ({
  useProposal: (_org: string, _project: string, id: string) => ({
    proposal: hooks.proposals.get(id) ?? null,
    refetch: vi.fn(),
    isReady: true,
    error: null,
  }),
}));
vi.mock("../../../data/hooks/useUsers", () => ({
  useUsers: () => ({ data: hooks.members }),
}));

const cancelledFuture = {
  id: "future",
  organizationId: "org",
  projectId: "project",
  outcome: "CANCELLED",
  latestProposalId: "cancel",
  cancelledAt: "2026-11-23T20:00:00Z",
};
function mount() {
  const shell = { id: "shell", organizationId: "org", projectId: "project" };
  hooks.proposals.set("shell", { ...shell, reviewedFuture: cancelledFuture });
  return render(<FutureApplyFooter proposal={shell as never} />);
}

beforeEach(() => {
  hooks.proposals.clear();
  hooks.members = [
    { userId: "requester", user: { name: "Riley" } },
    { userId: "approver", user: { name: "Avery" } },
  ];
});

describe("cancelled future footer", () => {
  it("names the approver who made it take effect and the requester when they differ", () => {
    hooks.proposals.set("cancel", {
      requestorId: "requester",
      approvals: [
        {
          userId: "requester",
          type: "APPROVAL",
          createdAt: "2026-11-23T19:00:00Z",
        },
        {
          userId: "approver",
          type: "APPROVAL",
          createdAt: "2026-11-23T20:00:00Z",
        },
      ],
    });
    mount();
    const text = screen.getByTestId("future-cancelled").textContent;
    expect(text).toContain("cancelled by Avery");
    expect(text).toContain("requested by Riley");
  });

  it("still names the actor when the requester has left the organization", () => {
    hooks.members = [{ userId: "approver", user: { name: "Avery" } }];
    hooks.proposals.set("cancel", {
      requestorId: "gone",
      approvals: [
        {
          userId: "approver",
          type: "APPROVAL",
          createdAt: "2026-11-23T20:00:00Z",
        },
      ],
    });
    mount();
    expect(screen.getByTestId("future-cancelled").textContent).toContain(
      "requested by a former member",
    );
  });

  it("falls back to a former member when the only actor cannot be resolved", () => {
    hooks.members = [];
    hooks.proposals.set("cancel", {
      requestorId: "gone",
      approvals: [
        { userId: "gone", type: "APPROVAL", createdAt: "2026-11-23T20:00:00Z" },
      ],
    });
    mount();
    expect(screen.getByTestId("future-cancelled").textContent).toContain(
      "cancelled by a former member",
    );
  });
});
