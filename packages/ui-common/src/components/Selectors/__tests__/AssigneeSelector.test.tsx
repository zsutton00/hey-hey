import type { ComponentProps } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Provider } from "jotai";
import { AssigneeSelector } from "../AssigneeSelector";
import type { OrganizationMemberResponseDto } from "../../../api";
import { unifiedApiClient } from "../../../clients/serviceClients";

// Mock the useUsers hook
vi.mock("../../../data/hooks", () => ({
  useUsers: vi.fn(),
}));

// Mock the useAuth hook
vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

// Import the hooks after mocking
import { useUsers } from "../../../data/hooks";
import { useAuth } from "../../../contexts/AuthContext";

const mockMembers: OrganizationMemberResponseDto[] = [
  {
    id: "member-1",
    userId: "user-1",
    organizationId: "org-123",
    role: "admin",
    isActive: true,
    invitedAt: "2024-01-01T00:00:00Z",
    joinedAt: "2024-01-01T00:00:00Z",
    createdAt: "2024-01-01T00:00:00Z",
    user: {
      id: "user-1",
      name: "Alice Johnson",
      email: "alice@example.com",
    },
  },
  {
    id: "member-2",
    userId: "user-2",
    organizationId: "org-123",
    role: "member",
    isActive: true,
    invitedAt: "2024-01-02T00:00:00Z",
    joinedAt: "2024-01-02T00:00:00Z",
    createdAt: "2024-01-02T00:00:00Z",
    user: {
      id: "user-2",
      name: "Bob Smith",
      email: "bob@example.com",
    },
  },
  {
    id: "member-3",
    userId: "user-3",
    organizationId: "org-123",
    role: "member",
    isActive: false,
    invitedAt: "2024-01-03T00:00:00Z",
    joinedAt: null,
    createdAt: "2024-01-03T00:00:00Z",
    user: {
      id: "user-3",
      name: "Charlie Brown",
      email: "charlie@example.com",
    },
  },
  {
    id: "member-4",
    userId: "user-4",
    organizationId: "org-123",
    role: "member",
    isActive: true,
    invitedAt: "2024-01-04T00:00:00Z",
    joinedAt: "2024-01-04T00:00:00Z",
    createdAt: "2024-01-04T00:00:00Z",
    user: undefined,
  },
];

const mockUseUsers = vi.mocked(useUsers);
const mockUseAuth = vi.mocked(useAuth);

const mockAuthValue = (userId: string | null) =>
  ({
    isAuthenticated: !!userId,
    user: userId ? { id: userId, email: `${userId}@example.com` } : null,
    loading: false,
    login: vi.fn(),
    completeChangePassword: vi.fn(),
    logout: vi.fn(),
    toggleDevAdminMode: vi.fn(),
  } as never);

