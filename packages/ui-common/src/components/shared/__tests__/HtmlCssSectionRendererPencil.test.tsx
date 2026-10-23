import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunBrowserProvider } from "../../AgentSession/runtime/RunBrowserContext";
import type { MockupPageSource } from "../../../utils/mockupPageUrl";
import { HtmlCssSectionRenderer } from "../HtmlCssSectionRenderer";

const listRepos = vi.fn();
const openRunBrowserTab = vi.fn();

vi.mock(
  "../../AgentSession/runtime/directoryBindingApi",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../AgentSession/runtime/directoryBindingApi")
      >();
    return {
      ...actual,
      resolveLocalDirectoryRuntimeBaseUrl: () => "http://localhost:3847",
      createDirectoryBindingApi: () => ({ listRepos, openRunBrowserTab }),
    };
  },
);

vi.mock("../../../data/hooks/useUsers", () => ({
  useUsers: () => ({ data: [] }),
}));

const definition = {
  key: "preview",
  label: "Preview",
  kind: "html/css" as const,
  defaultSizeKey: "panel",
  sizeProfiles: [
    {
      key: "panel",
      label: "Panel",
      breakpoints: [
        {
          minContainerWidth: 0,
          inline: { width: 320, height: 200 },
          page: { width: 800, height: 600 },
        },
      ],
    },
    {
      key: "wide",
      label: "Wide",
      breakpoints: [
        {
          minContainerWidth: 0,
          inline: { width: 640, height: 200 },
          page: { width: 1200, height: 600 },
        },
      ],
    },
  ],
};

const ORG_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_ID = "10000000-0000-4000-8000-000000000002";
const WORK_ITEM_ID = "10000000-0000-4000-8000-000000000003";
const PROPOSAL_ID = "10000000-0000-4000-8000-000000000004";

const renderMockup = ({
  run = { runId: "run-1", sessionMachineId: "machine-1" },
  source = { kind: "workItem", workItemId: WORK_ITEM_ID },
  sizeKey,
}: {
  run?: { runId: string | null; sessionMachineId: string | null } | null;
  source?: MockupPageSource;
  sizeKey?: string;
} = {}) => {
  const mockup = (
    <HtmlCssSectionRenderer
      definition={definition}
      context="inline"
      content={{
        html: "<p>Hello</p>",
        css: "p { color: red; }",
        ...(sizeKey ? { sizeKey } : {}),
      }}
      organizationId={ORG_ID}
      projectId={PROJECT_ID}
      mockupSource={source}
    />
  );
  return render(
    run ? (
      <RunBrowserProvider value={run}>{mockup}</RunBrowserProvider>
    ) : (
      mockup
    ),
  );
};

const PENCIL = "html-css-open-in-browser";

beforeEach(() => {
  listRepos.mockReset();
  openRunBrowserTab.mockReset();
});

