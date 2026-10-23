import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { I18nextProvider } from "react-i18next";
import { createTheme, ThemeProvider } from "@mui/material";
import i18n from "@hey-hey/ui-common/i18n";
import Home from "./Home";
import { PublicMarketingShell } from "../components/Layout/PublicMarketingShell";

const capabilityRecords = [
  {
    title: "Your harness’ missing project management.",
    description:
      "Keep features, plans, decisions, conversations, and implementation connected in one workspace.",
  },
  {
    title: "You own the decisions.",
    description:
      "Agent proposals go through an auditable approval process. Configure who needs to approve and how many approvals are required.",
  },
  {
    title: "Project context that keeps up.",
    description:
      "Agents use your project context as they work and propose updates reflecting what changed and what they learned.",
  },
  {
    title: "Define what your project tracks.",
    description:
      "Add the types of information your project needs, including how they connect to the rest of your work.",
  },
  {
    title: "Use the plan you already have.",
    description:
      "Connect Claude, Codex, or OpenCode with your existing subscription.",
  },
  {
    title: "One project, multiple repositories.",
    description:
      "Coordinate related work across codebases within the same project context.",
  },
  {
    title: "Continue from your phone.",
    description:
      "Access your connected coding agent through Hey Hey while away from your desk.",
  },
  {
    title: "Make workflows visible.",
    description:
      "Map steps, decisions, and handoffs, with important agreements attached where they apply.",
  },
  {
    title: "From direction to implementation.",
    description:
      "Start with a project objective and develop it into a reviewable plan and implementation work.",
  },
] as const;

const removedProofCopy = [
  "Connect Claude, Codex, or OpenCode to Hey Hey and use anywhere.",
  "Whether you’re building an app, a game, or something that does not fit neatly into tickets",
  "Go from idea to implementation and back again.",
  "Agents can propose a sequence of project changes",
  "Some decisions are easier to see than describe",
  "Your project does not have to fit our template",
] as const;

const testState = vi.hoisted(() => ({
  user: null as { name: string; userId: string } | null,
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  useAuth: () => ({
    isAuthenticated: false,
    user: null,
    loading: false,
    login: vi.fn(),
    completeChangePassword: vi.fn(),
    logout: vi.fn(),
    toggleDevAdminMode: vi.fn(),
  }),
  useOrganization: () => ({
    currentOrganization: null,
    refreshOrganizations: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@hey-hey/ui-common/animations", () => ({
  FadeIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  StaggerChildren: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  HeyHeyBranding: () => <span className="MuiTypography-root">Hey Hey</span>,
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => testState.user,
}));

const LocationProbe = () => {
  const location = useLocation();

  return <div data-testid="current-location">{location.pathname}</div>;
};

const renderHome = (
  searchParams = "",
  hash = "",
  paletteMode: "light" | "dark" = "light",
): void => {
  window.history.replaceState({}, "", `/${searchParams}${hash}`);
  render(
    <ThemeProvider theme={createTheme({ palette: { mode: paletteMode } })}>
      <I18nextProvider i18n={i18n}>
        <NuqsTestingAdapter searchParams={searchParams}>
          <MemoryRouter initialEntries={[`/${searchParams}${hash}`]}>
            <PublicMarketingShell>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/request-access" element={<LocationProbe />} />
                <Route path="/login" element={<LocationProbe />} />
                <Route path="/home" element={<LocationProbe />} />
                <Route path="/demo" element={<LocationProbe />} />
              </Routes>
            </PublicMarketingShell>
          </MemoryRouter>
        </NuqsTestingAdapter>
      </I18nextProvider>
    </ThemeProvider>,
  );
};

const setMediaPreferences = (
  isMobile: boolean,
  prefersReducedMotion = false,
): void => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches:
      (isMobile && query === "(max-width:599.95px)") ||
      (prefersReducedMotion && query === "(prefers-reduced-motion: reduce)"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

const stubDemoAvailability = (available: boolean): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { available } }), { status: 200 }),
      ),
    ),
  );
};

