import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InstallAgentBridgeTerminalDemo } from "../InstallAgentBridgeTerminalDemo";

describe("InstallAgentBridgeTerminalDemo", () => {
  it("renders the terminal chrome, prompt glyph, and command container", () => {
    render(<InstallAgentBridgeTerminalDemo command="echo hi" />);

    const chrome = screen.getByTestId("install-agent-bridge-terminal-chrome");
    expect(chrome).toBeInTheDocument();

    expect(
      screen.getByTestId("install-agent-bridge-terminal-prompt")
    ).toHaveTextContent("$");

    const commandEl = screen.getByTestId(
      "install-agent-bridge-terminal-command"
    );
    expect(commandEl).toBeInTheDocument();
  });

  it("renders the full command immediately on mount", () => {
    const command = "npm install -g @hey-hey/cli";
    render(<InstallAgentBridgeTerminalDemo command={command} />);

    expect(
      screen.getByTestId("install-agent-bridge-terminal-command")
    ).toHaveTextContent(command);
  });

  it("copy button writes the command to the clipboard", async () => {
    const command = "npm install -g @hey-hey/cli";
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    render(<InstallAgentBridgeTerminalDemo command={command} />);

    const copyBtn = screen.getByTestId("install-agent-bridge-terminal-copy");
    await userEvent.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith(command);
  });
});
