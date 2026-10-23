import { AxiosHeaders } from "axios";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProjectRole,
  ProjectStatus,
  type ProjectResponseDto,
} from "../../../api";
import { platformClient } from "../../../clients/serviceClients";
import { projectKeys } from "../../../data/collections/projects";
import { ProjectIdentity } from "../ProjectIdentity";

vi.mock("../../../clients/serviceClients", () => ({
  platformClient: { removeProject: vi.fn() },
}));

const project: ProjectResponseDto = {
  id: "project-1",
  organizationId: "organization-1",
  name: "Onboarding project",
  status: ProjectStatus.Onboarding,
  currentUserRole: ProjectRole.Owner,
  hasEstablishedActivity: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function setup(withList: boolean) {
  const store = new QueryClient();
  const detailKey = projectKeys.detail(project.organizationId, project.id);
  const listKey = projectKeys.list(project.organizationId);
  store.setQueryData(detailKey, project);
  if (withList) store.setQueryData(listKey, [project]);
  render(
    <QueryClientProvider client={store}>
      <MemoryRouter initialEntries={[`/projects/${project.id}`]}>
        <Routes>
          <Route
            path="/projects/:projectId"
            element={
              <ProjectIdentity
                organizationId={project.organizationId}
                project={project}
              />
            }
          />
          <Route path="/projects" element={<h1>Project chooser</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { store, detailKey, listKey };
}

describe("Cancel Onboarding through ProjectIdentity", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([ProjectRole.Architect, ProjectRole.Member, ProjectRole.Viewer])(
    "is not offered to a project %s",
    (currentUserRole) => {
      render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <ProjectIdentity
              organizationId={project.organizationId}
              project={{ ...project, currentUserRole }}
            />
          </MemoryRouter>
        </QueryClientProvider>
      );
      expect(
        screen.queryByRole("button", { name: "Cancel Onboarding" })
      ).not.toBeInTheDocument();
    }
  );

  it.each([false, true])(
    "waits for deletion before removing cache and navigating (list cached: %s)",
    async (withList) => {
      let finish!: () => void;
      vi.mocked(platformClient.removeProject).mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = () =>
              resolve({
                data: undefined,
                status: 204,
                statusText: "No Content",
                headers: {},
                config: { headers: new AxiosHeaders() },
              });
          })
      );
      const { store, detailKey, listKey } = setup(withList);
      const button = screen.getByRole("button", { name: "Cancel Onboarding" });
      fireEvent.click(button);
      fireEvent.click(button);
      expect(platformClient.removeProject).toHaveBeenCalledExactlyOnceWith({
        organizationId: project.organizationId,
        projectId: project.id,
      });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-busy", "true");
      expect(Boolean(store.getQueryData(detailKey))).toBe(true);
      expect(screen.queryByText("Project chooser")).not.toBeInTheDocument();
      await act(async () => finish());
      expect(await screen.findByText("Project chooser")).toBeInTheDocument();
      expect(Boolean(store.getQueryData(detailKey))).toBe(false);
      if (withList) expect(store.getQueryData(listKey)).toEqual([]);
    }
  );

  it("keeps the project on failure and allows a successful retry", async () => {
    vi.mocked(platformClient.removeProject).mockRejectedValueOnce(
      new Error("unavailable")
    );
    const { store, detailKey } = setup(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel Onboarding" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to cancel onboarding"
    );
    expect(Boolean(store.getQueryData(detailKey))).toBe(true);
    expect(screen.queryByText("Project chooser")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel Onboarding" }));
    await waitFor(() =>
      expect(screen.getByText("Project chooser")).toBeInTheDocument()
    );
    expect(platformClient.removeProject).toHaveBeenCalledTimes(2);
    expect(Boolean(store.getQueryData(detailKey))).toBe(false);
  });
});
