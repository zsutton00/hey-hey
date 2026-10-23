import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { OrganizationAccessBoundary } from "./OrganizationAccessBoundary";

const state = vi.hoisted(() => ({
  user: { currentOrganizationId: null as string | null },
  organizationSelection: null as null | {
    user: { id: string; name: string };
    status: string;
    organizations: { id: string; name: string }[];
  },
  switchingOrganization: false,
  switchOrganization: vi.fn(),
  logout: vi.fn(),
  loading: false,
}));
vi.mock("@hey-hey/ui-common/context", () => ({ useAuth: () => state }));
beforeEach(() => {
  state.user = { currentOrganizationId: null };
  state.organizationSelection = null;
  state.switchingOrganization = false;
  state.switchOrganization.mockReset().mockResolvedValue(undefined);
});

it("opens Home immediately and confirms the header choice before mounting scoped consumers", async () => {
  state.organizationSelection = {
    user: { id: "user-a", name: "Alex" },
    status: "selection_required",
    organizations: [{ id: "org-a", name: "Acme" }],
  };
  const showHome = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <OrganizationAccessBoundary showHome={showHome} leaveProject={vi.fn()}>
      <div>Scoped consumers</div>
    </OrganizationAccessBoundary>
  );
  expect(state.switchOrganization).not.toHaveBeenCalled();
  expect(showHome).toHaveBeenCalledOnce();
  expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
  expect(screen.getByRole("combobox")).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Acme" })).toBeNull();
  expect(screen.queryByText("Scoped consumers")).toBeNull();
  fireEvent.mouseDown(screen.getByRole("combobox"));
  fireEvent.click(screen.getByRole("option", { name: "Acme" }));
  await waitFor(() =>
    expect(state.switchOrganization).toHaveBeenCalledWith("org-a")
  );
  expect(screen.queryByText("Scoped consumers")).toBeNull();
  state.organizationSelection = null;
  state.user.currentOrganizationId = "org-a";
  view.rerender(
    <OrganizationAccessBoundary showHome={showHome} leaveProject={vi.fn()}>
      <div>Scoped consumers</div>
    </OrganizationAccessBoundary>
  );
  await waitFor(() =>
    expect(screen.getByText("Scoped consumers")).toBeInTheDocument()
  );
  expect(showHome).toHaveBeenCalledOnce();
});

it("keeps Home visible with a retryable error after confirmation fails", async () => {
  state.organizationSelection = {
    user: { id: "user-a", name: "Alex" },
    status: "selection_required",
    organizations: [{ id: "org-a", name: "Acme" }],
  };
  state.switchOrganization.mockRejectedValue(
    new Error("Unable to confirm organization")
  );
  render(
    <OrganizationAccessBoundary
      showHome={vi.fn().mockResolvedValue(undefined)}
      leaveProject={vi.fn()}
    >
      <div>Scoped consumers</div>
    </OrganizationAccessBoundary>
  );
  fireEvent.mouseDown(screen.getByRole("combobox"));
  fireEvent.click(screen.getByRole("option", { name: "Acme" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to confirm organization"
  );
  expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
  expect(screen.queryByText("Scoped consumers")).not.toBeInTheDocument();
});

it("leaves the old project before mounting the newly confirmed scope", async () => {
  state.user.currentOrganizationId = "org-a";
  let finish!: () => void;
  const leaveProject = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const children = <div>Scoped consumers</div>;
  const view = render(
    <OrganizationAccessBoundary
      showHome={vi.fn().mockResolvedValue(undefined)}
      leaveProject={leaveProject}
    >
      {children}
    </OrganizationAccessBoundary>
  );
  await waitFor(() =>
    expect(screen.getByText("Scoped consumers")).toBeInTheDocument()
  );
  state.user.currentOrganizationId = "org-b";
  view.rerender(
    <OrganizationAccessBoundary
      showHome={vi.fn().mockResolvedValue(undefined)}
      leaveProject={leaveProject}
    >
      {children}
    </OrganizationAccessBoundary>
  );
  expect(screen.queryByText("Scoped consumers")).toBeNull();
  expect(leaveProject).toHaveBeenCalledOnce();
  finish();
  await waitFor(() =>
    expect(screen.getByText("Scoped consumers")).toBeInTheDocument()
  );
});

it("retains a project on same-organization confirmation", () => {
  state.user.currentOrganizationId = "org-a";
  const leaveProject = vi.fn();
  const view = render(
    <OrganizationAccessBoundary
      showHome={vi.fn().mockResolvedValue(undefined)}
      leaveProject={leaveProject}
    >
      <div>Project</div>
    </OrganizationAccessBoundary>
  );
  state.switchingOrganization = true;
  view.rerender(
    <OrganizationAccessBoundary
      showHome={vi.fn().mockResolvedValue(undefined)}
      leaveProject={leaveProject}
    >
      <div>Project</div>
    </OrganizationAccessBoundary>
  );
  expect(screen.queryByText("Project")).toBeNull();
  state.switchingOrganization = false;
  view.rerender(
    <OrganizationAccessBoundary
      showHome={vi.fn().mockResolvedValue(undefined)}
      leaveProject={leaveProject}
    >
      <div>Project</div>
    </OrganizationAccessBoundary>
  );
  expect(screen.getByText("Project")).toBeInTheDocument();
  expect(leaveProject).not.toHaveBeenCalled();
});

it("removes scoped consumers when background renewal loses selection", () => {
  state.user.currentOrganizationId = "org-a";
  const view = render(
    <OrganizationAccessBoundary
      showHome={vi.fn().mockResolvedValue(undefined)}
      leaveProject={vi.fn()}
    >
      <div>Project</div>
    </OrganizationAccessBoundary>
  );
  state.user.currentOrganizationId = null;
  state.organizationSelection = {
    user: { id: "user-a", name: "Alex" },
    status: "selection_denied",
    organizations: [],
  };
  view.rerender(
    <OrganizationAccessBoundary
      showHome={vi.fn().mockResolvedValue(undefined)}
      leaveProject={vi.fn()}
    >
      <div>Project</div>
    </OrganizationAccessBoundary>
  );
  expect(screen.queryByText("Project")).toBeNull();
  expect(screen.getByText(/No accessible organizations/)).toBeInTheDocument();
});
