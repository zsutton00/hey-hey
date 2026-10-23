import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { Provider } from "jotai";
import { AxiosError, AxiosHeaders } from "axios";
import { ProjectMembersPanel } from "../ProjectMembersPanel";
import { OrganizationRole, ProjectRole } from "../../../api";
import { unifiedApiClient } from "../../../clients/serviceClients";
import {
  projectCapabilitiesForRole,
  useProjectCapabilities,
} from "../../../hooks/auth/useProjectCapabilities";
import { usePermissions } from "../../../hooks/auth/usePermissions";

vi.mock("../../../hooks/auth/useProjectCapabilities", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../hooks/auth/useProjectCapabilities")
  >()),
  useProjectCapabilities: vi.fn(),
}));

vi.mock("../../../hooks/auth/usePermissions", () => ({
  usePermissions: vi.fn(),
}));

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getOrganizationMembers: vi.fn(),
    inviteToOrganization: vi.fn(),
    listProjectMembers: vi.fn(),
    addProjectMember: vi.fn(),
    removeProjectMember: vi.fn(),
    removeOrganizationMember: vi.fn(),
  },
}));

const listedMember = {
  id: "member-existing",
  userId: "user-existing",
  organizationId: "org-1",
  role: "MEMBER",
  isActive: true,
  createdAt: "2026-04-17T00:00:00Z",
  user: {
    id: "user-existing",
    email: "existing@example.com",
    name: "Existing User",
    isActive: true,
    createdAt: "2026-04-17T00:00:00Z",
    updatedAt: "2026-04-17T00:00:00Z",
  },
};

const invitedMember = {
  ...listedMember,
  id: "member-invited",
  userId: "user-invited",
  user: {
    ...listedMember.user,
    id: "user-invited",
    email: "invited@example.com",
    name: "Invited User",
  },
};

const orgOnlyMember = {
  ...listedMember,
  id: "member-org-only",
  userId: "user-org-only",
  user: {
    ...listedMember.user,
    id: "user-org-only",
    email: "orgonly@example.com",
    name: "Org Only",
  },
};

const projectMemberRow = {
  id: "pm-existing",
  projectId: "proj-1",
  userId: "user-existing",
  role: ProjectRole.Member,
  createdAt: "2026-04-17T00:00:00Z",
  updatedAt: "2026-04-17T00:00:00Z",
  user: {
    id: "user-existing",
    email: "existing@example.com",
    name: "Existing User",
  },
};

const mockRoles = (
  projectRole: ProjectRole,
  organizationRole: OrganizationRole
): void => {
  vi.mocked(useProjectCapabilities).mockReturnValue(
    projectCapabilitiesForRole(projectRole)
  );
  vi.mocked(usePermissions).mockReturnValue({
    removeMembers:
      organizationRole === OrganizationRole.Owner ||
      organizationRole === OrganizationRole.Admin,
  } as ReturnType<typeof usePermissions>);
};

const renderPanel = (
  props: Partial<React.ComponentProps<typeof ProjectMembersPanel>> = {}
) =>
  render(
    <Provider>
      <BrowserRouter>
        <ProjectMembersPanel
          organizationId="org-1"
          projectId="proj-1"
          {...props}
        />
      </BrowserRouter>
    </Provider>
  );

const buildPaginatedMembersResponse = <T extends { id: string }>(
  members: T[],
  overrides: Partial<{
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  }> = {}
) => ({
  data: {
    data: {
      members,
      pagination: {
        page: 1,
        limit: 50,
        total: members.length,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
        ...overrides,
      },
    },
  },
});