describe("Home", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    stubDemoAvailability(false);
    testState.user = null;
    setMediaPreferences(false);
  });

  it("renders the approved capabilities in order as a semantic responsive list", () => {
    renderHome();

    const capabilities = screen.getByTestId("landing-why-hey-hey");
    const list = within(capabilities).getByRole("list");
    const items = within(list).getAllByRole("listitem");

    expect(items).toHaveLength(capabilityRecords.length);
    expect(window.getComputedStyle(list).display).toBe("grid");

    capabilityRecords.forEach((capability, index) => {
      const item = items[index];
      expect(item).toHaveAttribute(
        "data-testid",
        expect.stringContaining(`landing-capability-`),
      );
      expect(within(item).getByRole("heading", { level: 3 })).toHaveTextContent(
        capability.title,
      );
      expect(item).toHaveTextContent(capability.description);
      expect(item.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    });

    const styleText = Array.from(document.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .join("")
      .replace(/\s+/g, "");
    expect(styleText).toContain(
      "grid-template-columns:repeat(2,minmax(0,1fr))",
    );
  });

  it("renders the existing hero copy and preserves its three-view proof", () => {
    renderHome();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Hey Hey",
    );
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "A living workspace",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Connect plans, decisions, workflows, conversations, and implementation in one living graph. Agents help build and maintain your structure as the project changes.",
      ),
    ).toBeInTheDocument();

    const heroVideos = screen.getByTestId("landing-hero-videos");
    const heroVideo = heroVideos.querySelector("video");
    expect(heroVideo).not.toBeNull();
    expect(document.querySelectorAll("video")).toHaveLength(1);
    expect(within(heroVideos).getAllByRole("tab")).toHaveLength(3);
    expect(heroVideo).toHaveAttribute("autoplay");
    expect(heroVideo).toHaveAttribute("playsinline");
    expect((heroVideo as HTMLVideoElement).muted).toBe(true);
    expect(heroVideo).toHaveAttribute(
      "poster",
      expect.stringContaining("one-place-v4-poster.png"),
    );
  });

  it("keeps the hero product-proof selection behavior", async () => {
    const user = userEvent.setup();
    setMediaPreferences(false, true);
    renderHome();

    const heroVideos = screen.getByTestId("landing-hero-videos");
    expect(
      within(heroVideos).getByRole("heading", {
        level: 3,
        name: "One place for the whole project",
      }),
    ).toHaveStyle({ color: "rgb(255, 255, 255)" });

    const secondView = within(heroVideos).getByRole("tab", {
      name: "Show product video 2",
    });

    await user.click(secondView);

    expect(secondView).toHaveAttribute("aria-selected", "true");
    expect(
      within(heroVideos).getByRole("heading", {
        level: 3,
        name: "Use the plan you already have",
      }),
    ).toHaveStyle({ color: "rgb(8, 126, 139)" });

    const thirdView = within(heroVideos).getByRole("tab", {
      name: "Show product video 3",
    });

    await user.click(thirdView);

    expect(
      within(heroVideos).getByRole("heading", {
        level: 3,
        name: "The Living Workspace",
      }),
    ).toHaveStyle({ color: "rgb(25, 118, 210)" });
  });

  it("uses uppercase Work Sans for landing section headings", () => {
    renderHome();

    const heroTitle = screen.getByRole("heading", {
      level: 2,
      name: "A living workspace",
    });
    const whyHeyHeyTitle = screen.getByRole("heading", {
      level: 2,
      name: "Why Hey Hey",
    });

    expect(heroTitle).toHaveStyle({
      fontFamily:
        '"Work Sans", "Atkinson Hyperlegible", "Roboto", "Helvetica", "Arial", sans-serif',
      fontWeight: "900",
      textTransform: "uppercase",
    });
    expect(whyHeyHeyTitle).toHaveStyle({
      fontFamily:
        '"Work Sans", "Atkinson Hyperlegible", "Roboto", "Helvetica", "Arial", sans-serif',
      fontWeight: "900",
      textTransform: "uppercase",
    });
  });

  it("flows directly from capabilities to the beta CTA and public footer", () => {
    renderHome("", "", "dark");

    const hero = screen.getByTestId("landing-hero");
    const capabilities = screen.getByTestId("landing-capabilities");
    const betaCta = screen.getByTestId("landing-beta-cta");
    const footer = screen.getByTestId("site-legal-footer");

    expect(document.querySelector("[data-column-scroll-container]")).toBeNull();
    expect(window.getComputedStyle(hero).minHeight).not.toBe("100vh");
    expect(
      screen.queryByTestId("landing-proof-sections"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("landing-proof-section"),
    ).not.toBeInTheDocument();
    removedProofCopy.forEach((copy) => {
      expect(
        screen.queryByText(expect.stringContaining(copy)),
      ).not.toBeInTheDocument();
    });
    expect(capabilities.compareDocumentPosition(betaCta)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(betaCta.compareDocumentPosition(footer)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(window.getComputedStyle(betaCta).backgroundColor).toBe(
      "rgb(255, 255, 255)",
    );
  });

  it("swaps the hero CTA for the welcome sign-in form when ?welcome=1 is present", async () => {
    renderHome("?welcome=1&name=Ada", "#welcomeCredential=welcome-token");

    await waitFor(() => {
      expect(screen.getByTestId("welcome-form")).toBeInTheDocument();
    });

    expect(window.location.hash).toBe("");
    expect(screen.queryByTestId("landing-why-hey-hey")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("landing-proof-sections"),
    ).not.toBeInTheDocument();
  });

  it("routes signed-out acquisition CTAs to Request Access", async () => {
    const user = userEvent.setup();
    renderHome();

    const requestAccessButtons = screen.getAllByRole("button", {
      name: "Sign up",
    });
    expect(requestAccessButtons).toHaveLength(2);
    await user.click(requestAccessButtons[0]);

    expect(screen.getByTestId("current-location")).toHaveTextContent(
      "/request-access",
    );
  });

  it("hides View demo from signed-out visitors when the demo is switched off", async () => {
    renderHome();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await Promise.resolve();

    expect(
      screen.queryByRole("link", { name: "View demo" }),
    ).not.toBeInTheDocument();
  });

  it("offers View demo to signed-out visitors as a real link to the demo route", async () => {
    stubDemoAvailability(true);
    const user = userEvent.setup();
    renderHome();

    const viewDemo = await screen.findByRole("link", { name: "View demo" });
    expect(viewDemo).toHaveAttribute("href", "/demo");
    await user.click(viewDemo);

    expect(screen.getByTestId("current-location")).toHaveTextContent("/demo");
  });

  it("keeps View demo out of the authenticated state", async () => {
    stubDemoAvailability(true);
    testState.user = { name: "Ada", userId: "ada" };
    renderHome();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await Promise.resolve();

    expect(
      screen.queryByRole("link", { name: "View demo" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Go to my projects" }),
    ).toBeInTheDocument();
  });

  it("keeps View demo out of the welcome flow", async () => {
    stubDemoAvailability(true);
    renderHome("?welcome=1");

    await waitFor(() => {
      expect(screen.getByTestId("welcome-form")).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("link", { name: "View demo" }),
    ).not.toBeInTheDocument();
  });

  it("keeps Existing User Sign In on the login route", async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(
      screen.getByRole("button", { name: "Existing User Sign In" }),
    );

    expect(screen.getByTestId("current-location")).toHaveTextContent("/login");
  });

  it("routes authenticated navigation to organization Home", async () => {
    testState.user = { name: "Ada", userId: "ada" };
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole("button", { name: "Go to my projects" }));

    expect(screen.getByTestId("current-location")).toHaveTextContent("/home");
  });

  it("keeps the welcome form branch when name is missing", async () => {
    renderHome("?welcome=1");

    await waitFor(() => {
      expect(screen.getByTestId("welcome-form")).toBeInTheDocument();
    });
  });
});
