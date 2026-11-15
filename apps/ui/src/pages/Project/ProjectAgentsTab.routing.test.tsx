import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsAdapter } from "nuqs/adapters/react-router";
import React from "react";
import {
  BrowserRouter,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChangesRedirect } from "../Changes/ChangesRedirect";
import { ProjectAgentsTab } from "./ProjectAgentsTab";

const registry = vi.hoisted(() => ({
  isReady: true,
  error: null as Error | null,
  workItemTypes: [
    {
      id: "type-eval",
      projectId: "project-1",
      status: "ACTIVE",
      definition: { key: "EVAL", name: "Evaluations", role: "monitor" },
    },
  ],
}));
vi.mock("@hey-hey/ui-common/data", () => ({
  useWorkItemTypes: () => registry,
}));
vi.mock("../../components/Tabs/ProjectWorkItemsTab", () => ({
  ProjectWorkItemsTab: () => <div>Eval discovery</div>,
}));
vi.mock("../../components/Activity", () => ({
  PaginatedCodingSessionsFeed: () => <div>Sessions</div>,
  PaginatedSessionFeed: () => <div>Conversations panel</div>,
}));
vi.mock("@hey-hey/ui-common/components", () => ({
  TaskMonitorActivityTab: () => <div>Automation panel</div>,
}));
vi.mock("../Changes/ChangesView", () => ({
  ChangesView: () => <div>Changes panel</div>,
}));
vi.mock("./views", () => ({ CostsView: () => null, UsageView: () => null }));

const tab = (projectId = "project-1") => (
  <BrowserRouter>
    <NuqsAdapter>
      <ProjectAgentsTab
        organizationId="org-1"
        projectId={projectId}
        userId="user-1"
      />
    </NuqsAdapter>
  </BrowserRouter>
);
const query = () => new URLSearchParams(window.location.search);
describe("Agents Eval URL restoration", () => {
  beforeEach(() => {
    registry.isReady = true;
    registry.error = null;
    window.history.replaceState(
      {},
      "",
      "/projects/project-1?tab=agents&agentsSubTab=evals&keep=yes",
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });
  it("retains a direct URL through delayed readiness, failure, recovery and remount", () => {
    registry.isReady = false;
    const view = render(tab());
    expect(screen.getByText("Loading evaluations…")).toBeInTheDocument();
    expect(query().get("agentsSubTab")).toBe("evals");
    registry.error = new Error("offline");
    view.rerender(tab());
    expect(
      screen.getByText("Evaluations are unavailable for this project."),
    ).toBeInTheDocument();
    registry.error = null;
    registry.isReady = true;
    view.rerender(tab());
    expect(screen.getByText("Eval discovery")).toBeInTheDocument();
    view.unmount();
    render(tab());
    expect(screen.getByText("Eval discovery")).toBeInTheDocument();
    expect(query().get("keep")).toBe("yes");
  });
  it("pushes desktop selections and restores browser back and forward", async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole("button", { name: "Automation" }));
    await waitFor(() => expect(query().get("agentsSubTab")).toBe("automation"));
    expect(screen.getByText("Automation panel")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Evaluations" }));
    await waitFor(() => expect(query().get("agentsSubTab")).toBe("evals"));
    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.getByText("Automation panel")).toBeInTheDocument(),
    );
    act(() => window.history.forward());
    await waitFor(() =>
      expect(screen.getByText("Eval discovery")).toBeInTheDocument(),
    );
    expect(query().get("keep")).toBe("yes");
  });
  it("selects Evals using the mobile dropdown", async () => {
    vi.mocked(window.matchMedia).mockImplementation(
      () =>
        ({
          matches: true,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    window.history.replaceState(
      {},
      "",
      "/projects/project-1?tab=agents&agentsSubTab=automation&keep=yes",
    );
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Evaluations" }));
    await waitFor(() => expect(query().get("agentsSubTab")).toBe("evals"));
    expect(screen.getByText("Eval discovery")).toBeInTheDocument();
    expect(query().get("keep")).toBe("yes");
  });
  it("withholds the old project's Evals when project identity changes", () => {
    const view = render(tab());
    expect(screen.getByText("Eval discovery")).toBeInTheDocument();
    view.rerender(tab("project-2"));
    expect(screen.queryByText("Eval discovery")).not.toBeInTheDocument();
    expect(
      screen.getByText("Evaluations are unavailable for this project."),
    ).toBeInTheDocument();
    expect(query().get("agentsSubTab")).toBe("evals");
    view.rerender(tab());
    expect(screen.getByText("Eval discovery")).toBeInTheDocument();
  });
  it("shows Changes right after Agent Sessions and renders its list from the URL", () => {
    window.history.replaceState(
      {},
      "",
      "/projects/project-1?tab=agents&agentsSubTab=changes&agentSessionId=s1",
    );
    render(tab());
    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(labels.indexOf("Changes")).toBe(
      labels.indexOf("Agent Sessions") + 1,
    );
    expect(screen.getByText("Changes panel")).toBeInTheDocument();
    expect(screen.queryByTestId("open-changes")).not.toBeInTheDocument();
  });

  it("redirects the old changes URL to the Agents Changes view with its filters", async () => {
    const Probe = () => {
      const location = useLocation();
      return (
        <div data-testid="probe">{`${location.pathname}${location.search}`}</div>
      );
    };
    render(
      <MemoryRouter
        initialEntries={[
          "/projects/project-1/changes?agentSessionId=s1&offset=50",
        ]}
      >
        <Routes>
          <Route
            path="/projects/:projectId/changes"
            element={<ChangesRedirect />}
          />
          <Route path="/projects/:projectId" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("probe")).toBeInTheDocument(),
    );
    const target = new URL(
      screen.getByTestId("probe").textContent ?? "",
      "http://x",
    );
    expect(target.pathname).toBe("/projects/project-1");
    expect(Object.fromEntries(target.searchParams)).toEqual({
      tab: "agents",
      agentsSubTab: "changes",
      agentSessionId: "s1",
      offset: "50",
    });
  });
});