describe("ProjectMembersPanel invite-by-email integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoles(ProjectRole.Owner, OrganizationRole.Owner);
    vi.mocked(unifiedApiClient.getOrganizationMembers).mockResolvedValue({
      data: { data: [listedMember] },
    } as never);
    vi.mocked(unifiedApiClient.listProjectMembers).mockResolvedValue(
      buildPaginatedMembersResponse([projectMemberRow]) as never
    );
  });

  const projectInvitedMemberRow = {
    ...projectMemberRow,
    id: "pm-invited",
    userId: "user-invited",
    user: {
      id: "user-invited",
      email: "invited@example.com",
      name: "Invited User",
    },
  };

  it("opens the invite dialog when the Invite by email button is clicked", async () => {
    renderPanel();

    await waitFor(() =>
      expect(screen.getByText("Existing User")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId("member-list-invite"));

    expect(screen.getByTestId("invite-by-email-dialog")).toBeInTheDocument();
  });

  it("submits the invite through inviteToOrganization and refreshes the members list", async () => {
    vi.mocked(unifiedApiClient.inviteToOrganization).mockResolvedValue({
      data: { data: invitedMember },
    } as never);

    renderPanel();

    await waitFor(() =>
      expect(screen.getByText("Existing User")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId("member-list-invite"));

    fireEvent.change(screen.getByTestId("invite-by-email-email"), {
      target: { value: "invited@example.com" },
    });

    vi.mocked(unifiedApiClient.listProjectMembers).mockResolvedValue(
      buildPaginatedMembersResponse([
        projectMemberRow,
        projectInvitedMemberRow,
      ]) as never
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("invite-by-email-submit"));
    });

    expect(unifiedApiClient.inviteToOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        inviteToOrganizationDto: {
          email: "invited@example.com",
          role: OrganizationRole.Member,
          projects: [{ projectId: "proj-1", role: ProjectRole.Member }],
        },
      })
    );

    await waitFor(() =>
      expect(screen.queryByTestId("invite-by-email-dialog")).toBeNull()
    );

    await waitFor(() =>
      expect(screen.getByText("Invited User")).toBeInTheDocument()
    );

    expect(unifiedApiClient.listProjectMembers).toHaveBeenCalled();
  });

  it("surfaces the duplicate-email hint when the API returns 409", async () => {
    const headers = new AxiosHeaders();
    const axiosError = new AxiosError(
      "duplicate",
      "ERR_BAD_REQUEST",
      undefined,
      {},
      {
        status: 409,
        data: { message: "already in org" },
        statusText: "Conflict",
        headers: {},
        config: { headers },
      }
    );
    vi.mocked(unifiedApiClient.inviteToOrganization).mockRejectedValue(
      axiosError
    );

    renderPanel();

    await waitFor(() =>
      expect(screen.getByText("Existing User")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId("member-list-invite"));
    fireEvent.change(screen.getByTestId("invite-by-email-email"), {
      target: { value: "existing@example.com" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("invite-by-email-submit"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("invite-by-email-duplicate")).toHaveTextContent(
        /already belongs to this organization/i
      )
    );

    expect(screen.getByTestId("invite-by-email-dialog")).toBeInTheDocument();
  });

  it("delegates to a consumer-provided onInviteByEmail instead of opening the local dialog", async () => {
    const onInviteByEmail = vi.fn();
    renderPanel({ onInviteByEmail });

    await waitFor(() =>
      expect(screen.getByText("Existing User")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId("member-list-invite"));

    expect(onInviteByEmail).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("invite-by-email-dialog")).toBeNull();
  });
});

describe("ProjectMembersPanel add-existing-user integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoles(ProjectRole.Owner, OrganizationRole.Owner);
    vi.mocked(unifiedApiClient.getOrganizationMembers).mockResolvedValue({
      data: { data: [listedMember, orgOnlyMember] },
    } as never);
    vi.mocked(unifiedApiClient.listProjectMembers).mockResolvedValue(
      buildPaginatedMembersResponse([projectMemberRow]) as never
    );
  });

  it("opens the add-existing-user dialog with only non-member candidates", async () => {
    renderPanel();

    await waitFor(() =>
      expect(screen.getByText("Existing User")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId("member-list-add-existing"));

    expect(screen.getByTestId("add-existing-user-dialog")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("add-existing-user-input"));

    await waitFor(() =>
      expect(
        screen.getByTestId("add-existing-user-option-user-org-only")
      ).toBeInTheDocument()
    );

    expect(
      screen.queryByTestId("add-existing-user-option-user-existing")
    ).toBeNull();
  });

  it("submits through addProjectMember and closes the dialog", async () => {
    vi.mocked(unifiedApiClient.addProjectMember).mockResolvedValue({
      data: {
        data: {
          ...projectMemberRow,
          id: "pm-org-only",
          userId: "user-org-only",
          role: ProjectRole.Architect,
          user: {
            id: "user-org-only",
            email: "orgonly@example.com",
            name: "Org Only",
          },
        },
      },
    } as never);

    renderPanel();

    await waitFor(() =>
      expect(screen.getByText("Existing User")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId("member-list-add-existing"));
    fireEvent.mouseDown(screen.getByTestId("add-existing-user-input"));

    await waitFor(() =>
      expect(
        screen.getByTestId("add-existing-user-option-user-org-only")
      ).toBeInTheDocument()
    );

    fireEvent.click(
      screen.getByTestId("add-existing-user-option-user-org-only")
    );

    fireEvent.change(screen.getByTestId("add-existing-user-role"), {
      target: { value: ProjectRole.Architect },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("add-existing-user-submit"));
    });

    expect(unifiedApiClient.addProjectMember).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        addProjectMemberDto: {
          userId: "user-org-only",
          role: ProjectRole.Architect,
        },
      })
    );

    await waitFor(() =>
      expect(screen.queryByTestId("add-existing-user-dialog")).toBeNull()
    );
  });

  it("surfaces the duplicate-membership hint when the API returns 409", async () => {
    const headers = new AxiosHeaders();
    const axiosError = new AxiosError(
      "duplicate",
      "ERR_BAD_REQUEST",
      undefined,
      {},
      {
        status: 409,
        data: { message: "User is already a project member" },
        statusText: "Conflict",
        headers: {},
        config: { headers },
      }
    );
    vi.mocked(unifiedApiClient.addProjectMember).mockRejectedValue(axiosError);

    renderPanel();

    await waitFor(() =>
      expect(screen.getByText("Existing User")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId("member-list-add-existing"));
    fireEvent.mouseDown(screen.getByTestId("add-existing-user-input"));

    await waitFor(() =>
      expect(
        screen.getByTestId("add-existing-user-option-user-org-only")
      ).toBeInTheDocument()
    );

    fireEvent.click(
      screen.getByTestId("add-existing-user-option-user-org-only")
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("add-existing-user-submit"));
    });

    await waitFor(() =>
      expect(
        screen.getByTestId("add-existing-user-duplicate")
      ).toHaveTextContent(/already a project member/i)
    );

    expect(screen.getByTestId("add-existing-user-dialog")).toBeInTheDocument();
  });

  it("delegates to a consumer-provided onAddExistingUser instead of opening the local dialog", async () => {
    const onAddExistingUser = vi.fn();
    renderPanel({ onAddExistingUser });

    await waitFor(() =>
      expect(screen.getByText("Existing User")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId("member-list-add-existing"));

    expect(onAddExistingUser).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("add-existing-user-dialog")).toBeNull();
  });
});

