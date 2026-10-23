import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalGroupLifecycle,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
  type ProposalGroupSnapshot,
} from "../../../api";
import { proposalKeys } from "../../collections/proposals";
import { useProposal } from "../useProposal";
import { useProposals } from "../useProposals";
import { useProposalGroup } from "../useProposalGroup";
import { useProposalGroupDecisions } from "../useProposalGroupDecisions";
import { WebSocketHandler } from "../../websockets/handler";
import { invalidateAllDataLayerQueries } from "../../query/dataLayerInvalidation";

const mocks = vi.hoisted(() => ({
  getProposal: vi.fn(),
  listProposals: vi.fn(),
  getProposalGroup: vi.fn(),
  updateProposal: vi.fn(),
  rejectProposal: vi.fn(),
  approveAllProposalGroupMembers: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", async (original) => ({
  ...(await original<object>()),
  proposalsClient: mocks,
}));
const proposal: ProposalResponseDto = {
  id: "proposal-1",
  organizationId: "org-1",
  projectId: "project-1",
  type: ProposalType.Single,
  action: ProposalAction.Update,
  status: ProposalStatus.Draft,
  targetEntityId: "target-1",
  targetEntityType: TargetEntityType.Task,
  title: "Update proposal",
  updates: {},
  requestorId: "user-1",
  requiredApprovals: 1,
  approvals: [],
  createdAt: "2026-07-27T00:00:00Z",
  updatedAt: "2026-07-27T00:00:00Z",
};
const group: ProposalGroupSnapshot = {
  groupId: "group-1",
  organizationId: "org-1",
  projectId: "project-1",
  lifecycle: ProposalGroupLifecycle.Reviewable,
  currentRevision: 3,
  frozenRevision: 3,
  members: [],
  dependencies: [],
  createdAt: "2026-07-27T00:00:00Z",
  updatedAt: "2026-07-27T00:00:00Z",
};
const ok = <T,>(data: T) => ({ data: { data } });
const setup = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
};
const event = {
  type: "proposal_group.lifecycle" as const,
  timestamp: "2026-07-27T00:00:00Z",
  organizationId: "org-1",
  projectId: "project-1",
  groupId: "group-1",
  revision: 4,
  changedMemberIds: new Set(["member-1"]),
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getProposal.mockResolvedValue(ok(proposal));
  mocks.listProposals.mockResolvedValue(
    ok({ data: [proposal], total: 35, limit: 20, offset: 0 }),
  );
  mocks.getProposalGroup.mockResolvedValue(ok(group));
  mocks.updateProposal.mockResolvedValue(
    ok({ ...proposal, status: ProposalStatus.Approved }),
  );
  mocks.rejectProposal.mockResolvedValue(
    ok({ proposal: { ...proposal, status: ProposalStatus.Rejected } }),
  );
  mocks.approveAllProposalGroupMembers.mockResolvedValue(
    ok({
      groupId: "group-1",
      revision: 4,
      results: [{ proposalId: "proposal-1" }],
    }),
  );
});

