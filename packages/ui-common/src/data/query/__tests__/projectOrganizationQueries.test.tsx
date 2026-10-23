import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationRole, ProjectRole } from "../../../api";
import { useProjectMembers } from "../../hooks/useProjectMembers";
import { useUsers } from "../../hooks/useUsers";
import { useProjectCounts } from "../../hooks/useProjectCounts";
import { useProject } from "../../hooks/useProject";
import { useLocalRepoBindings } from "../../hooks/useLocalRepoBindings";
import { useAddProjectMember } from "../../hooks/useAddProjectMember";
import { useInviteByEmail } from "../../hooks/useInviteByEmail";
import { useRemoveProjectMember } from "../../hooks/useRemoveProjectMember";
import { useRemoveOrganizationMember } from "../../hooks/useRemoveOrganizationMember";
import { invalidateMembershipQueries } from "../projectOrganizationInvalidation";
import { invalidateAllDataLayerQueries } from "../dataLayerInvalidation";
import { localRepoBindingKeys } from "../../collections/localRepoBindings";
import { projectKeys } from "../../collections/projects";
import { WebSocketHandler } from "../../websockets/handler";
import { createStore } from "jotai";

const mocks = vi.hoisted(() => ({
  members: vi.fn(),
  users: vi.fn(),
  counts: vi.fn(),
  project: vi.fn(),
  add: vi.fn(),
  invite: vi.fn(),
  removeProject: vi.fn(),
  removeOrganization: vi.fn(),
  listRepos: vi.fn(),
  baseUrl: "http://localhost:9000",
}));
vi.mock("../../../clients/serviceClients", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  unifiedApiClient: {
    listProjectMembers: mocks.members,
    getOrganizationMembers: mocks.users,
    addProjectMember: mocks.add,
    inviteToOrganization: mocks.invite,
    removeProjectMember: mocks.removeProject,
    removeOrganizationMember: mocks.removeOrganization,
  },
  projectsClient: { getProjectCounts: mocks.counts },
  platformClient: { findOneProject: mocks.project },
}));
vi.mock("../../../components/AgentSession/runtime/directoryBindingApi", () => ({
  resolveLocalDirectoryRuntimeBaseUrl: () => mocks.baseUrl,
  createDirectoryBindingApi: (url: string) => ({
    listRepos: () => mocks.listRepos(url),
  }),
}));
vi.mock("../../hooks/useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));
const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  clients.push(client);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.baseUrl = "http://localhost:9000";
  mocks.members.mockResolvedValue({
    data: {
      data: {
        members: [],
        pagination: { page: 1, limit: 50, total: 0, hasNext: false },
      },
    },
  });
  mocks.users.mockResolvedValue({ data: { data: [] } });
  mocks.counts.mockResolvedValue({ data: { data: { total: 0 } } });
  mocks.project.mockResolvedValue({
    data: { data: { id: "project", name: "Project" } },
  });
  mocks.add.mockResolvedValue({ data: { data: { id: "member" } } });
  mocks.invite.mockResolvedValue({ data: { data: { id: "member" } } });
  mocks.removeProject.mockResolvedValue(undefined);
  mocks.removeOrganization.mockResolvedValue(undefined);
  mocks.listRepos.mockResolvedValue({ bindings: [] });
});
afterEach(() => clients.splice(0).forEach((client) => client.clear()));

