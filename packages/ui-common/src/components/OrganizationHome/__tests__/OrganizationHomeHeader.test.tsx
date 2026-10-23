import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  OrganizationHomeHeader,
  type OrganizationHomeHeaderProps,
} from "../OrganizationHomeHeader";

const props = (): OrganizationHomeHeaderProps => ({
  userName: "Alex",
  organization: { id: "first", name: "First organization" },
  organizations: [
    { id: "first", name: "First organization" },
    { id: "second", name: "Second organization" },
  ],
  defaultState: { status: "ready", preference: { organizationId: null } },
  onOrganizationChange: vi.fn().mockResolvedValue(undefined),
  onSetDefault: vi.fn().mockResolvedValue(undefined),
  onRetryDefault: vi.fn().mockResolvedValue(undefined),
  onLogout: vi.fn().mockResolvedValue(undefined),
});

describe("Home organization header", () => {
  it("exposes Logout beside the signed-in user and reports sign-out failures", async () => {
    const input = props();
    input.onLogout = vi.fn().mockRejectedValue(new Error("Sign-out failed"));
    render(<OrganizationHomeHeader {...input} />);

    const userName = screen.getByTestId("organization-home-user-name");
    const logoutButton = screen.getByTestId("organization-home-logout");
    expect(userName.parentElement).toContainElement(logoutButton);

    await userEvent.click(logoutButton);

    expect(input.onLogout).toHaveBeenCalledOnce();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to log out. Please try again."
    );
    expect(logoutButton).toBeEnabled();
  });

  it("prevents duplicate Logout actions while sign-out is pending", async () => {
    let resolveLogout: (() => void) | undefined;
    const input = props();
    input.onLogout = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLogout = resolve;
        })
    );
    render(<OrganizationHomeHeader {...input} />);

    const logoutButton = screen.getByTestId("organization-home-logout");
    await userEvent.click(logoutButton);

    expect(logoutButton).toBeDisabled();
    expect(logoutButton).toHaveTextContent("Logging out…");
    expect(input.onLogout).toHaveBeenCalledOnce();

    resolveLogout?.();

    expect(await screen.findByText("Logout")).toBeEnabled();
  });

  it("keeps the confirmed choice until the host supplies confirmation and saves separately", async () => {
    const input = props();
    render(<OrganizationHomeHeader {...input} />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(
      screen.getByRole("option", { name: "Second organization" })
    );
    expect(input.onOrganizationChange).toHaveBeenCalledWith("second");
    expect(screen.getByRole("combobox")).toHaveTextContent(
      "First organization"
    );
    expect(input.onSetDefault).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Set as default" })
    );
    expect(input.onSetDefault).toHaveBeenCalledWith("first");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables unknown and pending defaults, shows failure, then server-confirmed success", () => {
    const input = props();
    const { rerender } = render(
      <OrganizationHomeHeader {...input} defaultState={{ status: "loading" }} />
    );
    expect(screen.getByTestId("organization-home-set-default")).toBeDisabled();
    rerender(
      <OrganizationHomeHeader
        {...input}
        defaultState={{
          status: "saving",
          preference: { organizationId: null },
        }}
      />
    );
    expect(screen.getByTestId("organization-home-set-default")).toBeDisabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(
      <OrganizationHomeHeader
        {...input}
        defaultState={{
          status: "save-error",
          preference: { organizationId: null },
          message: "Save denied",
        }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Save denied");
    expect(screen.getByTestId("organization-home-set-default")).toBeEnabled();
    rerender(
      <OrganizationHomeHeader
        {...input}
        defaultState={{
          status: "saved",
          preference: { organizationId: "first" },
        }}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Default organization saved."
    );
    expect(screen.getByTestId("organization-home-set-default")).toBeDisabled();
  });
});
