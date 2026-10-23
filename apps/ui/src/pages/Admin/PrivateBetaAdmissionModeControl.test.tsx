import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateBetaAdmissionModeControl } from "./PrivateBetaAdmissionModeControl";

const mocks = vi.hoisted(() => ({
  usePlatformAdminAccess: vi.fn(),
  useMode: vi.fn(),
  mutate: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  usePlatformAdminAccess: mocks.usePlatformAdminAccess,
  usePrivateBetaAdmissionMode: mocks.useMode,
}));

describe("PrivateBetaAdmissionModeControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePlatformAdminAccess.mockReturnValue({
      isPlatformAdmin: true,
      isResolved: true,
    });
    mocks.useMode.mockReturnValue({
      data: {
        mode: "OPEN",
        updatedAt: "2026-09-22T10:00:00.000Z",
        updatedByUserId: null,
      },
      isLoading: false,
      error: null,
      refetch: mocks.refetch,
      update: { mutate: mocks.mutate, isPending: false },
    });
    mocks.mutate.mockResolvedValue({
      mode: "PAUSED",
      updatedAt: "2026-09-22T10:01:00.000Z",
      updatedByUserId: "550e8400-e29b-41d4-a716-446655440027",
      alreadyCurrent: false,
    });
    mocks.refetch.mockResolvedValue(null);
  });

  it("does not render or load state for non-admin users", () => {
    mocks.usePlatformAdminAccess.mockReturnValue({
      isPlatformAdmin: false,
      isResolved: true,
    });

    render(<PrivateBetaAdmissionModeControl />);

    expect(mocks.useMode).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Self-service admissions"),
    ).not.toBeInTheDocument();
  });

  it("confirms a pause and reports the durable result", async () => {
    render(<PrivateBetaAdmissionModeControl />);

    fireEvent.click(
      screen.getByRole("button", { name: "Pause self-service admissions" }),
    );
    expect(
      screen.getByText(/New signups will remain pending/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledWith("PAUSED"));
    expect(
      await screen.findByText("Self-service admissions are paused."),
    ).toBeInTheDocument();
    expect(mocks.refetch).not.toHaveBeenCalled();
  });

  it("shows a sanitized authorization failure", async () => {
    mocks.mutate.mockRejectedValue({
      isAxiosError: true,
      response: { status: 403 },
    });
    render(<PrivateBetaAdmissionModeControl />);

    fireEvent.click(
      screen.getByRole("button", { name: "Pause self-service admissions" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(
      await screen.findByText(
        "You are not authorized to change self-service admissions.",
      ),
    ).toBeInTheDocument();
  });
});
