import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import i18n from "@hey-hey/ui-common/i18n";
import { DemoStartPage } from "./DemoStartPage";

const mocks = vi.hoisted(() => {
  class DemoSandboxProvisionError extends Error {
    constructor(readonly failure: string) {
      super(failure);
    }
  }
  return {
    resume: vi.fn(),
    provision: vi.fn(),
    followSetup: vi.fn(),
    available: vi.fn(),
    siteKey: "site-key" as string | undefined,
    DemoSandboxProvisionError,
  };
});

vi.mock("@hey-hey/ui-common/data", () => ({
  DemoSandboxProvisionError: mocks.DemoSandboxProvisionError,
  useDemoSandboxAdmission: () => ({
    resume: mocks.resume,
    provision: mocks.provision,
    followSetup: mocks.followSetup,
  }),
}));

vi.mock("../../components/Homepage/landingPageCta", () => ({
  fetchDemoSandboxAvailable: mocks.available,
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  getBotCheckSiteKey: () => mocks.siteKey,
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  HeyHeyBranding: () => <span>Hey Hey</span>,
}));

vi.mock("./BotCheckWidget", () => ({
  BotCheckWidget: ({
    onToken,
    resetKey,
  }: {
    onToken: (token: string | null) => void;
    resetKey: number;
  }) => (
    <button
      type="button"
      data-testid="mock-bot-check"
      data-reset-key={resetKey}
      onClick={() => onToken(`token-${resetKey}`)}
    >
      Complete bot check
    </button>
  ),
}));

const sandbox = {
  organizationId: "org-1",
  projectId: "project-1",
  expiresAt: "2026-10-17T14:30:00.000Z",
  inactivityTimeoutSeconds: 7200,
  repositoryUrl: "https://example.com/demo.git",
  resumed: false,
};

const LocationProbe = ({ label }: { label: string }) => {
  const location = useLocation();
  return <div data-testid={label}>{location.pathname}</div>;
};