describe("ProjectMembersPanel renders every membership in the response", () => {
  const buildProjectMember = (n: number) => ({
    id: `pm-${n}`,
    projectId: "proj-1",
    userId: `user-${n}`,
    role: ProjectRole.Member,
    createdAt: "2026-04-17T00:00:00Z",
    updatedAt: "2026-04-17T00:00:00Z",
    user: {
      id: `user-${n}`,
      email: `user${n}@example.com`,
      name: `User ${n}`,
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRoles(ProjectRole.Owner, OrganizationRole.Owner);
    vi.mocked(unifiedApiClient.getOrganizationMembers).mockResolvedValue({
      data: { data: [] },
    } as never);
  });

  it("renders one row per membership for a multi-member listProjectMembers payload", async () => {
    const members = [1, 2, 3, 4, 5].map(buildProjectMember);
    vi.mocked(unifiedApiClient.listProjectMembers).mockResolvedValue(
      buildPaginatedMembersResponse(members) as never
    );

    renderPanel();

    for (const member of members) {
      await waitFor(() =>
        expect(screen.getByText(member.user.name)).toBeInTheDocument()
      );
    }

    const rows = screen.getAllByTestId(/^member-list-item-/);
    expect(rows).toHaveLength(members.length);

    const renderedTestIds = rows
      .map((row) => row.getAttribute("data-testid"))
      .sort();
    expect(renderedTestIds).toEqual(
      members.map((m) => `member-list-item-${m.userId}`).sort()
    );
  });

  it("keeps every row when memberships share an identical sort key (same user.name)", async () => {
    const members = [1, 2, 3].map((n) => ({
      ...buildProjectMember(n),
      user: {
        id: `user-${n}`,
        email: `user${n}@example.com`,
        name: "Same Name",
      },
    }));
    vi.mocked(unifiedApiClient.listProjectMembers).mockResolvedValue(
      buildPaginatedMembersResponse(members) as never
    );

    renderPanel();

    await waitFor(() => {
      expect(screen.getAllByText("Same Name")).toHaveLength(members.length);
    });

    const rows = screen.getAllByTestId(/^member-list-item-/);
    expect(rows).toHaveLength(members.length);
  });

  it("renders rows for memberships even when the embedded user is missing", async () => {
    const members = [
      buildProjectMember(1),
      { ...buildProjectMember(2), user: undefined },
      buildProjectMember(3),
    ];
    vi.mocked(unifiedApiClient.listProjectMembers).mockResolvedValue(
      buildPaginatedMembersResponse(members) as never
    );

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("User 1")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Unknown user")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("User 3")).toBeInTheDocument();
    });

    const rows = screen.getAllByTestId(/^member-list-item-/);
    expect(rows).toHaveLength(members.length);
  });
});

