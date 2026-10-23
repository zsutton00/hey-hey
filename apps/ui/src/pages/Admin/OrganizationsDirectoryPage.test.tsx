import {
  OrganizationDirectorySortBy,
  OrganizationDirectorySortOrder,
} from "@hey-hey/ui-common/api";
import { useOrganizationsDirectory } from "@hey-hey/ui-common/data";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationsDirectoryPage } from "./OrganizationsDirectoryPage";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  )),
  useNavigate: () => navigateMock,
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useOrganizationsDirectory: vi.fn(),
}));

const useOrganizationsDirectoryMock = vi.mocked(useOrganizationsDirectory);

const organizations = [
  {
    id: "org-1",
    name: "Acme",
    createdAt: "2026-09-01T00:00:00.000Z",
    memberCount: 4,
    subscriptionType: "BETA" as const,
    accessStatus: "ACTIVE" as const,
  },
  {
    id: "org-2",
    name: "Beta",
    createdAt: "2026-08-01T00:00:00.000Z",
    memberCount: 2,
    subscriptionType: "PAID" as const,
    accessStatus: "REVOKED" as const,
  },
  {
    id: "org-3",
    name: "Expired",
    createdAt: "2026-07-01T00:00:00.000Z",
    memberCount: 1,
    subscriptionType: "BETA" as const,
    accessStatus: "EXPIRED" as const,
  },
];

const createDirectoryState = (overrides: Record<string, unknown> = {}) => ({
  data: organizations,
  organizations,
  page: { organizations, totalCount: 3, nextCursor: "next-page" },
  totalCount: 3,
  nextCursor: "next-page",
  isForbidden: false,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn().mockResolvedValue(organizations),
  markStale: vi.fn(),
  ...overrides,
});

describe("OrganizationsDirectoryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrganizationsDirectoryMock.mockReturnValue(
      createDirectoryState() as never
    );
  });

  it("renders independent desktop and mobile compositions for the same summaries", () => {
    render(<OrganizationsDirectoryPage />);

    expect(
      screen.getByTestId("organizations-directory-desktop")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("organizations-directory-mobile")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Organization" })
    ).toBeInTheDocument();
    expect(screen.getAllByText("Acme")).toHaveLength(2);
    expect(screen.getAllByText("Beta")).toHaveLength(2);
    expect(screen.getByText("3 organizations")).toBeInTheDocument();
    expect(screen.getAllByText("Beta · Active")).toHaveLength(2);
    expect(screen.getAllByText("Paid · Suspended")).toHaveLength(2);
    expect(screen.getAllByText("Beta · Expired")).toHaveLength(2);
  });

  it("opens organization detail from desktop rows and mobile cards", async () => {
    const user = userEvent.setup();
    render(<OrganizationsDirectoryPage />);
    await user.click(screen.getAllByText("Acme")[0]);
    expect(navigateMock).toHaveBeenCalledWith("/admin/organizations/org-1");
  });

  it("binds search and sort changes to the server query and resets pagination", async () => {
    const user = userEvent.setup();
    render(<OrganizationsDirectoryPage />);

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(useOrganizationsDirectoryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "next-page" })
    );

    await user.type(screen.getByLabelText("Search organizations"), "New");
    expect(useOrganizationsDirectoryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "New", cursor: undefined })
    );

    await user.click(screen.getByRole("combobox", { name: "Sort by" }));
    await user.click(screen.getByRole("option", { name: "Members" }));
    await user.click(screen.getByRole("combobox", { name: "Direction" }));
    await user.click(screen.getByRole("option", { name: "Oldest / lowest" }));
    expect(useOrganizationsDirectoryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sortBy: OrganizationDirectorySortBy.MemberCount,
        sortOrder: OrganizationDirectorySortOrder.Asc,
        cursor: undefined,
      })
    );
  });

  it("shows loading, empty, retry, and generic unauthorized states", async () => {
    const user = userEvent.setup();

    useOrganizationsDirectoryMock.mockReturnValue(
      createDirectoryState({
        data: [],
        organizations: [],
        page: null,
        totalCount: 0,
        nextCursor: null,
        isLoading: true,
        isFetched: false,
        isReady: false,
      }) as never
    );
    const loadingView = render(<OrganizationsDirectoryPage />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading organizations"
    );
    loadingView.unmount();

    useOrganizationsDirectoryMock.mockReturnValue(
      createDirectoryState({
        data: [],
        organizations: [],
        page: null,
        totalCount: 0,
        nextCursor: null,
      }) as never
    );
    const emptyView = render(<OrganizationsDirectoryPage />);
    expect(screen.getByText("No organizations found")).toBeInTheDocument();
    emptyView.unmount();

    const refetch = vi.fn().mockResolvedValue([]);
    useOrganizationsDirectoryMock.mockReturnValue(
      createDirectoryState({ error: new Error("network"), refetch }) as never
    );
    const errorView = render(<OrganizationsDirectoryPage />);
    expect(
      screen.getByText("The Organizations directory could not be loaded.")
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledOnce();
    errorView.unmount();

    useOrganizationsDirectoryMock.mockReturnValue(
      createDirectoryState({
        data: [],
        organizations: [],
        page: null,
        totalCount: 0,
        nextCursor: null,
        isForbidden: true,
        isReady: false,
        error: Object.assign(new Error("Forbidden"), {
          response: { status: 403 },
        }),
      }) as never
    );
    render(<OrganizationsDirectoryPage />);
    expect(
      screen.getByText(
        "You are not authorized to view the Organizations directory."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("Acme")).not.toBeInTheDocument();
  });
});
