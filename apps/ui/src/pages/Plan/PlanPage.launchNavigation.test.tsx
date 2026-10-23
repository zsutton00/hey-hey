import {
  createLaunchHarness,
  launchConfiguration,
  launchMocks,
  launchPlan,
  launchScope,
} from "../../../../ui-common/src/test/planLaunchHarness";
import { PlanGenerationChat } from "../../../../ui-common/src/components/AgentSession/PlanGenerationChat";
import type { ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PlanPage } from "./PlanPage";

vi.mock("@hey-hey/ui-common", () => ({
  createNavigationLineageEntry: (type: string, id: string) => ({ type, id }),
}));
vi.mock("@hey-hey/ui-common/context", () => ({
  CanonicalPageBoundary: ({ children }: { children: ReactNode }) => children,
  TrackingProvider: ({ children }: { children: ReactNode }) => children,
  createCanonicalPageDescriptor: () => ({}),
}));
vi.mock("@hey-hey/ui-common/data", () => ({
  usePlatformAdminAccess: () => ({ isPlatformAdmin: false, isResolved: true }),
  useCanonicalPlanAggregate: () => ({
    status: "ready",
    aggregate: { plan: launchPlan, configuration: launchConfiguration },
  }),
  useProject: () => ({ data: { name: "Project" } }),
  // A cache miss exercises the parent read fallback.
  useFeatureLookup: () => ({
    isReady: true,
    isLoading: false,
    get: () => undefined,
    resolveAncestry: () => ({ ancestors: [], complete: false }),
  }),
  useWorkItem: () => ({ workItem: null }),
}));
vi.mock("@hey-hey/ui-common/components", () => ({
  PlanGenerationChat: (
    props: React.ComponentProps<typeof PlanGenerationChat>,
  ) => <PlanGenerationChat {...props} />,
  DiscussCapsuleAction: () => null,
  PlanViewer: () => null,
  PlanWorktreeEditor: () => null,
  PlanAutomationTab: () => null,
  PlanArchiveDeleteDialog: () => null,
}));
vi.mock("../../components/Layout", () => ({
  DetailPageContainer: ({ children }: { children: ReactNode }) => children,
  DetailPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  PageBreadcrumbs: () => null,
}));
vi.mock("./PlanConversationTab", () => ({ PlanConversationTab: () => null }));
vi.mock("./PlanCompleteActionCapsule", () => ({
  PlanCompleteActionCapsule: () => null,
}));
vi.mock("../../components/Tabs/DataDebugTab", () => ({
  DataDebugTab: () => null,
}));
vi.mock("../../components/Tabs/DesignDocsTab", () => ({
  DesignDocsTab: () => null,
}));
vi.mock("../../components/Layout/LayoutMainBottomSpacingContext", () => ({
  useSuppressLayoutMainBottomSpacing: () => undefined,
}));
vi.mock("../../components/Layout/LayoutMainScrollOwnerContext", () => ({
  useLayoutMainScrollOwner: () => null,
}));
vi.mock("../../hooks/useRemainingViewportHeight", () => ({
  useRemainingViewportHeight: () => ({ containerRef: () => {}, height: 420 }),
}));

describe("PlanPage launch navigation", () => {
  it.each(["succeeded", "failed"] as const)(
    "re-enters the same pending launch and renders %s without redispatch",
    async (outcome) => {
      const harness = createLaunchHarness();
      render(
        <harness.Wrapper>
          <MemoryRouter initialEntries={["/plan"]}>
            <Link to="/away">Leave plan</Link>
            <Link to="/plan">Return to plan</Link>
            <Routes>
              <Route
                path="/plan"
                element={
                  <PlanPage
                    organizationId={launchScope.organizationId}
                    projectId={launchScope.projectId}
                    planId={launchPlan.id}
                  />
                }
              />
              <Route path="/away" element={<div>Another page</div>} />
            </Routes>
          </MemoryRouter>
        </harness.Wrapper>,
      );
      fireEvent.click(
        await screen.findByTestId("plan-from-design-doc-start-generating"),
      );
      await waitFor(() =>
        expect(harness.dependencies.startSession).toHaveBeenCalledTimes(1),
      );
      fireEvent.click(screen.getByText("Leave plan"));
      expect(screen.getByText("Another page")).toBeInTheDocument();
      fireEvent.click(screen.getByText("Return to plan"));
      expect(
        await screen.findByTestId("plan-generation-launch-progress"),
      ).toHaveTextContent("Waiting for CLI acceptance");
      expect(
        screen.getByTestId("plan-from-design-doc-start-generating"),
      ).toBeDisabled();
      fireEvent.click(screen.getByText("Leave plan"));
      await act(async () => harness.finish(outcome));
      fireEvent.click(screen.getByText("Return to plan"));
      if (outcome === "succeeded") {
        await screen.findByTestId("agent-launch-handoff");
        expect(
          screen.queryByTestId("plan-from-design-doc-start-generating"),
        ).not.toBeInTheDocument();
      } else {
        await screen.findByText(
          "Launch rejected. Check machine authorization and retry.",
        );
        expect(
          screen.getByTestId("plan-from-design-doc-start-generating"),
        ).toBeEnabled();
      }
      expect(harness.dependencies.startSession).toHaveBeenCalledTimes(1);
      expect(launchMocks.updateSession).toHaveBeenCalledTimes(1);
    },
  );
});