describe("TanStack proposal reads", () => {
  it("shares in-flight detail, list and group reads and reuses fresh data on remount", async () => {
    const { client, wrapper } = setup();
    const useReads = () => ({
      detail: useProposal("org-1", "project-1", "proposal-1"),
      duplicateDetail: useProposal("org-1", "project-1", "proposal-1"),
      list: useProposals("org-1", "project-1"),
      duplicateList: useProposals("org-1", "project-1"),
      group: useProposalGroup("org-1", "project-1", "group-1"),
      duplicateGroup: useProposalGroup("org-1", "project-1", "group-1"),
    });
    const first = renderHook(useReads, { wrapper });
    await waitFor(() => expect(first.result.current.group.isReady).toBe(true));
    expect(first.result.current.detail.proposal).toEqual(proposal);
    expect(first.result.current.list.pagination).toMatchObject({
      total: 35,
      totalPages: 2,
      hasNext: true,
    });
    expect(mocks.getProposal).toHaveBeenCalledTimes(1);
    expect(mocks.listProposals).toHaveBeenCalledTimes(1);
    expect(mocks.getProposalGroup).toHaveBeenCalledTimes(1);
    first.unmount();
    const second = renderHook(useReads, { wrapper });
    expect(second.result.current.group.isReady).toBe(true);
    expect(mocks.getProposal).toHaveBeenCalledTimes(1);
    expect(mocks.listProposals).toHaveBeenCalledTimes(1);
    expect(mocks.getProposalGroup).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it("keeps server filters and pagination distinct, with rows and pagination in the same cache entry", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({
        draft: useProposals("org-1", "project-1", {
          status: ProposalStatus.Draft,
          targetEntityId: "target-1",
          windowStart: "start",
          workItemRole: undefined,
        }),
        approved: useProposals("org-1", "project-1", {
          status: ProposalStatus.Approved,
          offset: 20,
        }),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.approved.isReady).toBe(true));
    expect(mocks.listProposals).toHaveBeenCalledTimes(2);
    expect(mocks.listProposals).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ProposalStatus.Draft,
        targetEntityId: "target-1",
        windowStart: "start",
        limit: 20,
        offset: 0,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("a central lifecycle event refreshes exactly the matching group once for all observers", async () => {
    const { client, wrapper } = setup();
    const handler = new WebSocketHandler(createStore(), undefined, client);
    const { result } = renderHook(
      () => ({
        group: useProposalGroup("org-1", "project-1", "group-1"),
        duplicate: useProposalGroup("org-1", "project-1", "group-1"),
        other: useProposalGroup("org-1", "project-1", "other"),
        proposal: useProposal("org-1", "project-1", "proposal-1"),
        list: useProposals("org-1", "project-1"),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.other.isReady).toBe(true));
    mocks.getProposalGroup.mockClear();
    await act(async () => handler.handleEvent(event));
    await waitFor(() =>
      expect(mocks.getProposalGroup).toHaveBeenCalledTimes(1),
    );
    expect(mocks.getProposalGroup.mock.calls[0][0]).toMatchObject({
      groupId: "group-1",
    });
    expect(mocks.getProposal).toHaveBeenCalledTimes(1);
    expect(mocks.listProposals).toHaveBeenCalledTimes(1);
    await act(async () =>
      handler.handleEvent({ ...event, organizationId: "another-org" }),
    );
    await act(async () =>
      handler.handleEvent({ ...event, projectId: "another-project" }),
    );
    expect(mocks.getProposalGroup).toHaveBeenCalledTimes(1);
  });

  it.each(["approve", "reject", "all"] as const)(
    "refreshes affected mounted keys once after %s and retains other scopes",
    async (operation) => {
      const { client, wrapper } = setup();
      const refetch = vi.fn();
      const { result } = renderHook(
        () => ({
          group: useProposalGroup("org-1", "project-1", "group-1"),
          detail: useProposal("org-1", "project-1", "proposal-1"),
          detailDuplicate: useProposal("org-1", "project-1", "proposal-1"),
          unrelatedDetail: useProposal("org-1", "project-1", "other-proposal"),
          list: useProposals("org-1", "project-1"),
          filtered: useProposals("org-1", "project-1", {
            status: ProposalStatus.Draft,
          }),
          otherList: useProposals("org-1", "other-project"),
          decisions: useProposalGroupDecisions({
            organizationId: "org-1",
            projectId: "project-1",
            groupId: "group-1",
            refetch,
          }),
        }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.otherList.isReady).toBe(true));
      mocks.getProposal.mockClear();
      mocks.listProposals.mockClear();
      mocks.getProposalGroup.mockClear();
      await act(async () => {
        if (operation === "approve")
          await result.current.decisions.approveMember("proposal-1");
        if (operation === "reject")
          await result.current.decisions.rejectMember(
            "proposal-1",
            "Scope conflict",
          );
        if (operation === "all") await result.current.decisions.approveAll();
      });
      expect(mocks.getProposalGroup).toHaveBeenCalledTimes(1);
      // A decision can change every proposal projecting the same future, so every
      // mounted detail in the project refreshes once; other projects are retained.
      expect(mocks.getProposal).toHaveBeenCalledTimes(2);
      expect(
        mocks.getProposal.mock.calls
          .map(([request]) => request.proposalId)
          .sort(),
      ).toEqual(["other-proposal", "proposal-1"]);
      expect(mocks.listProposals).toHaveBeenCalledTimes(2);
      expect(refetch).not.toHaveBeenCalled();
      expect(
        client.getQueryData(
          proposalKeys.detail("org-1", "project-1", "proposal-1"),
        ),
      ).toBeDefined();
    },
  );

  it("reports disabled, pending, successful empty and failed reads explicitly", async () => {
    const { wrapper } = setup();
    let resolve:
      | ((value: ReturnType<typeof ok<ProposalResponseDto | null>>) => void)
      | undefined;
    mocks.getProposal.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useProposal("org-1", "project-1", "proposal-1", { enabled }),
      { wrapper, initialProps: { enabled: false } },
    );
    expect(result.current).toMatchObject({
      proposal: null,
      isFetched: false,
      isReady: false,
      error: null,
    });
    expect(mocks.getProposal).not.toHaveBeenCalled();
    rerender({ enabled: true });
    expect(result.current).toMatchObject({
      isLoading: true,
      isFetched: false,
      error: null,
    });
    await act(async () => resolve?.(ok(null)));
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.proposal).toBeNull();
    mocks.getProposal.mockRejectedValueOnce(
      Object.assign(new Error("Not found"), { status: 404 }),
    );
    await act(async () => {
      await expect(result.current.refetch()).rejects.toThrow("Not found");
    });
    await waitFor(() =>
      expect(result.current.error?.message).toBe("Not found"),
    );
    expect(result.current.isReady).toBe(false);
  });

  it("reconnect refreshes mounted proposal datasets once and leaves unmounted entries stale", async () => {
    const { client, wrapper } = setup();
    client.setQueryData(
      proposalKeys.group("org-1", "project-1", "unmounted"),
      group,
    );
    const { result } = renderHook(
      () => ({
        group: useProposalGroup("org-1", "project-1", "group-1"),
        detail: useProposal("org-1", "project-1", "proposal-1"),
        list: useProposals("org-1", "project-1"),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.isReady).toBe(true));
    await act(async () => invalidateAllDataLayerQueries(client));
    expect(mocks.getProposal).toHaveBeenCalledTimes(2);
    expect(mocks.getProposalGroup).toHaveBeenCalledTimes(2);
    expect(mocks.listProposals).toHaveBeenCalledTimes(2);
    expect(
      client.getQueryState(
        proposalKeys.group("org-1", "project-1", "unmounted"),
      )?.isInvalidated,
    ).toBe(true);
  });
  it("starts a follow-up group read when a lifecycle event arrives during its first read", async () => {
    const { client, wrapper } = setup();
    let resolveFirst:
      | ((value: ReturnType<typeof ok<ProposalGroupSnapshot>>) => void)
      | undefined;
    mocks.getProposalGroup.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { result } = renderHook(
      () => useProposalGroup("org-1", "project-1", "group-1"),
      { wrapper },
    );
    expect(result.current.isLoading).toBe(true);
    const changed = { ...group, currentRevision: 4 };
    mocks.getProposalGroup.mockResolvedValue(ok(changed));
    const handler = new WebSocketHandler(createStore(), undefined, client);
    await act(async () => handler.handleEvent(event));
    await waitFor(() =>
      expect(result.current.proposalGroup?.currentRevision).toBe(4),
    );
    expect(mocks.getProposalGroup).toHaveBeenCalledTimes(2);
    await act(async () => resolveFirst?.(ok(group)));
    expect(result.current.proposalGroup?.currentRevision).toBe(4);
  });

  it("holds member pending state through the decision and clears it after a defined failure and refresh", async () => {
    const { wrapper } = setup();
    let rejectDecision: ((error: Error) => void) | undefined;
    mocks.updateProposal.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectDecision = reject;
        }),
    );
    const { result } = renderHook(
      () => ({
        group: useProposalGroup("org-1", "project-1", "group-1"),
        decisions: useProposalGroupDecisions({
          organizationId: "org-1",
          projectId: "project-1",
          groupId: "group-1",
          refetch: vi.fn(),
        }),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.group.isReady).toBe(true));
    let decision: Promise<unknown> | undefined;
    act(() => {
      decision = result.current.decisions
        .approveMember("proposal-1")
        .catch((error) => error);
    });
    expect(result.current.decisions.decidingProposalIds.has("proposal-1")).toBe(
      true,
    );
    expect(result.current.decisions.error).toBeNull();
    await act(async () => {
      rejectDecision?.(new Error("Decision failed"));
      await decision;
    });
    expect(result.current.decisions.decidingProposalIds.size).toBe(0);
    expect(result.current.decisions.error?.message).toBe("Decision failed");
    expect(mocks.getProposalGroup).toHaveBeenCalledTimes(2);
    await act(async () => {
      await result.current.decisions.approveMember("proposal-1");
    });
    expect(result.current.decisions.error).toBeNull();
    expect(
      result.current.decisions.decisionProposals.get("proposal-1")?.status,
    ).toBe(ProposalStatus.Approved);
  });

  it("preserves approve-all pending state, its result and its error recovery", async () => {
    const { wrapper } = setup();
    let rejectDecision: ((error: Error) => void) | undefined;
    mocks.approveAllProposalGroupMembers.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectDecision = reject;
        }),
    );
    const { result } = renderHook(
      () =>
        useProposalGroupDecisions({
          organizationId: "org-1",
          projectId: "project-1",
          groupId: "group-1",
          refetch: vi.fn(),
        }),
      { wrapper },
    );
    let decision: Promise<unknown> | undefined;
    act(() => {
      decision = result.current.approveAll().catch((error) => error);
    });
    expect(result.current.isApprovingAll).toBe(true);
    await act(async () => {
      rejectDecision?.(new Error("Offline"));
      await decision;
    });
    expect(result.current.isApprovingAll).toBe(false);
    expect(result.current.error?.message).toBe("Offline");
    await act(async () => {
      await result.current.approveAll();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.approveAllResult?.revision).toBe(4);
    act(() => result.current.clearApproveAllResult());
    expect(result.current.approveAllResult).toBeNull();
  });
});