describe("project and organization cache wiring", () => {
  it("shares member rows, pagination, and empty success between consumers", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => [
        useProjectMembers("org", "project"),
        useProjectMembers("org", "project"),
      ],
      { wrapper }
    );
    await waitFor(() =>
      expect(result.current.every((query) => query.isReady)).toBe(true)
    );
    expect(mocks.members).toHaveBeenCalledTimes(1);
    expect(result.current[0].data).toEqual([]);
    expect(result.current[1].total).toBe(0);
    expect(result.current[1].hasNext).toBe(false);
  });

  it.each(["add", "invite", "remove"] as const)(
    "%s refreshes only the affected project's members and organization's users",
    async (action) => {
      const { wrapper } = setup();
      const { result } = renderHook(
        () => ({
          members: useProjectMembers("org", "project"),
          otherMembers: useProjectMembers("org", "other"),
          users: useUsers("org"),
          otherUsers: useUsers("other-org"),
          counts: useProjectCounts("org", "project"),
          add: useAddProjectMember(),
          invite: useInviteByEmail(),
          remove: useRemoveProjectMember(),
        }),
        { wrapper }
      );
      await waitFor(() =>
        expect(
          result.current.members.isReady &&
            result.current.otherMembers.isReady &&
            result.current.users.isReady &&
            result.current.otherUsers.isReady &&
            result.current.counts.isReady
        ).toBe(true)
      );
      await act(async () => {
        if (action === "add")
          await result.current.add.mutate({
            organizationId: "org",
            projectId: "project",
            userId: "user",
            role: ProjectRole.Member,
          });
        else if (action === "invite")
          await result.current.invite.mutate({
            organizationId: "org",
            projectId: "project",
            email: "member@example.com",
            role: ProjectRole.Member,
          });
        else
          await result.current.remove.mutate({
            organizationId: "org",
            projectId: "project",
            userId: "user",
          });
      });
      await waitFor(() => expect(mocks.members).toHaveBeenCalledTimes(3));
      expect(mocks.users).toHaveBeenCalledTimes(3);
      expect(mocks.counts).toHaveBeenCalledTimes(1);
      expect(
        mocks.members.mock.calls.filter(
          ([params]) => params.projectId === "other"
        )
      ).toHaveLength(1);
      expect(
        mocks.users.mock.calls.filter(
          ([params]) => params.organizationId === "other-org"
        )
      ).toHaveLength(1);
      expect(result.current[action].isSuccess).toBe(true);
      if (action === "invite")
        expect(mocks.invite).toHaveBeenCalledWith({
          organizationId: "org",
          inviteToOrganizationDto: {
            email: "member@example.com",
            role: OrganizationRole.Member,
            projects: [{ projectId: "project", role: ProjectRole.Member }],
          },
        });
    }
  );

  it("keeps mutation pending explicit and leaves caches alone after failure", async () => {
    let reject!: (error: Error) => void;
    mocks.add.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    );
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({
        members: useProjectMembers("org", "project"),
        users: useUsers("org"),
        mutation: useAddProjectMember(),
      }),
      { wrapper }
    );
    await waitFor(() =>
      expect(
        result.current.members.isReady && result.current.users.isReady
      ).toBe(true)
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.mutation
        .mutate({
          organizationId: "org",
          projectId: "project",
          userId: "user",
          role: ProjectRole.Member,
        })
        .catch((error) => error);
    });
    expect(result.current.mutation.isPending).toBe(true);
    await act(async () => {
      reject(new Error("failed"));
      await pending;
    });
    expect(result.current.mutation.error?.message).toBe("failed");
    expect(mocks.members).toHaveBeenCalledTimes(1);
    expect(mocks.users).toHaveBeenCalledTimes(1);
  });

  it("organization removal refreshes that organization's project memberships only", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({
        first: useProjectMembers("org", "first"),
        second: useProjectMembers("org", "second"),
        unrelated: useProjectMembers("other-org", "first"),
        users: useUsers("org"),
        mutation: useRemoveOrganizationMember(),
      }),
      { wrapper }
    );
    await waitFor(() =>
      expect(
        result.current.first.isReady &&
          result.current.second.isReady &&
          result.current.unrelated.isReady &&
          result.current.users.isReady
      ).toBe(true)
    );
    await act(async () => {
      await result.current.mutation.mutate({
        organizationId: "org",
        userId: "user",
      });
    });
    await waitFor(() => expect(mocks.members).toHaveBeenCalledTimes(5));
    expect(mocks.users).toHaveBeenCalledTimes(2);
    expect(
      mocks.members.mock.calls.filter(
        ([params]) => params.organizationId === "other-org"
      )
    ).toHaveLength(1);
  });

  it("refreshes every loaded member page and removes deleted members", async () => {
    let refreshed = false;
    mocks.members.mockImplementation(({ page }) =>
      Promise.resolve({
        data: {
          data: {
            members: refreshed
              ? []
              : [{ id: `member-${page}`, user: { name: `Member ${page}` } }],
            pagination: {
              page,
              limit: 50,
              total: refreshed ? 0 : 2,
              hasNext: !refreshed && page === 1,
            },
          },
        },
      })
    );
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useProjectMembers("org", "project"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    refreshed = true;
    await act(async () => {
      await invalidateMembershipQueries(client, "org", "project");
    });
    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(result.current.total).toBe(0);
    expect(result.current.hasNext).toBe(false);
  });

  it("starts a later read for membership invalidation during the initial read", async () => {
    let finish!: (value: unknown) => void;
    mocks.members.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useProjectMembers("org", "project"), {
      wrapper,
    });
    await waitFor(() => expect(mocks.members).toHaveBeenCalledTimes(1));
    await act(async () => {
      await invalidateMembershipQueries(client, "org", "project");
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(mocks.members).toHaveBeenCalledTimes(2);
    await act(async () =>
      finish({ data: { data: { members: [{ id: "obsolete" }] } } })
    );
    expect(result.current.data).toEqual([]);
  });

  it("deduplicates member pages and resets pagination when the project changes", async () => {
    mocks.members.mockImplementation(({ projectId, page }) =>
      Promise.resolve({
        data: {
          data: {
            members:
              page === 1
                ? [{ id: `${projectId}-first` }]
                : [{ id: `${projectId}-first` }, { id: `${projectId}-second` }],
            pagination: { page, total: 2, limit: 50, hasNext: page === 1 },
          },
        },
      })
    );
    const { wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ projectId }) => useProjectMembers("org", projectId),
      { wrapper, initialProps: { projectId: "first" } }
    );
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.page).toBe(2));
    expect(result.current.data.map((member) => member.id)).toEqual([
      "first-first",
      "first-second",
    ]);
    rerender({ projectId: "second" });
    expect(result.current.data).toEqual([]);
    expect(result.current.page).toBe(1);
    await waitFor(() =>
      expect(result.current.data.map((member) => member.id)).toEqual([
        "second-first",
      ])
    );
    await act(async () => {
      await result.current.refetch();
    });
    expect(
      mocks.members.mock.calls.filter(
        ([params]) => params.projectId === "second"
      )
    ).toHaveLength(2);
  });

  it("reconnect reads each mounted key once and leaves inactive keys unread", async () => {
    const { client, wrapper } = setup();
    client.setQueryData(projectKeys.detail("org", "inactive"), {
      id: "inactive",
    });
    const { result } = renderHook(
      () => ({
        project: useProject("org", "project"),
        members: useProjectMembers("org", "project"),
        users: useUsers("org"),
        counts: useProjectCounts("org", "project"),
        bindings: useLocalRepoBindings(),
      }),
      { wrapper }
    );
    await waitFor(() =>
      expect(
        result.current.project.isReady &&
          result.current.members.isReady &&
          result.current.users.isReady &&
          result.current.counts.isReady &&
          result.current.bindings.status === "empty"
      ).toBe(true)
    );
    await act(async () => {
      await invalidateAllDataLayerQueries(client);
    });
    for (const read of [
      mocks.project,
      mocks.members,
      mocks.users,
      mocks.counts,
      mocks.listRepos,
    ])
      expect(read).toHaveBeenCalledTimes(2);
    expect(
      client.getQueryState(projectKeys.detail("org", "inactive"))?.isInvalidated
    ).toBe(true);
  });

  it("keeps local runtime identities isolated and reports an unavailable runtime", async () => {
    const { client, wrapper } = setup();
    const { result, rerender } = renderHook(
      () => [useLocalRepoBindings(), useLocalRepoBindings()],
      { wrapper }
    );
    await waitFor(() => expect(result.current[0].status).toBe("empty"));
    expect(mocks.listRepos).toHaveBeenCalledTimes(1);
    mocks.baseUrl = "http://localhost:9001";
    mocks.listRepos.mockRejectedValue(
      Object.assign(new Error("unavailable"), { status: 404 })
    );
    rerender();
    await waitFor(() => expect(result.current[0].status).toBe("error"));
    expect(result.current[0].bindings).toEqual([]);
    expect(
      client.getQueryData(localRepoBindingKeys.runtime("http://localhost:9000"))
    ).toEqual([]);
    expect(mocks.listRepos).toHaveBeenCalledWith("http://localhost:9001");
  });

  it("project events refresh the matching detail and list through the websocket handler", async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useProject("org", "project"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    const handler = new WebSocketHandler(createStore(), undefined, client);
    await act(async () => {
      handler.handleEvent({
        type: "project.updated",
        organizationId: "org",
        projectId: "project",
        changedFields: ["name"],
        timestamp: new Date().toISOString(),
      });
    });
    await waitFor(() => expect(mocks.project).toHaveBeenCalledTimes(2));
  });
});
