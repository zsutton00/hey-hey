import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectHelpPage } from "../../NewOrgLanding/ProjectHelpPage";
import { DailySessionBriefing } from "../views/daily-session/DailySessionBriefing";

const mocks = vi.hoisted(() => ({
  intent: "selected" as string | undefined,
  features: [] as { id: string; name: string }[],
  existing: null as { id: string } | null,
  loading: false,
  error: null as Error | null,
  create: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("@hey-hey/ui-common/data", async (original) => ({
  ...(await original<typeof import("@hey-hey/ui-common/data")>()),
  useProject: () => ({
    isFetched: true,
    data: {
      status: "ACTIVE",
      config: mocks.intent
        ? { version: 1, existingWorkIntent: mocks.intent }
        : undefined,
    },
  }),
  useFeatures: () => ({ features: mocks.features }),
  useFeatureHierarchy: () => ({
    roots: mocks.features.map((feature) => ({ feature, children: [] })),
  }),
  useFeatureDocumentContent: () => ({ entries: new Map() }),
  useConversationByWorkflow: () => ({
    data: mocks.existing,
    isLoading: mocks.loading,
    error: mocks.error,
    refetch: mocks.refetch,
  }),
  useCreateConversation: () => ({ mutate: mocks.create }),
}));
vi.mock("../views/daily-session/useDailySessionBriefingReports", () => ({
  useDailySessionBriefingReports: () => ({
    availableBriefings: [],
    isLoading: false,
    reports: [],
    selectedParentReport: null,
  }),
}));
vi.mock("./helpDemoMap", () => ({
  buildHelpDemoMap: () => ({
    "install-agent-bridge": <div>Bridge demo</div>,
    "features-ready": <div>Features demo</div>,
    "create-a-service": <div>Service demo</div>,
    "create-a-task": <div>Task demo</div>,
    "first-agent-session": <div>Session demo</div>,
  }),
}));

function Location() {
  const location = useLocation();
  return (
    <output data-testid="import-location">
      {location.pathname + location.search}
    </output>
  );
}

describe.each(["help", "daily"] as const)(
  "%s setup import integration",
  (host) => {
    const mount = () =>
      render(
        <MemoryRouter initialEntries={["/projects/project?tab=help"]}>
          <NuqsTestingAdapter searchParams="?helpSubTab=welcome">
            {host === "help" ? (
              <ProjectHelpPage organizationId="org" projectId="project" />
            ) : (
              <DailySessionBriefing organizationId="org" projectId="project" />
            )}
            <Location />
          </NuqsTestingAdapter>
        </MemoryRouter>,
      );
    beforeEach(() => {
      vi.clearAllMocks();
      mocks.intent = "selected";
      mocks.features = [];
      mocks.existing = null;
      mocks.loading = false;
      mocks.error = null;
      mocks.create.mockResolvedValue({ id: "fresh-conversation" });
      mocks.refetch.mockImplementation(async () => {
        mocks.error = null;
        return null;
      });
    });
    it("starts a dedicated import from the real button with Show me how hidden", async () => {
      mount();
      expect(
        screen.queryByRole("button", { name: "Show me how" }),
      ).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "Import my service" }),
      );
      await waitFor(() =>
        expect(screen.getByTestId("import-location")).toHaveTextContent(
          "/repository-import?conversationId=fresh-conversation",
        ),
      );
      expect(mocks.create).toHaveBeenCalledOnce();
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org",
          projectId: "project",
          conversationDto: expect.objectContaining({
            workflowName: "repository-import",
          }),
        }),
      );
    });
    it.each(["resume", "new"] as const)(
      "offers the explicit %s choice",
      async (choice) => {
        mocks.existing = { id: "unfinished-conversation" };
        mount();
        fireEvent.click(
          screen.getByRole("button", { name: "Import my service" }),
        );
        const dialog = screen.getByRole("dialog");
        expect(mocks.create).not.toHaveBeenCalled();
        fireEvent.click(
          within(dialog).getByRole("button", {
            name: choice === "resume" ? "Resume existing" : "Start new import",
          }),
        );
        await waitFor(() =>
          expect(screen.getByTestId("import-location")).toHaveTextContent(
            "conversationId=" +
              (choice === "resume"
                ? "unfinished-conversation"
                : "fresh-conversation"),
          ),
        );
        expect(mocks.create).toHaveBeenCalledTimes(choice === "resume" ? 0 : 1);
      },
    );
    it("shows pending, creation failure and successful retry", async () => {
      let reject: (error: Error) => void = () => {};
      mocks.create.mockReturnValueOnce(
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
      );
      mount();
      const button = screen.getByRole("button", { name: "Import my service" });
      fireEvent.click(button);
      fireEvent.click(button);
      expect(button).toBeDisabled();
      expect(screen.getByTestId("help-action-pending")).toBeInTheDocument();
      expect(mocks.create).toHaveBeenCalledOnce();
      await act(async () => reject(new Error("Cannot create import")));
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Cannot create import",
      );
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() =>
        expect(screen.getByTestId("import-location")).toHaveTextContent(
          "conversationId=fresh-conversation",
        ),
      );
    });
    it("recovers lookup failure without creating before the explicit start", async () => {
      mocks.error = new Error("Cannot check imports");
      const view = mount();
      expect(
        screen.getByRole("button", { name: "Import my service" }),
      ).toBeDisabled();
      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: "Retry" })),
      );
      view.unmount();
      mount();
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Import my service" }),
        ).toBeEnabled(),
      );
      expect(mocks.create).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: "Import my service" }),
      );
      await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    });
    it.each(["selected", "declined", "unanswered", undefined])(
      "preserves persisted %s intent through remount regardless of feature count",
      (intent) => {
        mocks.intent = intent;
        for (const features of [
          [],
          [{ id: "feature", name: "Existing capability" }],
        ]) {
          mocks.features = features;
          const view = mount();
          if (intent === "selected") {
            expect(
              screen.getByRole("button", { name: "Import my service" }),
            ).toBeInTheDocument();
          } else {
            expect(
              screen.getByRole("link", { name: "Open guide →" }),
            ).toHaveAttribute(
              "href",
              "/projects/project?tab=help&helpSubTab=first-project",
            );
            expect(
              screen.queryByRole("button", { name: "Show me how" }),
            ).not.toBeInTheDocument();
          }
          expect(mocks.create).not.toHaveBeenCalled();
          view.unmount();
        }
      },
    );
  },
);
