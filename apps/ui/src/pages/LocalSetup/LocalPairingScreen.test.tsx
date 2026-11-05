import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import type { LocalCodingAgentDetectionDto } from "@hey-hey/ui-common/api";
import "@hey-hey/ui-common/i18n";
import { LocalPairingScreen } from "./LocalPairingScreen";

const renderScreen = (
  overrides: Partial<React.ComponentProps<typeof LocalPairingScreen>> = {},
) => {
  const handlers = {
    onCreatePasskey: vi.fn(),
    onCancel: vi.fn(),
    onCadenceChange: vi.fn(),
  };
  render(
    <LocalPairingScreen
      computerName="Ada's MacBook"
      agents={{
        claude: "installed",
        codex: "not-found",
        opencode: "installed",
      }}
      technicalDetails={[{ label: "Key fingerprint", value: "SHA256:abc" }]}
      ready
      busy={false}
      retryMessage={null}
      cadence="ONE_MONTH"
      {...handlers}
      {...overrides}
    />,
  );

  return handlers;
};

describe("LocalPairingScreen", () => {
  it("offers the five durations, shows the chosen one and explains the permission", async () => {
    const handlers = renderScreen();

    expect(
      screen
        .getAllByRole("radio")
        .map((radio) => (radio as HTMLInputElement).value),
    ).toEqual([
      "FIVE_MINUTES",
      "EIGHT_HOURS",
      "ONE_DAY",
      "ONE_WEEK",
      "ONE_MONTH",
    ]);
    expect(screen.getByRole("radio", { name: "1 month" })).toBeChecked();
    expect(screen.getByTestId("local-pairing-permission")).toHaveTextContent(
      /until this time ends or you revoke access/i,
    );

    await userEvent.click(screen.getByRole("radio", { name: "5 minutes" }));
    expect(handlers.onCadenceChange).toHaveBeenCalledWith("FIVE_MINUTES");
  });

  it("explains the passkey, the privacy promise and lists the agents found", () => {
    renderScreen();

    expect(
      screen.getByText(/creating a passkey so Hey Hey can work/i),
    ).toBeVisible();
    expect(screen.getByTestId("local-pairing-privacy")).toHaveTextContent(
      "No data ever leaves this computer",
    );
    expect(screen.getByTestId("local-pairing-agent-claude")).toHaveTextContent(
      "Claude Code: Found",
    );
    expect(screen.getByTestId("local-pairing-agent-codex")).toHaveTextContent(
      "Codex: Not found",
    );
    expect(screen.queryByTestId("local-pairing-none-found")).toBeNull();
    expect(screen.getByTestId("local-pairing-computer")).toHaveTextContent(
      "Ada's MacBook",
    );
  });

  it("says what to install when no coding agent was found", () => {
    const none: LocalCodingAgentDetectionDto = {
      claude: "not-found",
      codex: "not-found",
      opencode: "check-failed",
    };
    renderScreen({ agents: none });

    expect(screen.getByTestId("local-pairing-none-found")).toHaveTextContent(
      "run heyhey local again",
    );
  });

  it("keeps technical details collapsed until asked", async () => {
    const user = userEvent.setup();
    renderScreen();
    const details = screen.getByTestId("local-pairing-technical");

    expect(details).not.toHaveAttribute("open");
    await user.click(screen.getByText("Technical details"));
    expect(details).toHaveAttribute("open");
  });

  it("starts the passkey directly and can be cancelled; it waits while the enrollment is prepared", async () => {
    const user = userEvent.setup();
    const handlers = renderScreen();

    await user.click(screen.getByTestId("local-pairing-create-passkey"));
    await user.click(screen.getByTestId("local-pairing-cancel"));
    expect(handlers.onCreatePasskey).toHaveBeenCalledTimes(1);
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables Create passkey until the enrollment is ready", () => {
    renderScreen({ ready: false });

    expect(screen.getByTestId("local-pairing-create-passkey")).toBeDisabled();
  });
});
