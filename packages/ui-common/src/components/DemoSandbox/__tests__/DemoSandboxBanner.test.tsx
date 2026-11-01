import { act, render, screen } from "@testing-library/react";
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
    </I18nextProvider>,
  );

describe("DemoSandboxBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T12:48:00.000Z"));
    useDemoSandbox.mockReturnValue({
      sandbox,
      isReady: true,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    useDemoSandbox.mockReset();
    vi.useRealTimers();
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

  it("shows the demo label, inactivity policy and countdown from server expiry", () => {
    const { rerender } = renderBanner();

    expect(screen.getByTestId("demo-sandbox-banner")).toHaveTextContent(
      "Demo sandbox · expires after 2 hours of inactivity · 1h 42m left",
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByTestId("demo-sandbox-banner")).toHaveTextContent(
      "1h 41m left",
    );

    useDemoSandbox.mockReturnValue({
      sandbox: { ...sandbox, expiresAt: "2026-10-17T14:49:00.000Z" },
    });
    rerender(
      <I18nextProvider i18n={i18n}>
        <DemoSandboxBanner />
      </I18nextProvider>,
    );
    expect(screen.getByTestId("demo-sandbox-banner")).toHaveTextContent(
      "2h 0m left",
    );
  });

  it("shows minutes below an hour and never shows negative time", () => {
    vi.setSystemTime(new Date("2026-10-17T14:00:00.000Z"));
    useDemoSandbox.mockReturnValue({
      sandbox: { ...sandbox, inactivityTimeoutSeconds: 1800 },
    });
    renderBanner();

    expect(screen.getByTestId("demo-sandbox-banner")).toHaveTextContent(
      "expires after 30 minutes of inactivity · 30m left",
    );
    act(() => vi.advanceTimersByTime(31 * 60_000));
    expect(screen.getByTestId("demo-sandbox-banner")).toHaveTextContent(
      "0m left",
    );
  });
});
