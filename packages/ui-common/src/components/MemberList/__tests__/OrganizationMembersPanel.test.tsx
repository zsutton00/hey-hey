import type { OrganizationMemberResponseDto } from "../../../api";
import { useUsers } from "../../../data/hooks";
import { render, screen } from "@testing-library/react";
import React from "react";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationMembersPanel } from "../OrganizationMembersPanel";

vi.mock("../../../data/hooks", () => ({
  useUsers: vi.fn(),
}));

const member: OrganizationMemberResponseDto = {
  id: "membership-1",
  userId: "user-1",
  organizationId: "organization-1",
  role: "ADMIN",
  isActive: true,
  createdAt: "2026-08-18T00:00:00.000Z",
  user: {
    id: "user-1",
    name: "Alex Admin",
    email: "alex@example.com",
    isActive: true,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
  },
};

const useUsersMock = vi.mocked(useUsers);

const usersResult = (
  overrides: Partial<ReturnType<typeof useUsers>> = {}
): ReturnType<typeof useUsers> => ({
  data: [],
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn(),
  markStale: vi.fn(),
  ...overrides,
});

const renderPanel = (organizationId = "organization-1") =>
  render(
    <BrowserRouter>
      <OrganizationMembersPanel organizationId={organizationId} />
    </BrowserRouter>
  );

describe("OrganizationMembersPanel", () => {
  beforeEach(() => {
    useUsersMock.mockReset();
  });

  it("loads the selected organization's members with organization roles", () => {
    useUsersMock.mockReturnValue(usersResult({ data: [member] }));

    renderPanel();

    expect(useUsersMock).toHaveBeenCalledWith("organization-1");
    expect(screen.getByText("Alex Admin")).toBeInTheDocument();
    expect(screen.getByText("ADMIN")).toBeInTheDocument();
    expect(screen.getByTestId("member-list-item-user-1")).toHaveAttribute(
      "href",
      "/organizations/organization-1/users/user-1"
    );
    expect(screen.queryByTestId("member-list-invite")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("member-row-menu-user-1")
    ).not.toBeInTheDocument();
  });

  it("renders loading, empty, and error states explicitly", () => {
    useUsersMock.mockReturnValue(usersResult({ isLoading: true }));
    const view = renderPanel();
    expect(view.container.querySelectorAll(".MuiSkeleton-root")).toHaveLength(
      3
    );

    useUsersMock.mockReturnValue(usersResult());
    view.rerender(
      <BrowserRouter>
        <OrganizationMembersPanel organizationId="organization-1" />
      </BrowserRouter>
    );
    expect(screen.getByText("No organization members yet")).toBeInTheDocument();

    useUsersMock.mockReturnValue(
      usersResult({ error: new Error("request failed"), isReady: false })
    );
    view.rerender(
      <BrowserRouter>
        <OrganizationMembersPanel organizationId="organization-1" />
      </BrowserRouter>
    );
    expect(screen.getByTestId("organization-members-error")).toHaveTextContent(
      "Unable to load organization members."
    );
  });

  it("changes the membership source when the selected organization changes", () => {
    useUsersMock.mockReturnValue(usersResult());
    const view = renderPanel("organization-1");

    view.rerender(
      <BrowserRouter>
        <OrganizationMembersPanel organizationId="organization-2" />
      </BrowserRouter>
    );

    expect(useUsersMock).toHaveBeenLastCalledWith("organization-2");
  });
});
