import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoSandboxResponseDto } from "../../../api";
import i18n from "../../../i18n";
import { DemoSandboxBanner } from "../DemoSandboxBanner";

const useDemoSandbox = vi.hoisted(() => vi.fn());

vi.mock("../../../data/hooks/useDemoSandbox", () => ({
  useDemoSandbox,
}));

const sandbox: DemoSandboxResponseDto = {
  organizationId: "org-1",
  projectId: "project-1",
  expiresAt: "2026-10-17T14:30:00.000Z",
  inactivityTimeoutSeconds: 7200,
  repositoryUrl: "https://github.com/hey-hey/demo-template.git",
  resumed: false,
};

const renderBanner = (props: { enabled?: boolean } = {}) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <DemoSandboxBanner {...props} />
      </MemoryRouter>
    </I18nextProvider>
  );

const originalClipboard = navigator.clipboard;

describe("DemoSandboxBanner", () => {
  beforeEach(() => {
    useDemoSandbox.mockReturnValue({
      sandbox,
      isReady: true,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    useDemoSandbox.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
    });
  });

  it("renders nothing for a user who is not in a sandbox", () => {
    useDemoSandbox.mockReturnValue({
      sandbox: null,
      isReady: true,
      isLoading: false,
      error: null,
    });

    renderBanner();

    expect(screen.queryByTestId("demo-sandbox-banner")).not.toBeInTheDocument();
  });

  it("polls and refetches on focus, and honors the enabled flag", () => {
    renderBanner({ enabled: false });

    expect(useDemoSandbox).toHaveBeenCalledWith({
      enabled: false,
      poll: true,
      refetchOnWindowFocus: true,
    });
  });

  it("shows the temporary notice, the policy from the API timeout and the server-reported expiry", () => {
    renderBanner();

    expect(screen.getByText("Temporary private demo")).toBeInTheDocument();
    expect(screen.getByTestId("demo-sandbox-policy")).toHaveTextContent(
      "expires after 2 hours of inactivity"
    );
    expect(screen.getByTestId("demo-sandbox-expiry")).toHaveTextContent(
      new Date(sandbox.expiresAt).toLocaleString()
    );
    expect(screen.getByTestId("demo-sandbox-expiry")).toHaveTextContent(
      "server reported"
    );
  });

  it("states a non-hour timeout in minutes", () => {
    useDemoSandbox.mockReturnValue({
      sandbox: { ...sandbox, inactivityTimeoutSeconds: 1800 },
      isReady: true,
      isLoading: false,
      error: null,
    });

    renderBanner();

    expect(screen.getByTestId("demo-sandbox-policy")).toHaveTextContent(
      "30 minutes"
    );
  });

  it("links to the existing pairing flow and the example repository", () => {
    renderBanner();

    expect(screen.getByTestId("demo-sandbox-pair-link")).toHaveAttribute(
      "href",
      "/pairing"
    );
    expect(screen.getByTestId("demo-sandbox-repository-link")).toHaveAttribute(
      "href",
      sandbox.repositoryUrl
    );
  });

  it("shows a git clone command and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderBanner();

    expect(screen.getByTestId("demo-sandbox-clone-command")).toHaveTextContent(
      `git clone ${sandbox.repositoryUrl}`
    );
    fireEvent.click(screen.getByTestId("demo-sandbox-copy-clone"));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`git clone ${sandbox.repositoryUrl}`)
    );
  });
});