describe("ProjectMembersPanel remove-member integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoles(ProjectRole.Owner, OrganizationRole.Owner);
    vi.mocked(unifiedApiClient.getOrganizationMembers).mockResolvedValue({
      data: { data: [listedMember] },
    } as never);
    vi.mocked(unifiedApiClient.listProjectMembers).mockResolvedValue(
      buildPaginatedMembersResponse([projectMemberRow]) as never
    );
  });

  it("removes the member from the project via removeProjectMember and closes the dialog", async () => {
    vi.mocked(unifiedApiClient.removeProjectMember).mockResolvedValue(
      undefined as never
    );

    renderPanel();

    await waitFor(() =>
      expect(screen.getByText("Existing User")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId("member-row-menu-user-existing"));
    fireEvent.click(
      screen.getByTestId("member-row-remove-project-user-existing")
    );

    expect(
      screen.getByTestId("remove-member-dialog-project")
    ).toBeInTheDocument();

    vi.mocked(unifiedApiClient.listProjectMembers).mockResolvedValue(
      buildPaginatedMembersResponse([]) as never
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("remove-member-dialog-confirm"));
    });

    expect(unifiedApiClient.removeProjectMember).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        userId: "user-existing",
      })
    );

    await waitFor(() =>
      expect(screen.queryByTestId("remove-member-dialog-project")).toBeNull()
    );
    await waitFor(() =>
      expect(unifiedApiClient.listProjectMembers).toHaveBeenCalledTimes(2)
    );
  });

  it("removes the member from the organization via removeOrganizationMember and closes the dialog", async () => {
    vi.mocked(unifiedApiClient.removeOrganizationMember).mockResolvedValue(
      undefined as never
    );

    renderPanel();

    await waitFor(() =>
      expect(screen.getByText("Existing User")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId("member-row-menu-user-existing"));
    fireEvent.click(
      screen.getByTestId("member-row-remove-organization-user-existing")
    );

    expect(
      screen.getByTestId("remove-member-dialog-organization")
    ).toBeInTheDocument();

    vi.mocked(unifiedApiClient.listProjectMembers).mockResolvedValue(
      buildPaginatedMembersResponse([]) as never
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("remove-member-dialog-confirm"));
    });

    expect(unifiedApiClient.removeOrganizationMember).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        userId: "user-existing",
      })
    );

    await waitFor(() =>
      expect(
        screen.queryByTestId("remove-member-dialog-organization")
      ).toBeNull()
    );
    await waitFor(() =>
      expect(unifiedApiClient.listProjectMembers).toHaveBeenCalledTimes(2)
    );
  });

  it("surfaces a last-owner warning when removeProjectMember returns 400", async () => {
    const headers = new AxiosHeaders();
    const axiosError = new AxiosError(
      "last-owner",
      "ERR_BAD_REQUEST",
      undefined,
      {},
      {
        status: 400,
        data: { message: "Cannot remove the last owner of a project" },
        statusText: "Bad Request",
        headers: {},
        config: { headers },
      }
    );
    vi.mocked(unifiedApiClient.removeProjectMember).mockRejectedValue(
      axiosError
    );

    renderPanel();

    await waitFor(() =>
      expect(screen.getByText("Existing User")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId("member-row-menu-user-existing"));
    fireEvent.click(
      screen.getByTestId("member-row-remove-project-user-existing")
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("remove-member-dialog-confirm"));
    });

    await waitFor(() =>
      expect(
        screen.getByTestId("remove-member-dialog-error")
      ).toHaveTextContent(/last owner/i)
    );

    expect(
      screen.getByTestId("remove-member-dialog-project")
    ).toBeInTheDocument();
  });
});

