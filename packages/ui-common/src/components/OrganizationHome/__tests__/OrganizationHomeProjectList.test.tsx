import { AxiosHeaders } from "axios";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  ProjectRole,
  ProjectStatus,
  type ProjectResponseDto,
} from "../../../api";
import { platformClient } from "../../../clients/serviceClients";
import {
  projectKeys,
  projectsQueryOptions,
} from "../../../data/collections/projects";
import { OrganizationHomeProjectList } from "../OrganizationHomeProjectList";

vi.mock("../../../clients/serviceClients", () => ({
  platformClient: { removeProject: vi.fn() },
}));

const organizationId = "organization-1";
const listKey = projectKeys.list(organizationId);
const project = (
  id: string,
  name: string,
  currentUserRole: ProjectRole = ProjectRole.Owner
): ProjectResponseDto => ({
  id,
  name,
  organizationId,
  status: ProjectStatus.Onboarding,
  currentUserRole,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

function CachedProjectList() {
  const { data: projects } = useQuery({
    ...projectsQueryOptions(organizationId),
    enabled: false,
  });
  const location = useLocation();
  return (
    <>
      <OrganizationHomeProjectList
        organizationId={organizationId}
        projects={projects ?? []}
        pathForProject={({ id }) => `/projects/${id}/onboarding`}
      />
      <output data-testid="location">{location.pathname}</output>
    </>
  );
}

describe("OrganizationHomeProjectList cancellation", () => {
  it("offers cancellation only on rows where the caller is the project owner", () => {
    render(
      <MemoryRouter>
        <OrganizationHomeProjectList
          organizationId={organizationId}
          projects={[
            project("owned", "Owned project"),
            project("architected", "Architected", ProjectRole.Architect),
            project("member", "Member project", ProjectRole.Member),
          ]}
          pathForProject={({ id }) => `/projects/${id}/onboarding`}
        />
      </MemoryRouter>
    );
    const rows = screen.getAllByTestId("organization-home-project-item");
    const cancelFor = (id: string) =>
      within(rows.find((row) => row.dataset.projectId === id)!).queryByRole(
        "button",
        { name: "Cancel Onboarding" }
      );
    expect(cancelFor("owned")).toBeInTheDocument();
    expect(cancelFor("architected")).not.toBeInTheDocument();
    expect(cancelFor("member")).not.toBeInTheDocument();
  });

  it("keeps a failed deletion retryable, removes only the selected project after success, and never opens its link", async () => {
    const store = new QueryClient();
    const projects = [
      project("selected", "Selected project"),
      project("other", "Other project"),
    ];
    store.setQueryData(listKey, projects);
    let rejectDeletion!: (error: Error) => void;
    vi.mocked(platformClient.removeProject)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectDeletion = reject;
          })
      );
    render(
      <QueryClientProvider client={store}>
        <MemoryRouter initialEntries={["/projects"]}>
          <CachedProjectList />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const row = screen
      .getAllByTestId("organization-home-project-item")
      .find((element) => element.dataset.projectId === "selected");
    if (!row) throw new Error("Selected project row missing");
    const button = within(row).getByRole("button", {
      name: "Cancel Onboarding",
    });
    expect(button.closest("a")).toBeNull();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(platformClient.removeProject).toHaveBeenCalledExactlyOnceWith({
      organizationId,
      projectId: "selected",
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Selected project")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/projects$/);
    await act(async () => rejectDeletion(new Error("Unavailable")));
    expect(within(row).getByRole("alert")).toHaveTextContent(
      "Unable to cancel onboarding"
    );
    expect(button).toBeEnabled();
    expect(store.getQueryData<ProjectResponseDto[]>(listKey)).toHaveLength(2);
    vi.mocked(platformClient.removeProject).mockResolvedValueOnce({
      data: undefined,
      status: 204,
      statusText: "No Content",
      headers: {},
      config: { headers: new AxiosHeaders() },
    });
    await act(async () => fireEvent.click(button));
    expect(screen.queryByText("Selected project")).not.toBeInTheDocument();
    expect(screen.getByText("Other project")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/projects$/);
    expect(
      store.getQueryData<ProjectResponseDto[]>(listKey)?.map((item) => item.id)
    ).toEqual(["other"]);
    expect(platformClient.removeProject).toHaveBeenCalledTimes(2);
  });
});
