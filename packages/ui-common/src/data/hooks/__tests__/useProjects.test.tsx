import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProjectMaturity,
  ProjectStatus,
  type ProjectResponseDto,
} from "../../../api";
import { projectKeys } from "../../collections/projects";
import { useProjects } from "../useProjects";
import { useProject } from "../useProject";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  entitlement: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", () => ({
  platformClient: {
    findAllProjects: mocks.list,
    findOneProject: mocks.detail,
    createProject: mocks.create,
    updateProject: mocks.update,
    removeProject: mocks.remove,
    getOrganizationProjectEntitlement: mocks.entitlement,
  },
}));
vi.mock("../../../contexts", () => ({
  usePathService: () => ({
    onboarding: ({ projectId }: { projectId: string }) =>
      `/projects/${projectId}`,
  }),
}));
vi.mock("../useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));
const project: ProjectResponseDto = {
  id: "project",
  organizationId: "org",
  name: "Original",
  status: ProjectStatus.Onboarding,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  hasEstablishedActivity: false,
  maturity: ProjectMaturity.Established,
  deletedAt: null,
};
const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient();
  clients.push(client);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { client, wrapper };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({ data: { data: [project] } });
  mocks.detail.mockResolvedValue({ data: { data: project } });
  mocks.entitlement.mockResolvedValue({
    data: { data: { canCreateProject: true } },
  });
});
afterEach(() => clients.splice(0).forEach((client) => client.clear()));

describe("useProjects cache mutations", () => {
  it("saves on and off to shared caches and reads the saved setting after a fresh load", async () => {
    let stored = project;
    mocks.update.mockImplementation(async ({ updateProjectDto }) => {
      stored = { ...stored, ...updateProjectDto };
      return { data: { data: stored } };
    });
    mocks.detail.mockImplementation(async () => ({ data: { data: stored } }));
    const { client, wrapper } = setup();
    const { result } = renderHook(
      () => ({
        list: useProjects("org"),
        detail: useProject("org", "project"),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.detail.isReady).toBe(true));
    for (const maturity of [
      ProjectMaturity.TakingShape,
      ProjectMaturity.Established,
    ]) {
      await act(async () => {
        await result.current.list.update("project", { maturity });
      });
      expect(mocks.update).toHaveBeenLastCalledWith({
        organizationId: "org",
        projectId: "project",
        updateProjectDto: { maturity },
      });
      await waitFor(() =>
        expect(result.current.detail.data?.maturity).toBe(maturity),
      );
      expect(result.current.list.projects[0]?.maturity).toBe(maturity);
      await act(async () => {
        client.removeQueries({
          queryKey: projectKeys.detail("org", "project"),
          exact: true,
        });
        await result.current.detail.refetch();
      });
      await waitFor(() =>
        expect(result.current.detail.data?.maturity).toBe(maturity),
      );
    }
  });
  it("shares the project list and exposes its existing sort and aliases", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => [useProjects("org"), useProjects("org")],
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.every((query) => query.isReady)).toBe(true),
    );
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(result.current[0].projects).toEqual([project]);
    expect(result.current[0].fetchingProjects).toBe(
      result.current[0].isFetching,
    );
  });

  it("adds only the authoritative creation response, shared by list and detail caches", async () => {
    let finish!: (response: unknown) => void;
    mocks.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useProjects("org"), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.create(
        { name: "Created" },
        { skipNavigation: true },
      );
    });
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(result.current.projects).toEqual([project]);
    const created = { ...project, id: "created", name: "Created" };
    await act(async () => {
      finish({ data: { data: created } });
      expect(await pending).toBe(true);
    });
    await waitFor(() => expect(result.current.projects).toHaveLength(2));
    expect(client.getQueryData(projectKeys.detail("org", "created"))).toEqual(
      created,
    );
  });

  it("rejects creation when entitlement denies it and leaves authoritative data intact", async () => {
    mocks.entitlement.mockResolvedValue({
      data: {
        data: {
          canCreateProject: false,
          creationUnavailableReason: "limit reached",
        },
      },
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useProjects("org"), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    const onError = vi.fn();
    await act(async () => {
      expect(
        await result.current.create({ name: "Created" }, { onError }),
      ).toBe(false);
    });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "limit reached" }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(result.current.projects).toEqual([project]);
  });

  it("updates every cached presentation while pending, then rolls both back on failure", async () => {
    let reject!: (error: Error) => void;
    mocks.update.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({
        list: useProjects("org"),
        detail: useProject("org", "project"),
      }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.list.isReady && result.current.detail.isReady).toBe(
        true,
      ),
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.list
        .update("project", { name: "Edited" })
        .catch((error) => error);
    });
    await waitFor(() =>
      expect(result.current.detail.data?.name).toBe("Edited"),
    );
    expect(result.current.list.projects[0].name).toBe("Edited");
    await act(async () => {
      reject(new Error("rejected"));
      await pending;
    });
    await waitFor(() =>
      expect(result.current.detail.data?.name).toBe("Original"),
    );
    expect(result.current.list.projects[0].name).toBe("Original");
    mocks.update.mockResolvedValue({
      data: { data: { ...project, name: "Accepted" } },
    });
    await act(async () => {
      await result.current.list.update("project", { name: "Requested" });
    });
    await waitFor(() =>
      expect(result.current.detail.data?.name).toBe("Accepted"),
    );
    expect(result.current.list.projects[0].name).toBe("Accepted");
  });

  it("rolls deletion back on failure and removes detail caches only after successful deletion", async () => {
    let reject!: (error: Error) => void;
    mocks.remove.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const { client, wrapper } = setup();
    client.setQueryData(projectKeys.detail("org", "project"), project);
    const { result } = renderHook(() => useProjects("org"), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.remove("project").catch((error) => error);
    });
    await waitFor(() => expect(result.current.projects).toEqual([]));
    expect(client.getQueryData(projectKeys.detail("org", "project"))).toEqual(
      project,
    );
    await act(async () => {
      reject(new Error("failed"));
      await pending;
    });
    await waitFor(() => expect(result.current.projects).toEqual([project]));
    mocks.remove.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.remove("project");
    });
    await waitFor(() => expect(result.current.projects).toEqual([]));
    expect(
      client.getQueryData(projectKeys.detail("org", "project")),
    ).toBeUndefined();
  });
});