describe("ProjectMembersPanel pagination", () => {
  const buildProjectMember = (n: number) => ({
    id: `pm-${n}`,
    projectId: "proj-1",
    userId: `user-${n}`,
    role: ProjectRole.Member,
    createdAt: "2026-04-17T00:00:00Z",
    updatedAt: "2026-04-17T00:00:00Z",
    user: {
      id: `user-${n}`,
      email: `user${n}@example.com`,
      name: `User ${n}`,
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRoles(ProjectRole.Owner, OrganizationRole.Owner);
    vi.mocked(unifiedApiClient.getOrganizationMembers).mockResolvedValue({
      data: { data: [] },
    } as never);
  });

  it("fetches the next page when the load-more control is clicked and renders the new members", async () => {
    const firstPageMembers = [1, 2].map(buildProjectMember);
    const secondPageMembers = [3, 4].map(buildProjectMember);

    vi.mocked(unifiedApiClient.listProjectMembers).mockResolvedValueOnce(
      buildPaginatedMembersResponse(firstPageMembers, {
        page: 1,
        limit: 2,
        total: 4,
        totalPages: 2,
        hasNext: true,
        hasPrevious: false,
      }) as never
    );
    vi.mocked(unifiedApiClient.listProjectMembers).mockResolvedValueOnce(
      buildPaginatedMembersResponse(secondPageMembers, {
        page: 2,
        limit: 2,
        total: 4,
        totalPages: 2,
        hasNext: false,
        hasPrevious: true,
      }) as never
    );

    renderPanel();

    for (const m of firstPageMembers) {
      await waitFor(() =>
        expect(screen.getByText(m.user.name)).toBeInTheDocument()
      );
    }

    const loadMore = await screen.findByTestId("project-members-load-more");
    await act(async () => {
      fireEvent.click(loadMore);
    });

    await waitFor(() => {
      expect(unifiedApiClient.listProjectMembers).toHaveBeenCalledTimes(2);
    });
    expect(unifiedApiClient.listProjectMembers).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        page: 2,
        limit: expect.any(Number),
      }), {}
    );

    for (const m of secondPageMembers) {
      await waitFor(() =>
        expect(screen.getByText(m.user.name)).toBeInTheDocument()
      );
    }

    const rows = screen.getAllByTestId(/^member-list-item-/);
    expect(rows).toHaveLength(
      firstPageMembers.length + secondPageMembers.length
    );
  });
});

describe("ProjectMembersPanel role-gated administration controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(unifiedApiClient.getOrganizationMembers).mockResolvedValue({
      data: { data: [listedMember] },
    } as never);
    vi.mocked(unifiedApiClient.listProjectMembers).mockResolvedValue(
      buildPaginatedMembersResponse([projectMemberRow]) as never
    );
  });

  const renderAndWaitForRow = async (): Promise<void> => {
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText("Existing User")).toBeInTheDocument()
    );
  };

  it("hides invite, add-existing and every removal control from a project and organization MEMBER", async () => {
    mockRoles(ProjectRole.Member, OrganizationRole.Member);
    await renderAndWaitForRow();

    expect(screen.queryByTestId("member-list-invite")).toBeNull();
    expect(screen.queryByTestId("member-list-add-existing")).toBeNull();
    expect(screen.queryByTestId("member-row-menu-user-existing")).toBeNull();
  });

  it("hides every administration control from a project VIEWER", async () => {
    mockRoles(ProjectRole.Viewer, OrganizationRole.Viewer);
    await renderAndWaitForRow();

    expect(screen.queryByTestId("member-list-invite")).toBeNull();
    expect(screen.queryByTestId("member-list-add-existing")).toBeNull();
    expect(screen.queryByTestId("member-row-menu-user-existing")).toBeNull();
  });

  it("shows invite and add-existing but no project removal to a project ARCHITECT", async () => {
    mockRoles(ProjectRole.Architect, OrganizationRole.Member);
    await renderAndWaitForRow();

    expect(screen.getByTestId("member-list-invite")).toBeInTheDocument();
    expect(screen.getByTestId("member-list-add-existing")).toBeInTheDocument();
    expect(screen.queryByTestId("member-row-menu-user-existing")).toBeNull();
  });

  it("offers only remove-from-project to a project OWNER who is an organization MEMBER", async () => {
    mockRoles(ProjectRole.Owner, OrganizationRole.Member);
    await renderAndWaitForRow();

    expect(screen.getByTestId("member-list-invite")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("member-row-menu-user-existing"));
    expect(
      screen.getByTestId("member-row-remove-project-user-existing")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("member-row-remove-organization-user-existing")
    ).toBeNull();
  });

  it("offers only remove-from-organization to an organization ADMIN who is a project ARCHITECT", async () => {
    mockRoles(ProjectRole.Architect, OrganizationRole.Admin);
    await renderAndWaitForRow();

    fireEvent.click(screen.getByTestId("member-row-menu-user-existing"));
    expect(
      screen.getByTestId("member-row-remove-organization-user-existing")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("member-row-remove-project-user-existing")
    ).toBeNull();
  });
});
