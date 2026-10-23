import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { MemberList } from "../MemberList";
import type { OrganizationMemberResponseDto } from "../../../api";

const buildMember = (
  overrides: Partial<OrganizationMemberResponseDto> = {}
): OrganizationMemberResponseDto => ({
  id: "mem-1",
  userId: "user-1",
  organizationId: "org-1",
  role: "MEMBER",
  isActive: true,
  createdAt: "2026-04-16T00:00:00Z",
  user: {
    id: "user-1",
    email: "alice@example.com",
    name: "Alice Anderson",
    isActive: true,
    createdAt: "2026-04-16T00:00:00Z",
    updatedAt: "2026-04-16T00:00:00Z",
  },
  ...overrides,
});

const renderWithRouter = (ui: React.ReactElement) =>
  render(<BrowserRouter>{ui}</BrowserRouter>);

describe("MemberList", () => {
  it("renders members with name, email, and role", () => {
    const members = [
      buildMember(),
      buildMember({
        id: "mem-2",
        userId: "user-2",
        role: "OWNER",
        user: {
          id: "user-2",
          email: "bob@example.com",
          name: "Bob Brown",
          isActive: true,
          createdAt: "2026-04-16T00:00:00Z",
          updatedAt: "2026-04-16T00:00:00Z",
        },
      }),
    ];

    renderWithRouter(
      <MemberList
        members={members}
        destination={{ scope: "project", projectId: "proj-1" }}
      />
    );

    expect(screen.getByText("Alice Anderson")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("MEMBER")).toBeInTheDocument();
    expect(screen.getByText("Bob Brown")).toBeInTheDocument();
    expect(screen.getByText("OWNER")).toBeInTheDocument();
  });

  it("links each row to the project user page", () => {
    const members = [buildMember()];
    renderWithRouter(
      <MemberList
        members={members}
        destination={{ scope: "project", projectId: "proj-1" }}
      />
    );

    const row = screen.getByTestId("member-list-item-user-1");
    expect(row).toHaveAttribute("href", "/projects/proj-1/users/user-1");
  });

  it("links each row to the organization user page", () => {
    renderWithRouter(
      <MemberList
        members={[buildMember()]}
        destination={{ scope: "organization", organizationId: "org-1" }}
      />
    );

    expect(screen.getByTestId("member-list-item-user-1")).toHaveAttribute(
      "href",
      "/organizations/org-1/users/user-1"
    );
  });

  it("shows empty state when no members", () => {
    renderWithRouter(
      <MemberList
        members={[]}
        destination={{ scope: "project", projectId: "proj-1" }}
        emptyMessage="Nobody here"
      />
    );
    expect(screen.getByText("Nobody here")).toBeInTheDocument();
  });

  it("invokes invite and add-existing callbacks", () => {
    const onInviteByEmail = vi.fn();
    const onAddExistingUser = vi.fn();

    renderWithRouter(
      <MemberList
        members={[buildMember()]}
        destination={{ scope: "project", projectId: "proj-1" }}
        onInviteByEmail={onInviteByEmail}
        onAddExistingUser={onAddExistingUser}
      />
    );

    fireEvent.click(screen.getByTestId("member-list-invite"));
    fireEvent.click(screen.getByTestId("member-list-add-existing"));

    expect(onInviteByEmail).toHaveBeenCalledTimes(1);
    expect(onAddExistingUser).toHaveBeenCalledTimes(1);
  });

  it("hides entry-point buttons when callbacks are not provided", () => {
    renderWithRouter(
      <MemberList
        members={[buildMember()]}
        destination={{ scope: "project", projectId: "proj-1" }}
      />
    );
    expect(screen.queryByTestId("member-list-invite")).toBeNull();
    expect(screen.queryByTestId("member-list-add-existing")).toBeNull();
  });

  it("hides the row menu when no remove callbacks are provided", () => {
    renderWithRouter(
      <MemberList
        members={[buildMember()]}
        destination={{ scope: "project", projectId: "proj-1" }}
      />
    );
    expect(screen.queryByTestId("member-row-menu-user-1")).toBeNull();
  });

  it("opens the row menu and surfaces both remove actions", () => {
    const onRemoveFromProject = vi.fn();
    const onRemoveFromOrganization = vi.fn();

    renderWithRouter(
      <MemberList
        members={[buildMember()]}
        destination={{ scope: "project", projectId: "proj-1" }}
        onRemoveFromProject={onRemoveFromProject}
        onRemoveFromOrganization={onRemoveFromOrganization}
      />
    );

    fireEvent.click(screen.getByTestId("member-row-menu-user-1"));

    fireEvent.click(screen.getByTestId("member-row-remove-project-user-1"));
    expect(onRemoveFromProject).toHaveBeenCalledTimes(1);
    expect(onRemoveFromProject.mock.calls[0][0].userId).toBe("user-1");

    fireEvent.click(screen.getByTestId("member-row-menu-user-1"));
    fireEvent.click(
      screen.getByTestId("member-row-remove-organization-user-1")
    );
    expect(onRemoveFromOrganization).toHaveBeenCalledTimes(1);
    expect(onRemoveFromOrganization.mock.calls[0][0].userId).toBe("user-1");
  });
});
