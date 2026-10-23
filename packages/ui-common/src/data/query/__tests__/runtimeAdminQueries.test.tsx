import { clearAuthToken, setAuthToken } from "../../../services/authService";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUserWorkflows } from "../../hooks/useUserWorkflows";
import { useAdminOrganizationDetail } from "../../hooks/useAdminOrganizationDetail";
import { useAdminOrganizationMembers } from "../../hooks/useAdminOrganizationMembers";
import { useControllerInventory } from "../../hooks/useControllerInventory";
import { useRevokeController } from "../../hooks/useRevokeController";
import { useOutboxEvents } from "../../hooks/useOutboxEvents";
import { useLlmRequestStatus } from "../../hooks/useLlmRequestStatus";
import { usePrivateBetaAccessRequest } from "../../hooks/usePrivateBetaAccessRequest";
import { usePrivateBetaAccessRequests } from "../../hooks/usePrivateBetaAccessRequests";
import { usePrivateBetaAdmissionMode } from "../../hooks/usePrivateBetaAdmissionMode";
import { WebSocketHandler } from "../../websockets/handler";
import { controllerInventoryKeys } from "../../collections/controllerInventory";
import { dataLayerQueryRoots } from "../dataLayerInvalidation";
import type {
  AdminOrganizationDetailDto,
  AdminOrganizationMembersPageDto,
  ControllerInventoryResponseDto,
} from "../../../api";

const mocks = vi.hoisted(() => ({
  workflows: vi.fn(),
  detail: vi.fn(),
  members: vi.fn(),
  inventory: vi.fn(),
  revoke: vi.fn(),
  outbox: vi.fn(),
  llm: vi.fn(),
  betaDetail: vi.fn(),
  betaList: vi.fn(),
  admission: vi.fn(),
}));
vi.mock("../../../clients", async (original) => ({
  ...(await original<object>()),
  dataClient: { request: mocks.workflows },
}));
vi.mock("../../../clients/serviceClients", async (original) => ({
  ...(await original<object>()),
  unifiedApiClient: {
    getAdminOrganizationDetail: mocks.detail,
    listAdminOrganizationMembers: mocks.members,
    getLLMRequestStatus: mocks.llm,
    getPrivateBetaAccessRequestReview: mocks.betaDetail,
    listPrivateBetaAccessRequestReviews: mocks.betaList,
    getPrivateBetaSelfServiceAdmissionMode: mocks.admission,
  },
  machinesClient: {
    listMachineControllers: mocks.inventory,
    revokeMachineController: mocks.revoke,
  },
  eventsClient: { getEntityOutboxEventsDebug: mocks.outbox },
}));

const inventory: ControllerInventoryResponseDto = {
  machineId: "machine",
  authorizationProtocolVersion: 2,
  enrollmentState: "READY",
  executionReadiness: "READY",
  controllers: [],
};
const detail: AdminOrganizationDetailDto = {
  organization: {
    id: "org",
    name: "Engines",
    createdAt: "2026-10-01T00:00:00Z",
    memberCount: 1,
    projectCount: 0,
  },
  entitlement: {
    subscriptionType: "BETA",
    accessStatus: "ACTIVE",
    revision: 1,
    accessThroughAt: null,
    paidThroughAt: null,
    effectiveAccessThroughAt: null,
  },
  evidence: {
    workItemsCreatedAllTime: 0,
    agentSessionsCreatedAllTime: 0,
    latestAgentSessionActivityAt: null,
    workItemsByType: [],
  },
  latestAgentSessions: [],
};
const members: AdminOrganizationMembersPageDto = {
  members: [
    {
      userId: "user",
      name: "Ada",
      email: "ada@example.com",
      organizationRole: "ADMIN",
      projectCount: 2,
      lastActiveAt: null,
    },
  ],
  totalCount: 1,
  nextCursor: null,
};
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    wrapper,
    handler: new WebSocketHandler(createStore(), undefined, client),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.workflows.mockResolvedValue({
    data: { data: { workflows: [], nextPageToken: null } },
  });
  mocks.detail.mockResolvedValue({ data: { data: detail } });
  mocks.members.mockResolvedValue({ data: { data: members } });
  mocks.inventory.mockResolvedValue({ data: { data: inventory } });
  mocks.revoke.mockResolvedValue({ data: { data: { outcome: "REVOKED" } } });
  mocks.outbox.mockResolvedValue({
    data: {
      data: { entityType: "task", entityId: "item", count: 0, events: [] },
    },
  });
  mocks.llm.mockResolvedValue({ data: { data: null } });
  mocks.betaDetail.mockResolvedValue({ data: { data: null } });
  mocks.betaList.mockResolvedValue({ data: { data: [] } });
  mocks.admission.mockResolvedValue({
    data: {
      data: {
        mode: "OPEN",
        updatedAt: "2026-10-01T00:00:00Z",
        updatedByUserId: null,
      },
    },
  });
});