const renderPage = (): void => {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={["/demo"]}>
        <Routes>
          <Route path="/demo" element={<DemoStartPage />} />
          <Route
            path="/projects/:projectId"
            element={<LocationProbe label="project-page" />}
          />
          <Route
            path="/request-access"
            element={<LocationProbe label="request-access" />}
          />
          <Route path="/" element={<LocationProbe label="home" />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
};

const completeConsent = async (
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> => {
  await user.click(screen.getByTestId("demo-accept-checkbox"));
  await user.click(screen.getByTestId("mock-bot-check"));
};

describe("DemoStartPage", () => {
  beforeEach(() => {
    mocks.resume.mockReset();
    mocks.provision.mockReset();
    mocks.followSetup.mockReset().mockReturnValue(new Promise(() => {}));
    mocks.available.mockReset().mockResolvedValue(true);
    mocks.siteKey = "site-key";
  });

  afterEach(cleanup);

  it("routes a returning browser with an unexpired sandbox to its Project Page without the terms screen", async () => {
    mocks.resume.mockResolvedValue({ outcome: "ready", sandbox });

    renderPage();

    expect(await screen.findByTestId("project-page")).toHaveTextContent(
      "/projects/project-1",
    );
    expect(screen.queryByTestId("demo-consent")).not.toBeInTheDocument();
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("shows demo unavailable instead of the terms screen when the demo is switched off", async () => {
    mocks.resume.mockResolvedValue({ outcome: "none" });
    mocks.available.mockResolvedValue(false);

    renderPage();

    expect(
      await screen.findByTestId("demo-unavailable-page"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("demo-consent")).not.toBeInTheDocument();
  });

  it("still returns a browser to its unexpired sandbox when the demo is switched off", async () => {
    mocks.resume.mockResolvedValue({ outcome: "ready", sandbox });
    mocks.available.mockResolvedValue(false);

    renderPage();

    expect(await screen.findByTestId("project-page")).toBeInTheDocument();
  });

  it("shows demo unavailable when starting a new demo after expiry while switched off", async () => {
    const user = userEvent.setup();
    mocks.resume.mockResolvedValue({ outcome: "expired" });
    mocks.available.mockResolvedValue(false);

    renderPage();
    await user.click(await screen.findByTestId("demo-start-new"));

    expect(
      await screen.findByTestId("demo-unavailable-page"),
    ).toBeInTheDocument();
  });

  it("shows demo unavailable when the demo is switched off while the terms screen is open", async () => {
    const user = userEvent.setup();
    mocks.resume.mockResolvedValue({ outcome: "none" });
    mocks.provision.mockRejectedValue(
      new mocks.DemoSandboxProvisionError("DISABLED"),
    );

    renderPage();
    await screen.findByTestId("demo-consent");
    await completeConsent(user);
    await user.click(screen.getByTestId("demo-start-button"));

    expect(
      await screen.findByTestId("demo-unavailable-page"),
    ).toBeInTheDocument();
  });

  it("shows the expired page with a start-new action that opens the terms screen", async () => {
    const user = userEvent.setup();
    mocks.resume.mockResolvedValue({ outcome: "expired" });

    renderPage();

    expect(await screen.findByTestId("demo-expired-page")).toBeInTheDocument();
    expect(screen.getByText("Your demo has expired")).toBeInTheDocument();
    expect(mocks.provision).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("demo-start-new"));

    expect(await screen.findByTestId("demo-consent")).toBeInTheDocument();
  });

  it("explains the private temporary demo and keeps Start disabled until terms are accepted and the bot check passes", async () => {
    const user = userEvent.setup();
    mocks.resume.mockResolvedValue({ outcome: "none" });

    renderPage();

    expect(await screen.findByTestId("demo-consent")).toBeInTheDocument();
    expect(
      screen.getByText(/expires after two hours of inactivity/i),
    ).toBeInTheDocument();
    const start = screen.getByTestId("demo-start-button");
    expect(start).toBeDisabled();

    await user.click(screen.getByTestId("demo-accept-checkbox"));
    expect(start).toBeDisabled();

    await user.click(screen.getByTestId("mock-bot-check"));
    expect(start).toBeEnabled();
  });

  it("links the demo terms and Agent Bridge acknowledgment to the published documents", async () => {
    mocks.resume.mockResolvedValue({ outcome: "none" });

    renderPage();

    expect(
      await screen.findByRole("link", { name: "demo terms" }),
    ).toHaveAttribute("href", "/terms");
    expect(
      screen.getByRole("link", { name: "Agent Bridge acknowledgment" }),
    ).toHaveAttribute("href", "/security");
  });

  it("provisions with one combined consent and lands on the new Project Page", async () => {
    const user = userEvent.setup();
    mocks.resume.mockResolvedValue({ outcome: "none" });
    mocks.provision.mockResolvedValue({ outcome: "ready", sandbox });

    renderPage();
    await screen.findByTestId("demo-consent");
    await completeConsent(user);
    await user.click(screen.getByTestId("demo-start-button"));

    expect(mocks.provision).toHaveBeenCalledWith({
      botCheckToken: "token-0",
      demoTermsVersion: "demo-1.0",
      agentBridgeAcknowledgmentVersion: "demo-1.0",
    });
    expect(await screen.findByTestId("project-page")).toHaveTextContent(
      "/projects/project-1",
    );
  });

  it("shows demo unavailable with the beta access alternative when the program is at capacity", async () => {
    const user = userEvent.setup();
    mocks.resume.mockResolvedValue({ outcome: "none" });
    mocks.provision.mockRejectedValue(
      new mocks.DemoSandboxProvisionError("AT_CAPACITY"),
    );

    renderPage();
    await screen.findByTestId("demo-consent");
    await completeConsent(user);
    await user.click(screen.getByTestId("demo-start-button"));

    expect(
      await screen.findByTestId("demo-unavailable-page"),
    ).toBeInTheDocument();
    expect(screen.getByText("Demo unavailable right now")).toBeInTheDocument();
    const requestAccess = screen.getByTestId("demo-request-beta-access");
    expect(requestAccess).toHaveAttribute("href", "/request-access");
    await user.click(requestAccess);
    expect(await screen.findByTestId("request-access")).toBeInTheDocument();
  });

  it.each(["RATE_LIMITED", "BOT_CHECK_FAILED"])(
    "keeps the terms screen with a retry when creation fails with %s",
    async (code) => {
      const user = userEvent.setup();
      mocks.resume.mockResolvedValue({ outcome: "none" });
      mocks.provision
        .mockRejectedValueOnce(new mocks.DemoSandboxProvisionError(code))
        .mockResolvedValueOnce({ outcome: "ready", sandbox });

      renderPage();
      await screen.findByTestId("demo-consent");
      await completeConsent(user);
      await user.click(screen.getByTestId("demo-start-button"));

      expect(await screen.findByTestId("demo-start-error")).toBeInTheDocument();
      expect(
        screen.queryByTestId("demo-unavailable-page"),
      ).not.toBeInTheDocument();
      // The used bot-check token is discarded and a fresh challenge is mounted.
      expect(screen.getByTestId("demo-start-button")).toBeDisabled();
      expect(screen.getByTestId("mock-bot-check")).toHaveAttribute(
        "data-reset-key",
        "1",
      );

      await user.click(screen.getByTestId("mock-bot-check"));
      await user.click(screen.getByTestId("demo-start-button"));

      await waitFor(() =>
        expect(mocks.provision).toHaveBeenLastCalledWith(
          expect.objectContaining({ botCheckToken: "token-1" }),
        ),
      );
      expect(await screen.findByTestId("project-page")).toBeInTheDocument();
    },
  );

  it("shows the setup screen with the connected feature count after Start, then takes the visitor into the sandbox", async () => {
    const user = userEvent.setup();
    mocks.resume.mockResolvedValue({ outcome: "none" });
    mocks.provision.mockResolvedValue({
      outcome: "provisioning",
      progress: {
        stage: "COPYING",
        connectedFeatureCount: 0,
        totalFeatureCount: 0,
      },
    });
    let finish!: (result: unknown) => void;
    mocks.followSetup.mockImplementation(
      (onProgress: (progress: unknown) => void) => {
        onProgress({
          stage: "CONNECTING",
          connectedFeatureCount: 3,
          totalFeatureCount: 8,
        });
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    );

    renderPage();
    await screen.findByTestId("demo-consent");
    await completeConsent(user);
    await user.click(screen.getByTestId("demo-start-button"));

    expect(await screen.findByTestId("demo-setup")).toBeInTheDocument();
    expect(screen.queryByTestId("demo-consent")).not.toBeInTheDocument();
    expect(await screen.findByTestId("demo-setup-features")).toHaveTextContent(
      "3 of 8 features connected",
    );
    expect(screen.getByText(/can take a minute/i)).toBeInTheDocument();

    finish({ outcome: "ready", sandbox });
    expect(await screen.findByTestId("project-page")).toHaveTextContent(
      "/projects/project-1",
    );
  });

  it("returns a reloaded page to the setup screen instead of the terms screen", async () => {
    mocks.resume.mockResolvedValue({
      outcome: "provisioning",
      progress: {
        stage: "CONNECTING",
        connectedFeatureCount: 5,
        totalFeatureCount: 8,
      },
    });

    renderPage();

    expect(await screen.findByTestId("demo-setup-features")).toHaveTextContent(
      "5 of 8 features connected",
    );
    expect(screen.queryByTestId("demo-consent")).not.toBeInTheDocument();
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.followSetup).toHaveBeenCalled();
  });

  it("tells the visitor when progress can't be checked and lets them check again", async () => {
    const user = userEvent.setup();
    mocks.resume.mockResolvedValue({
      outcome: "provisioning",
      progress: {
        stage: "CONNECTING",
        connectedFeatureCount: 1,
        totalFeatureCount: 4,
      },
    });
    mocks.followSetup
      .mockImplementationOnce(
        (_onProgress: unknown, onReachable: (reachable: boolean) => void) => {
          onReachable(false);
          return new Promise(() => {});
        },
      )
      .mockResolvedValueOnce({ outcome: "ready", sandbox });

    renderPage();

    expect(
      await screen.findByTestId("demo-setup-unreachable"),
    ).toBeInTheDocument();
    // The visitor keeps their place: same setup screen, same counts.
    expect(screen.getByTestId("demo-setup-features")).toHaveTextContent(
      "1 of 4 features connected",
    );
    await user.click(screen.getByTestId("demo-setup-check-again"));

    expect(await screen.findByTestId("project-page")).toBeInTheDocument();
    expect(mocks.followSetup).toHaveBeenCalledTimes(2);
  });

  it("shows a failed setup with a Try again that opens the terms screen", async () => {
    const user = userEvent.setup();
    mocks.resume.mockResolvedValue({
      outcome: "provisioning",
      progress: {
        stage: "COPYING",
        connectedFeatureCount: 0,
        totalFeatureCount: 0,
      },
    });
    mocks.followSetup.mockResolvedValue({ outcome: "failed" });

    renderPage();

    expect(await screen.findByTestId("demo-setup-failed")).toBeInTheDocument();
    await user.click(screen.getByTestId("demo-setup-retry"));
    expect(await screen.findByTestId("demo-consent")).toBeInTheDocument();
  });

  it("offers a retry when the existing-demo check fails", async () => {
    const user = userEvent.setup();
    mocks.resume
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ outcome: "ready", sandbox });

    renderPage();

    await user.click(await screen.findByTestId("demo-retry-check"));

    expect(await screen.findByTestId("project-page")).toBeInTheDocument();
  });

  it("does not offer to start when no bot check is configured", async () => {
    mocks.siteKey = undefined;
    mocks.resume.mockResolvedValue({ outcome: "none" });

    renderPage();

    expect(
      await screen.findByTestId("demo-bot-check-unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("demo-start-button")).toBeDisabled();
  });
});