describe("HtmlCssSectionRenderer pencil", () => {
  it("shows an enabled pencil for a stored mockup inside a Run on the same computer", async () => {
    listRepos.mockResolvedValue({ machineId: "machine-1", bindings: [] });
    renderMockup();

    expect(screen.getByTestId(PENCIL)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId(PENCIL)).toBeEnabled());
  });

  it("places the pencil over the mockup preview, not in the control row", async () => {
    listRepos.mockResolvedValue({ machineId: "machine-1", bindings: [] });
    renderMockup();

    const pencil = screen.getByTestId(PENCIL);
    expect(screen.getByTestId("html-css-pencil-overlay").contains(pencil)).toBe(
      true,
    );
    expect(
      screen.getByTestId("html-css-section-controls").contains(pencil),
    ).toBe(false);
    await waitFor(() => expect(pencil).toBeEnabled());
  });

  it("shows no pencil outside an agent session", () => {
    listRepos.mockResolvedValue({ machineId: "machine-1", bindings: [] });
    renderMockup({ run: null });

    expect(screen.queryByTestId(PENCIL)).not.toBeInTheDocument();
  });

  it("shows no pencil for a mockup without a page source", () => {
    listRepos.mockResolvedValue({ machineId: "machine-1", bindings: [] });
    render(
      <RunBrowserProvider
        value={{ runId: "run-1", sessionMachineId: "machine-1" }}
      >
        <HtmlCssSectionRenderer
          definition={definition}
          context="inline"
          content={{ html: "<p>Hello</p>", css: "" }}
          organizationId={ORG_ID}
          projectId={PROJECT_ID}
        />
      </RunBrowserProvider>,
    );

    expect(screen.queryByTestId(PENCIL)).not.toBeInTheDocument();
  });

  it("disables the pencil with the same-computer reason when the CLI is another machine", async () => {
    listRepos.mockResolvedValue({ machineId: "machine-2", bindings: [] });
    renderMockup();

    await waitFor(() => expect(screen.getByTestId(PENCIL)).toBeDisabled());
    expect(
      screen.getByLabelText(
        "Open browser works only from a browser on the same computer as this session's CLI.",
      ),
    ).toBeInTheDocument();
  });

  it("disables the pencil before the session has a Run", async () => {
    listRepos.mockResolvedValue({ machineId: "machine-1", bindings: [] });
    renderMockup({ run: { runId: null, sessionMachineId: "machine-1" } });

    await waitFor(() =>
      expect(
        screen.getByLabelText("Start this session before opening its browser."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId(PENCIL)).toBeDisabled();
  });

  it("opens the mockup page at the default size in the Run's tab", async () => {
    listRepos.mockResolvedValue({ machineId: "machine-1", bindings: [] });
    openRunBrowserTab.mockResolvedValue({ runId: "run-1", url: "ignored" });
    renderMockup();
    await waitFor(() => expect(screen.getByTestId(PENCIL)).toBeEnabled());

    await act(async () => {
      screen.getByTestId(PENCIL).click();
    });

    expect(openRunBrowserTab).toHaveBeenCalledWith("run-1", {
      machineId: "machine-1",
      url: `http://localhost:3847/mockups/${WORK_ITEM_ID}?organizationId=${ORG_ID}&projectId=${PROJECT_ID}&size=panel`,
    });
  });

  it("opens the mockup page at the size the content shows", async () => {
    listRepos.mockResolvedValue({ machineId: "machine-1", bindings: [] });
    openRunBrowserTab.mockResolvedValue({ runId: "run-1", url: "ignored" });
    renderMockup({ sizeKey: "wide" });
    await waitFor(() => expect(screen.getByTestId(PENCIL)).toBeEnabled());

    await act(async () => {
      screen.getByTestId(PENCIL).click();
    });

    expect(openRunBrowserTab).toHaveBeenCalledWith("run-1", {
      machineId: "machine-1",
      url: `http://localhost:3847/mockups/${WORK_ITEM_ID}?organizationId=${ORG_ID}&projectId=${PROJECT_ID}&size=wide`,
    });
  });

  it("opens a proposal's mockup page with its section at the size shown", async () => {
    listRepos.mockResolvedValue({ machineId: "machine-1", bindings: [] });
    openRunBrowserTab.mockResolvedValue({ runId: "run-1", url: "ignored" });
    renderMockup({
      source: {
        kind: "proposal",
        proposalId: PROPOSAL_ID,
        sectionKey: "preview",
      },
      sizeKey: "wide",
    });
    await waitFor(() => expect(screen.getByTestId(PENCIL)).toBeEnabled());

    await act(async () => {
      screen.getByTestId(PENCIL).click();
    });

    expect(openRunBrowserTab).toHaveBeenCalledWith("run-1", {
      machineId: "machine-1",
      url: `http://localhost:3847/mockups/proposals/${PROPOSAL_ID}?organizationId=${ORG_ID}&projectId=${PROJECT_ID}&section=preview&size=wide`,
    });
  });

  it("explains a failed open through the tooltip", async () => {
    listRepos.mockResolvedValue({ machineId: "machine-1", bindings: [] });
    openRunBrowserTab.mockRejectedValue(new Error("Tab could not open."));
    renderMockup();
    await waitFor(() => expect(screen.getByTestId(PENCIL)).toBeEnabled());

    await act(async () => {
      screen.getByTestId(PENCIL).click();
    });

    expect(screen.getByLabelText("Tab could not open.")).toBeInTheDocument();
  });
});