describe("runtime and admin query integration", () => {
  it("shares all eight datasets across consumers and fresh remounts; reconnect reads only active keys", async () => {
    const { client, wrapper, handler } = setup();
    const read = () => [
      useUserWorkflows("org"),
      useOutboxEvents("task", "item"),
      useLlmRequestStatus("request"),
      useControllerInventory("machine"),
      usePrivateBetaAccessRequest("beta"),
      usePrivateBetaAccessRequests(),
      usePrivateBetaAdmissionMode(),
      useAdminOrganizationMembers({ organizationId: "org" }),
      useAdminOrganizationDetail({ organizationId: "org" }),
    ];
    const first = renderHook(read, { wrapper });
    const second = renderHook(read, { wrapper });
    await waitFor(() =>
      expect(first.result.current.every((value) => value.isFetched)).toBe(true)
    );
    for (const mock of [
      mocks.workflows,
      mocks.outbox,
      mocks.llm,
      mocks.inventory,
      mocks.betaDetail,
      mocks.betaList,
      mocks.admission,
      mocks.members,
      mocks.detail,
    ])
      expect(mock).toHaveBeenCalledTimes(1);
    first.unmount();
    second.unmount();
    const next = renderHook(read, { wrapper });
    expect(next.result.current.every((value) => value.isFetched)).toBe(true);
    client.setQueryData(controllerInventoryKeys.detail("inactive"), inventory);
    act(() => handler.markAllStale());
    await waitFor(() => {
      for (const mock of [
        mocks.workflows,
        mocks.outbox,
        mocks.llm,
        mocks.inventory,
        mocks.betaDetail,
        mocks.betaList,
        mocks.admission,
        mocks.members,
        mocks.detail,
      ])
        expect(mock).toHaveBeenCalledTimes(2);
    });
    expect(
      client.getQueryState(controllerInventoryKeys.detail("inactive"))
        ?.isInvalidated
    ).toBe(true);
    for (const root of [
      "userWorkflows",
      "outboxEvents",
      "llmRequestStatus",
      "controllerInventory",
      "privateBetaAccessRequests",
      "privateBetaAdmissionMode",
      "adminOrganizationMembers",
      "adminOrganizationDetail",
    ])
      expect(dataLayerQueryRoots()).toContainEqual([root]);
    next.unmount();
    client.clear();
  });

  it("normalizes equivalent workflow parameters and separates different server responses", async () => {
    const { client, wrapper } = setup();
    const view = renderHook(
      () => ({
        first: useUserWorkflows("org", {
          limit: 500,
          workflowType: " coding ",
        }),
        second: useUserWorkflows("org", { limit: 200, workflowType: "coding" }),
        page: useUserWorkflows("org", {
          limit: 200,
          workflowType: "coding",
          nextPageToken: "next",
        }),
      }),
      { wrapper }
    );
    await waitFor(() =>
      expect(
        view.result.current.page.isReady && view.result.current.first.isReady
      ).toBe(true)
    );
    expect(mocks.workflows).toHaveBeenCalledTimes(2);
    expect(mocks.workflows).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/organizations/org/workflows",
        signal: expect.any(AbortSignal),
        params: expect.objectContaining({
          limit: 200,
          workflowType: "coding",
          nextPageToken: "next",
        }),
      })
    );
    view.unmount();
    client.clear();
  });

  it("separates admin member pages and hides protected data after a denied refresh", async () => {
    const { client, wrapper } = setup();
    const view = renderHook(
      () => ({
        first: useAdminOrganizationMembers({
          organizationId: "org",
          name: " Ada ",
        }),
        second: useAdminOrganizationMembers({
          organizationId: "org",
          name: "Ada",
        }),
        page: useAdminOrganizationMembers({
          organizationId: "org",
          name: "Ada",
          cursor: "next",
        }),
        detail: useAdminOrganizationDetail({ organizationId: "org" }),
      }),
      { wrapper }
    );
    await waitFor(() =>
      expect(
        view.result.current.detail.isReady && view.result.current.page.isReady
      ).toBe(true)
    );
    expect(mocks.members).toHaveBeenCalledTimes(2);
    expect(view.result.current.first.members).toEqual(members.members);
    mocks.members.mockRejectedValue(
      Object.assign(new Error("forbidden"), { status: 403 })
    );
    mocks.detail.mockRejectedValue(
      Object.assign(new Error("forbidden"), { status: 403 })
    );
    await act(async () => {
      await expect(view.result.current.first.refetch()).rejects.toThrow(
        "forbidden"
      );
      await expect(view.result.current.detail.refetch()).rejects.toThrow(
        "forbidden"
      );
    });
    await waitFor(() =>
      expect(view.result.current.second.isForbidden).toBe(true)
    );
    expect(view.result.current.first.page).toBeNull();
    expect(view.result.current.first.members).toEqual([]);
    expect(view.result.current.detail.data).toBeNull();
    expect(view.result.current.detail.isReady).toBe(false);
    expect(view.result.current.page.members).toEqual(members.members);
    expect(mocks.members).toHaveBeenCalledTimes(3);
    expect(mocks.detail).toHaveBeenCalledTimes(2);
    view.unmount();
    client.clear();
  });

  it("does not share protected admin records between QueryClients", async () => {
    const one = setup();
    const two = setup();
    const first = renderHook(
      () => useAdminOrganizationDetail({ organizationId: "org" }),
      { wrapper: one.wrapper }
    );
    await waitFor(() => expect(first.result.current.isReady).toBe(true));
    mocks.detail.mockRejectedValue(
      Object.assign(new Error("forbidden"), { status: 403 })
    );
    const second = renderHook(
      () => useAdminOrganizationDetail({ organizationId: "org" }),
      { wrapper: two.wrapper }
    );
    expect(second.result.current.data).toBeNull();
    await waitFor(() => expect(second.result.current.isForbidden).toBe(true));
    expect(first.result.current.data).toEqual(detail);
    first.unmount();
    second.unmount();
    one.client.clear();
    two.client.clear();
  });

  it("rotates admin cache scope on authorization changes and while readers are unmounted", async () => {
    const { client, wrapper } = setup();
    const read = () => ({
      detail: useAdminOrganizationDetail({ organizationId: "org" }),
      members: useAdminOrganizationMembers({ organizationId: "org" }),
    });
    const first = renderHook(read, { wrapper });
    await waitFor(() =>
      expect(
        first.result.current.detail.isReady &&
          first.result.current.members.isReady
      ).toBe(true)
    );
    const pending = deferred<{ data: { data: AdminOrganizationDetailDto } }>();
    mocks.detail.mockReturnValueOnce(pending.promise);
    act(() => setAuthToken("test-authority-one"));
    expect(first.result.current.detail.data).toBeNull();
    await act(async () => pending.resolve({ data: { data: detail } }));
    await waitFor(() => expect(first.result.current.detail.isReady).toBe(true));
    expect(mocks.detail).toHaveBeenCalledTimes(2);
    first.unmount();
    act(() => clearAuthToken());
    const next = renderHook(read, { wrapper });
    await waitFor(() =>
      expect(
        next.result.current.detail.isReady &&
          next.result.current.members.isReady
      ).toBe(true)
    );
    expect(mocks.detail).toHaveBeenCalledTimes(3);
    expect(mocks.members).toHaveBeenCalledTimes(3);
    next.unmount();
    client.clear();
  });

  it("hides admin data when disabled after an authorized read", async () => {
    const { client, wrapper } = setup();
    const view = renderHook(
      ({ enabled }) => ({
        detail: useAdminOrganizationDetail({ organizationId: "org", enabled }),
        members: useAdminOrganizationMembers({
          organizationId: "org",
          enabled,
        }),
      }),
      { wrapper, initialProps: { enabled: true } }
    );
    await waitFor(() =>
      expect(
        view.result.current.detail.isReady &&
          view.result.current.members.isReady
      ).toBe(true)
    );
    view.rerender({ enabled: false });
    expect(view.result.current.detail.data).toBeNull();
    expect(view.result.current.detail.isReady).toBe(false);
    expect(view.result.current.members.members).toEqual([]);
    expect(view.result.current.members.isReady).toBe(false);
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    expect(mocks.members).toHaveBeenCalledTimes(1);
    view.unmount();
    client.clear();
  });

  it("shares pending mounts but markStale starts a later read", async () => {
    const pending = deferred<{
      data: { data: ControllerInventoryResponseDto };
    }>();
    mocks.inventory.mockReturnValueOnce(pending.promise);
    const { client, wrapper } = setup();
    const first = renderHook(() => useControllerInventory("machine"), {
      wrapper,
    });
    const second = renderHook(() => useControllerInventory("machine"), {
      wrapper,
    });
    expect(first.result.current.isLoading).toBe(true);
    expect(first.result.current.error).toBeNull();
    expect(mocks.inventory).toHaveBeenCalledTimes(1);
    act(() => first.result.current.markStale());
    await waitFor(() => expect(second.result.current.data).toEqual(inventory));
    expect(mocks.inventory).toHaveBeenCalledTimes(2);
    await act(async () =>
      pending.resolve({
        data: {
          data: {
            ...inventory,
            executionReadiness: "CONTROLLER_ENROLLMENT_REQUIRED",
          },
        },
      })
    );
    expect(first.result.current.data).toEqual(inventory);
    first.unmount();
    second.unmount();
    client.clear();
  });

  it("controller revocation refreshes only the affected shared inventory and preserves data while pending", async () => {
    const { client, wrapper } = setup();
    const view = renderHook(
      () => ({
        first: useControllerInventory("machine"),
        second: useControllerInventory("machine"),
        other: useControllerInventory("other"),
        revoke: useRevokeController(),
      }),
      { wrapper }
    );
    await waitFor(() =>
      expect(
        view.result.current.other.isReady && view.result.current.first.isReady
      ).toBe(true)
    );
    const pending = deferred<{
      data: { data: ControllerInventoryResponseDto };
    }>();
    mocks.inventory.mockReturnValue(pending.promise);
    await act(async () => {
      await view.result.current.revoke.mutate({
        machineId: "machine",
        controllerCredentialId: "controller",
      });
    });
    await waitFor(() =>
      expect(view.result.current.second.isFetching).toBe(true)
    );
    expect(view.result.current.second.data).toEqual(inventory);
    expect(view.result.current.second.error).toBeNull();
    expect(mocks.inventory).toHaveBeenCalledTimes(3);
    const updated: ControllerInventoryResponseDto = {
      ...inventory,
      executionReadiness: "CONTROLLER_ENROLLMENT_REQUIRED",
    };
    await act(async () => pending.resolve({ data: { data: updated } }));
    await waitFor(() =>
      expect(view.result.current.second.data).toEqual(updated)
    );
    expect(view.result.current.other.data).toEqual(inventory);
    view.unmount();
    client.clear();
  });

  it("caches 4xx failures across fresh remounts and exposes a failed lifecycle", async () => {
    mocks.llm.mockRejectedValue(
      Object.assign(new Error("not found"), { status: 404 })
    );
    const { client, wrapper } = setup();
    const first = renderHook(() => useLlmRequestStatus("missing"), { wrapper });
    expect(first.result.current.error).toBeNull();
    expect(first.result.current.isReady).toBe(false);
    await waitFor(() =>
      expect(first.result.current.error?.message).toBe("not found")
    );
    expect(first.result.current.isFetched).toBe(true);
    expect(first.result.current.isReady).toBe(false);
    first.unmount();
    const next = renderHook(() => useLlmRequestStatus("missing"), { wrapper });
    expect(next.result.current.error?.message).toBe("not found");
    expect(mocks.llm).toHaveBeenCalledTimes(1);
    next.unmount();
    client.clear();
  });

  it("retains expired authoritative data while one maximum-age refresh is pending", async () => {
    const { client, wrapper } = setup();
    client.setQueryData(controllerInventoryKeys.detail("machine"), inventory, {
      updatedAt: Date.now() - 2000,
    });
    const pending = deferred<{
      data: { data: ControllerInventoryResponseDto };
    }>();
    mocks.inventory.mockReturnValue(pending.promise);
    const view = renderHook(
      () => useControllerInventory("machine", { maxCacheAgeMs: 1000 }),
      { wrapper }
    );
    const second = renderHook(
      () => useControllerInventory("machine", { maxCacheAgeMs: 1000 }),
      { wrapper }
    );
    expect(view.result.current.data).toEqual(inventory);
    expect(view.result.current.isFetching).toBe(true);
    expect(view.result.current.error).toBeNull();
    await waitFor(() => expect(mocks.inventory).toHaveBeenCalledTimes(1));
    const updated: ControllerInventoryResponseDto = {
      ...inventory,
      executionReadiness: "CONTROLLER_ENROLLMENT_REQUIRED",
    };
    await act(async () => pending.resolve({ data: { data: updated } }));
    await waitFor(() => expect(view.result.current.isFetching).toBe(false));
    expect(view.result.current.data).toEqual(updated);
    expect(mocks.inventory).toHaveBeenCalledTimes(1);
    view.unmount();
    second.unmount();
    client.clear();
  });

  it("keeps transient retries non-error until the read succeeds", async () => {
    mocks.llm.mockRejectedValueOnce(new Error("temporary failure"));
    const pending = deferred<{ data: { data: null } }>();
    mocks.llm.mockReturnValueOnce(pending.promise);
    const { client, wrapper } = setup();
    const view = renderHook(() => useLlmRequestStatus("request"), { wrapper });
    await waitFor(() => expect(mocks.llm).toHaveBeenCalledTimes(2));
    expect(view.result.current.error).toBeNull();
    expect(view.result.current.isReady).toBe(false);
    expect(view.result.current.isFetching).toBe(true);
    await act(async () => pending.resolve({ data: { data: null } }));
    await waitFor(() => expect(view.result.current.isReady).toBe(true));
    expect(view.result.current.data).toBeNull();
    expect(view.result.current.error).toBeNull();
    view.unmount();
    client.clear();
  });
});