describe("AssigneeSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue(mockAuthValue("user-1"));
  });

  describe("rendering", () => {
    it("should render with label", () => {
      mockUseUsers.mockReturnValue({
        data: [],
        isLoading: false,
        isFetching: false,
        isFetched: true,
        isReady: true,
        error: null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      } as never);

      render(
        <Provider>
          <AssigneeSelector
            value={null}
            onChange={vi.fn()}
            organizationId="org-123"
            label="Assign To"
          />
        </Provider>
      );

      expect(
        screen.getByText("Assign To", { selector: "label" })
      ).toBeInTheDocument();
    });

    it("should render with default label", () => {
      mockUseUsers.mockReturnValue({
        data: [],
        isLoading: false,
        isFetching: false,
        isFetched: true,
        isReady: true,
        error: null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      } as never);

      render(
        <Provider>
          <AssigneeSelector
            value={null}
            onChange={vi.fn()}
            organizationId="org-123"
          />
        </Provider>
      );

      expect(
        screen.getByText("Assignee", { selector: "label" })
      ).toBeInTheDocument();
    });
  });

  describe("loading state", () => {
    it("should keep menu items hidden while loading", () => {
      mockUseUsers.mockReturnValue({
        data: [],
        isLoading: true,
        isFetching: true,
        isFetched: false,
        isReady: false,
        error: null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      } as never);

      render(
        <Provider>
          <AssigneeSelector
            value={null}
            onChange={vi.fn()}
            organizationId="org-123"
          />
        </Provider>
      );

      expect(screen.getByRole("combobox")).toHaveAttribute(
        "aria-disabled",
        "true"
      );
      expect(screen.queryByText("Loading members...")).not.toBeInTheDocument();
    });

    it("should disable selector while loading", () => {
      mockUseUsers.mockReturnValue({
        data: [],
        isLoading: true,
        isFetching: true,
        isFetched: false,
        isReady: false,
        error: null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      } as never);

      const { container } = render(
        <Provider>
          <AssigneeSelector
            value={null}
            onChange={vi.fn()}
            organizationId="org-123"
          />
        </Provider>
      );

      const select = container.querySelector(
        "[role='combobox']"
      ) as HTMLElement;
      expect(select).toHaveAttribute("aria-disabled", "true");
    });
  });

  describe("member filtering", () => {
    it("should only display active members with user details", async () => {
      const onChange = vi.fn();
      mockUseUsers.mockReturnValue({
        data: mockMembers,
        isLoading: false,
        isFetching: false,
        isFetched: true,
        isReady: true,
        error: null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      } as never);

      render(
        <Provider>
          <AssigneeSelector
            value={null}
            onChange={onChange}
            organizationId="org-123"
          />
        </Provider>
      );

      const user = userEvent.setup();
      const select = screen.getByRole("combobox");
      await user.click(select);

      // Should only show Alice and Bob (active with user details)
      // Not Charlie (inactive) or user-4 (no user details)
      await waitFor(() => {
        expect(screen.getByText("Alice Johnson")).toBeInTheDocument();
        expect(screen.getByText("Bob Smith")).toBeInTheDocument();
      });

      expect(screen.queryByText("Charlie Brown")).not.toBeInTheDocument();
    });
  });

  describe("selection behavior", () => {
    it("should call onChange with selected user ID", async () => {
      const onChange = vi.fn();
      mockUseUsers.mockReturnValue({
        data: mockMembers,
        isLoading: false,
        isFetching: false,
        isFetched: true,
        isReady: true,
        error: null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      } as never);

      render(
        <Provider>
          <AssigneeSelector
            value={null}
            onChange={onChange}
            organizationId="org-123"
          />
        </Provider>
      );

      const user = userEvent.setup();
      const select = screen.getByRole("combobox");
      await user.click(select);

      const aliceOption = await screen.findByText("Alice Johnson");
      await user.click(aliceOption);

      expect(onChange).toHaveBeenCalledWith("user-1");
    });

    it("should display selected user name", () => {
      mockUseUsers.mockReturnValue({
        data: mockMembers,
        isLoading: false,
        isFetching: false,
        isFetched: true,
        isReady: true,
        error: null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      } as never);

      render(
        <Provider>
          <AssigneeSelector
            value="user-1"
            onChange={vi.fn()}
            organizationId="org-123"
          />
        </Provider>
      );

      expect(screen.getByText("Alice Johnson")).toBeInTheDocument();
    });

    it("should display Unassigned when value is null", () => {
      mockUseUsers.mockReturnValue({
        data: mockMembers,
        isLoading: false,
        isFetching: false,
        isFetched: true,
        isReady: true,
        error: null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      } as never);

      render(
        <Provider>
          <AssigneeSelector
            value={null}
            onChange={vi.fn()}
            organizationId="org-123"
          />
        </Provider>
      );

      expect(screen.getByText("Unassigned")).toBeInTheDocument();
    });

    it("should allow clearing selection", async () => {
      const onChange = vi.fn();
      mockUseUsers.mockReturnValue({
        data: mockMembers,
        isLoading: false,
        isFetching: false,
        isFetched: true,
        isReady: true,
        error: null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      } as never);

      render(
        <Provider>
          <AssigneeSelector
            value="user-1"
            onChange={onChange}
            organizationId="org-123"
          />
        </Provider>
      );

      const user = userEvent.setup();
      const select = screen.getAllByRole("combobox")[0];
      await user.click(select);

      const unassignedOption = await screen.findByText("Unassigned");
      await user.click(unassignedOption);

      expect(onChange).toHaveBeenCalledWith(null);
    });
  });

  describe("error handling", () => {
    it("should display error message", () => {
      const errorMessage = "Failed to load members";
      mockUseUsers.mockReturnValue({
        data: [],
        isLoading: false,
        isFetching: false,
        isFetched: true,
        isReady: false,
        error: new Error(errorMessage),
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      } as never);

      render(
        <Provider>
          <AssigneeSelector
            value={null}
            onChange={vi.fn()}
            organizationId="org-123"
          />
        </Provider>
      );

      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });

    it("should show error state styling", () => {
      mockUseUsers.mockReturnValue({
        data: [],
        isLoading: false,
        isFetching: false,
        isFetched: true,
        isReady: false,
        error: new Error("API Error"),
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      } as never);

      const { container } = render(
        <Provider>
          <AssigneeSelector
            value={null}
            onChange={vi.fn()}
            organizationId="org-123"
          />
        </Provider>
      );

      expect(container.querySelector(".Mui-error")).not.toBeNull();
    });
  });

  describe("props", () => {
    it("should respect disabled prop", () => {
      mockUseUsers.mockReturnValue({
        data: mockMembers,
        isLoading: false,
        isFetching: false,
        isFetched: true,
        isReady: true,
        error: null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      } as never);

      const { container } = render(
        <Provider>
          <AssigneeSelector
            value={null}
            onChange={vi.fn()}
            organizationId="org-123"
            disabled
          />
        </Provider>
      );

      const select = container.querySelector(
        "[role='combobox']"
      ) as HTMLElement;
      expect(select).toHaveAttribute("aria-disabled", "true");
    });

    it("should display helper text", () => {
      mockUseUsers.mockReturnValue({
        data: mockMembers,
        isLoading: false,
        isFetching: false,
        isFetched: true,
        isReady: true,
        error: null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      } as never);

      render(
        <Provider>
          <AssigneeSelector
            value={null}
            onChange={vi.fn()}
            organizationId="org-123"
            helperText="Select a team member"
          />
        </Provider>
      );

      expect(screen.getByText("Select a team member")).toBeInTheDocument();
    });

    it("should support fullWidth prop", () => {
      mockUseUsers.mockReturnValue({
        data: mockMembers,
        isLoading: false,
        isFetching: false,
        isFetched: true,
        isReady: true,
        error: null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      } as never);

      const { container } = render(
        <Provider>
          <AssigneeSelector
            value={null}
            onChange={vi.fn()}
            organizationId="org-123"
            fullWidth
          />
        </Provider>
      );

      const formControl = container.querySelector(
        ".MuiFormControl-fullWidth"
      ) as HTMLElement;
      expect(formControl).toBeInTheDocument();
    });
  });

  describe("assign to me", () => {
    const renderWithUsers = (
      props: Partial<ComponentProps<typeof AssigneeSelector>> = {}
    ) => {
      mockUseUsers.mockReturnValue({
        data: mockMembers,
        isLoading: false,
        isFetching: false,
        isFetched: true,
        isReady: true,
        error: null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      } as never);

      return render(
        <Provider>
          <AssigneeSelector
            value={null}
            onChange={vi.fn()}
            organizationId="org-123"
            {...props}
          />
        </Provider>
      );
    };

    it("renders the inline button when enabled and current user differs from value", () => {
      mockUseAuth.mockReturnValue(mockAuthValue("user-2"));
      renderWithUsers({ enableAssignToMe: true, value: "user-1" });

      expect(
        screen.getByRole("button", { name: "Assign to me" })
      ).toBeInTheDocument();
    });

    it("calls onChange with the current user id when clicked", async () => {
      mockUseAuth.mockReturnValue(mockAuthValue("user-2"));
      const onChange = vi.fn();
      renderWithUsers({
        enableAssignToMe: true,
        value: "user-1",
        onChange,
      });

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Assign to me" }));

      expect(onChange).toHaveBeenCalledWith("user-2");
    });

    it("hides the button when current user already equals the value", () => {
      mockUseAuth.mockReturnValue(mockAuthValue("user-1"));
      renderWithUsers({ enableAssignToMe: true, value: "user-1" });

      expect(
        screen.queryByRole("button", { name: "Assign to me" })
      ).not.toBeInTheDocument();
    });

    it("does not render the button when the prop is omitted", () => {
      mockUseAuth.mockReturnValue(mockAuthValue("user-2"));
      renderWithUsers({ value: "user-1" });

      expect(
        screen.queryByRole("button", { name: "Assign to me" })
      ).not.toBeInTheDocument();
    });

    it("does not render the button when enableAssignToMe is false", () => {
      mockUseAuth.mockReturnValue(mockAuthValue("user-2"));
      renderWithUsers({ enableAssignToMe: false, value: "user-1" });

      expect(
        screen.queryByRole("button", { name: "Assign to me" })
      ).not.toBeInTheDocument();
    });

    it("does not render the button when there is no active user", () => {
      mockUseAuth.mockReturnValue(mockAuthValue(null));
      renderWithUsers({ enableAssignToMe: true, value: "user-1" });

      expect(
        screen.queryByRole("button", { name: "Assign to me" })
      ).not.toBeInTheDocument();
    });

    it("does not render the button when disabled", () => {
      mockUseAuth.mockReturnValue(mockAuthValue("user-2"));
      renderWithUsers({
        enableAssignToMe: true,
        value: "user-1",
        disabled: true,
      });

      expect(
        screen.queryByRole("button", { name: "Assign to me" })
      ).not.toBeInTheDocument();
    });
  });
});
