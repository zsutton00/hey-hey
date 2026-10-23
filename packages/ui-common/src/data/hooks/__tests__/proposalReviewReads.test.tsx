import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  TaskSource,
  WorkStatus,
  type FutureRevisionResponse,
  type ProposalResponseDto,
  type FutureApplyResponse,
} from "../../../api";
import { useProposal } from "../useProposal";
import { useProposals } from "../useProposals";
import { useProposalGroup } from "../useProposalGroup";
import { useProposalGroupDecisions } from "../useProposalGroupDecisions";
import { useApplyProposalFuture } from "../useApplyProposalFuture";

const client = vi.hoisted(() => ({
  getProposal: vi.fn(),
  listProposals: vi.fn(),
  getProposalGroup: vi.fn(),
  getProposalFuture: vi.fn(),
  updateProposal: vi.fn(),
  rejectProposal: vi.fn(),
  approveAllProposalGroupMembers: vi.fn(),
  applyProposalFuture: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", () => ({ proposalsClient: client }));
vi.mock("../../../contexts/WebSocketContext", () => ({
  useOptionalWebSocketService: () => null,
}));

const content = {
  id: "target",
  name: "Approved result",
  type: "STANDARD",
  sections: [],
  organizationId: "org",
  projectId: "project",
  status: WorkStatus.Backlog,
  source: TaskSource.System,
};
const future: FutureRevisionResponse = {
  id: "future",
  organizationId: "org",
  projectId: "project",
  targetEntityType: "TASK",
  targetEntityId: "target",
  revision: 1,
  outcome: "STAGED",
  originatingProposalId: "original",
  latestProposalId: "original",
  baseline: { kind: "LIVE", revision: "live-1", content },
  result: content,
  dependencies: [],
  history: [],
  outstandingRefinementProposalIds: ["refinement"],
  completionEligibility: { eligible: true, blockers: [] },
};
const proposal: ProposalResponseDto = {
  id: "original",
  organizationId: "org",
  projectId: "project",
  type: ProposalType.Single,
  action: ProposalAction.VersionedUpdate,
  status: ProposalStatus.Approved,
  targetEntityId: "target",
  targetEntityType: TargetEntityType.Task,
  updates: {
    operation: "REVISE",
    futureId: "future",
    expectedRevision: 0,
    baseline: future.baseline,
    result: content,
    dependencies: [],
  },
  reviewedFuture: future,
  requestorId: "user",
  requiredApprovals: 1,
  approvals: [],
  createdAt: "2026-09-27T00:00:00Z",
  updatedAt: "2026-09-27T00:00:00Z",
};
const refinement: ProposalResponseDto = {
  ...proposal,
  id: "refinement",
  status: ProposalStatus.Draft,
  updates: {
    operation: "REVISE",
    futureId: "future",
    expectedRevision: 1,
    baseline: future.baseline,
    result: { ...content, name: "Pending change" },
    dependencies: [],
  },
};
const response = <T,>(data: T) => ({ data: { data } });

function setReviewedFuture(reviewedFuture: FutureRevisionResponse | null) {
  const reviewedProposal = { ...proposal, reviewedFuture };
  const reviewedRefinement = { ...refinement, reviewedFuture };
  client.getProposal.mockResolvedValue(response(reviewedProposal));
  client.listProposals.mockResolvedValue(
    response({
      data: [reviewedProposal, reviewedRefinement],
      total: 2,
    }),
  );
  client.getProposalGroup.mockResolvedValue(
    response({
      groupId: "group",
      organizationId: "org",
      projectId: "project",
      dependencies: [],
      members: [{ memberId: "member", proposal: reviewedRefinement }],
    }),
  );
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
let queryClient = new QueryClient();

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  setReviewedFuture(future);
});

describe("proposal review read wiring", () => {
  it("keeps completion-dependency queries distinct and forwards the backend filter", async () => {
    const { result } = renderHook(
      () => ({
        first: useProposals("org", "project", {
          completionDependencyId: "first-work",
        }),
        second: useProposals("org", "project", {
          completionDependencyId: "second-work",
        }),
      }),
      { wrapper },
    );
    await waitFor(
      () =>
        expect(
          result.current.first.isReady && result.current.second.isReady,
        ).toBe(true),
      { timeout: 5000 },
    );
    expect(client.listProposals).toHaveBeenCalledWith(
      expect.objectContaining({ completionDependencyId: "first-work" }),
      expect.anything(),
    );
    expect(client.listProposals).toHaveBeenCalledWith(
      expect.objectContaining({ completionDependencyId: "second-work" }),
      expect.anything(),
    );
  });
  it("carries initial and confirmed Apply responses and refreshes every review projection", async () => {
    const { result } = renderHook(
      () => ({
        single: useProposal("org", "project", "original"),
        related: useProposals("org", "project"),
        group: useProposalGroup("org", "project", "group"),
        apply: useApplyProposalFuture(),
      }),
      { wrapper },
    );
    await waitFor(
      () =>
        expect(
          result.current.single.isReady &&
            result.current.related.isReady &&
            result.current.group.isReady,
        ).toBe(true),
      { timeout: 5000 },
    );
    const request = {
      organizationId: "org",
      projectId: "project",
      futureId: "future",
      futureApplyRequest: { expectedRevision: 1 },
    };
    const confirmation = {
      revision: 1,
      refinements: [
        { proposalId: "refinement", updatedAt: "2026-09-27T00:00:00Z" },
      ],
    };
    const warning: FutureApplyResponse = {
      status: "CONFIRMATION_REQUIRED",
      future,
      confirmation,
    };
    let resolveApply!: (
      value: ReturnType<typeof response<FutureApplyResponse>>,
    ) => void;
    client.applyProposalFuture.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveApply = resolve;
        }),
    );
    let pending!: Promise<FutureApplyResponse>;
    act(() => {
      pending = result.current.apply.mutate(request);
    });
    expect(result.current.apply.isPending).toBe(true);
    await act(async () => {
      resolveApply(response(warning));
      expect(await pending).toEqual(warning);
    });
    expect(result.current.apply.isPending).toBe(false);
    expect(result.current.single.proposal?.reviewedFuture?.outcome).toBe(
      "STAGED",
    );
    const changedConfirmation = {
      ...confirmation,
      refinements: [
        { ...confirmation.refinements[0], updatedAt: "2026-09-28T00:00:00Z" },
      ],
    };
    client.applyProposalFuture.mockResolvedValueOnce(
      response({ ...warning, confirmation: changedConfirmation }),
    );
    await act(async () => {
      expect(
        await result.current.apply.mutate({
          ...request,
          futureApplyRequest: { expectedRevision: 1, confirmation },
        }),
      ).toEqual({ ...warning, confirmation: changedConfirmation });
    });
    const applied: FutureRevisionResponse = {
      ...future,
      outcome: "APPLIED",
      outstandingRefinementProposalIds: [],
      appliedRevision: 1,
    };
    setReviewedFuture(applied);
    client.applyProposalFuture.mockResolvedValueOnce(
      response({ status: "APPLIED", future: applied }),
    );
    await act(async () => {
      expect(
        (
          await result.current.apply.mutate({
            ...request,
            futureApplyRequest: {
              expectedRevision: 1,
              confirmation: changedConfirmation,
            },
          })
        ).status,
      ).toBe("APPLIED");
    });
    await waitFor(() => {
      expect(result.current.single.proposal?.reviewedFuture).toEqual(applied);
      expect(result.current.related.data[0].reviewedFuture).toEqual(applied);
      expect(
        result.current.group.proposalGroup?.members[0].proposal.reviewedFuture,
      ).toEqual(applied);
    });
    client.applyProposalFuture.mockResolvedValueOnce(response(warning));
    await act(async () => {
      await result.current.apply.mutate(request);
    });
    expect(client.applyProposalFuture).toHaveBeenLastCalledWith(request);
    expect(client.applyProposalFuture).toHaveBeenNthCalledWith(3, {
      ...request,
      futureApplyRequest: {
        expectedRevision: 1,
        confirmation: changedConfirmation,
      },
    });
  });

  it.each(["blocked", "failure", "missing"] as const)(
    "refreshes authoritative data after an Apply %s",
    async (kind) => {
      const { result } = renderHook(
        () => ({
          single: useProposal("org", "project", "original"),
          apply: useApplyProposalFuture(),
        }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.single.isReady).toBe(true), {
        timeout: 5000,
      });
      const changed = { ...future, revision: 2 };
      setReviewedFuture(changed);
      const blocked: FutureApplyResponse = {
        status: "BLOCKED",
        blocker: "REVISION_CHANGED",
        future: changed,
      };
      if (kind === "failure")
        client.applyProposalFuture.mockRejectedValueOnce(
          new Error("Apply failed"),
        );
      else
        client.applyProposalFuture.mockResolvedValueOnce(
          response(kind === "missing" ? undefined : blocked),
        );
      await act(async () => {
        const pending = result.current.apply.mutate({
          organizationId: "org",
          projectId: "project",
          futureId: "future",
          futureApplyRequest: { expectedRevision: 1 },
        });
        if (kind === "blocked") expect(await pending).toEqual(blocked);
        else
          await expect(pending).rejects.toThrow(
            kind === "failure" ? "Apply failed" : "without a result",
          );
      });
      await waitFor(() =>
        expect(result.current.single.proposal?.reviewedFuture).toEqual(changed),
      );
      expect(result.current.apply.isError).toBe(kind !== "blocked");
    },
  );

  it.each(["approve", "reject", "failure"] as const)(
    "refreshes all loaded review projections after %s",
    async (decision) => {
      const { result } = renderHook(
        () => {
          const single = useProposal("org", "project", "original");
          const related = useProposals("org", "project", {
            targetEntityId: "target",
          });
          const group = useProposalGroup("org", "project", "group");
          const decisions = useProposalGroupDecisions({
            organizationId: "org",
            projectId: "project",
            groupId: "group",
            refetch: group.refetch,
          });
          return { single, related, group, decisions };
        },
        { wrapper },
      );
      await waitFor(
        () =>
          expect(
            result.current.single.isReady &&
              result.current.related.isReady &&
              result.current.group.isReady,
          ).toBe(true),
        { timeout: 5000 },
      );
      const refreshed = {
        ...future,
        revision: 2,
        outstandingRefinementProposalIds: [],
      };
      setReviewedFuture(refreshed);
      client.updateProposal.mockResolvedValue(response(proposal));
      client.rejectProposal.mockResolvedValue(response({ proposal }));
      if (decision === "failure")
        client.updateProposal.mockRejectedValue(new Error("Decision failed"));
      await act(async () => {
        if (decision === "reject")
          await result.current.decisions.rejectMember("refinement", "Declined");
        else if (decision === "failure")
          await expect(
            result.current.decisions.approveMember("refinement"),
          ).rejects.toThrow("Decision failed");
        else await result.current.decisions.approveMember("refinement");
      });
      await waitFor(
        () => {
          expect(result.current.single.proposal?.reviewedFuture).toEqual(
            refreshed,
          );
          expect(result.current.related.data[0].reviewedFuture).toEqual(
            refreshed,
          );
          expect(
            result.current.group.proposalGroup?.members[0].proposal
              .reviewedFuture,
          ).toEqual(refreshed);
        },
        { timeout: 5000 },
      );
    },
  );

  it("does not fetch disabled review queries", async () => {
    renderHook(() => useProposal(undefined, "project", "original"), {
      wrapper,
    });
    expect(client.getProposal).not.toHaveBeenCalled();
    expect(client.getProposalFuture).not.toHaveBeenCalled();
  });

  it("exposes the approved complete projection separately from pending updates", async () => {
    const { result } = renderHook(
      () => useProposals("org", "project", { targetEntityId: "target" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isReady).toBe(true), {
      timeout: 5000,
    });
    expect(result.current.data.map((item) => item.reviewedFuture)).toEqual([
      future,
      future,
    ]);
    expect(result.current.data[1].updates).toEqual(refinement.updates);
    expect(client.getProposalFuture).not.toHaveBeenCalled();
    expect(client.listProposals).toHaveBeenCalledWith(
      expect.objectContaining({ targetEntityId: "target" }),
      expect.anything(),
    );
  });

  it("refreshes eligibility, approved content, refinements and outcome together without changing approval", async () => {
    const { result } = renderHook(
      () => useProposal("org", "project", "original"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isReady).toBe(true), {
      timeout: 5000,
    });
    expect(
      result.current.proposal?.reviewedFuture?.completionEligibility,
    ).toEqual({ eligible: true, blockers: [] });
    const dependency = {
      edgeType: "DEPENDS_ON",
      targetEntityType: "TASK",
      targetEntityId: "dependency",
    } as const;
    const blocked: FutureRevisionResponse = {
      ...future,
      dependencies: [dependency],
      completionEligibility: {
        eligible: false,
        blockers: [
          { dependency, reason: "INCOMPLETE", status: WorkStatus.Verifying },
        ],
      },
    };
    setReviewedFuture(blocked);
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() =>
      expect(result.current.proposal?.reviewedFuture).toEqual(blocked),
    );
    expect(result.current.proposal?.status).toBe(ProposalStatus.Approved);
    const applied: FutureRevisionResponse = {
      ...future,
      revision: 2,
      outcome: "APPLIED",
      result: { ...content, name: "New approved result" },
      outstandingRefinementProposalIds: [],
    };
    setReviewedFuture(applied);
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() =>
      expect(result.current.proposal?.reviewedFuture).toEqual(applied),
    );
  });

  it("hydrates grouped members with the same independent reviewed future", async () => {
    const { result } = renderHook(
      () => useProposalGroup("org", "project", "group"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isReady).toBe(true), {
      timeout: 5000,
    });
    expect(
      result.current.proposalGroup?.members[0].proposal.reviewedFuture,
    ).toEqual(future);
    expect(result.current.proposalGroup?.members[0].proposal.status).toBe(
      ProposalStatus.Draft,
    );
    setReviewedFuture({ ...future, outstandingRefinementProposalIds: [] });
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() =>
      expect(
        result.current.proposalGroup?.members[0].proposal.reviewedFuture
          ?.outstandingRefinementProposalIds,
      ).toEqual([]),
    );
  });

  it("uses the generated proposal response as the complete review read", async () => {
    const { result } = renderHook(
      () => useProposal("org", "project", "original"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isReady).toBe(true), {
      timeout: 5000,
    });
    expect(result.current.proposal?.reviewedFuture).toEqual(future);
    expect(client.getProposalFuture).not.toHaveBeenCalled();
  });

  it("keeps ordinary proposal review futures null without a future request", async () => {
    client.getProposal.mockResolvedValue(
      response({
        ...proposal,
        action: ProposalAction.Update,
        reviewedFuture: null,
      }),
    );
    const { result } = renderHook(
      () => useProposal("org", "project", "ordinary"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isReady).toBe(true), {
      timeout: 5000,
    });
    expect(result.current.proposal?.reviewedFuture).toBeNull();
    expect(client.getProposalFuture).not.toHaveBeenCalled();
  });

  it("accepts a null future for an unstaged first-revision draft", async () => {
    client.getProposal.mockResolvedValue(
      response({
        ...proposal,
        status: ProposalStatus.Draft,
        reviewedFuture: null,
      }),
    );
    const { result } = renderHook(
      () => useProposal("org", "project", "original"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isReady).toBe(true), {
      timeout: 5000,
    });
    expect(result.current.proposal?.reviewedFuture).toBeNull();
    expect(client.getProposalFuture).not.toHaveBeenCalled();
  });
});
