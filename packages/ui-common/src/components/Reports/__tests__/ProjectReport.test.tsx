import type { ReactElement } from "react";
import {
  act,
  fireEvent,
  render as renderWithTestingLibrary,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  ProjectReportCoverageStatusEnum,
  ProjectReportEvidenceReferenceKindEnum,
  ReportAudience,
  ReportType,
  type ProjectReportPayload,
  type ReportDto,
  type SnapshotReportPayload,
} from "../../../api";
import { ProjectContext } from "../../../contexts/ProjectContext";
import { ReportViewer } from "../ReportViewer";

const render = (ui: ReactElement) =>
  renderWithTestingLibrary(ui, { wrapper: MemoryRouter });

const basePayload: ProjectReportPayload = {
  reportType: "PROJECT_REPORT",
  title: "Weekly project state",
  summary: "Billing shipped; onboarding is blocked.",
  question: "What changed in billing this week?",
  scope: {
    projectId: "project-1",
    windowStart: "2026-09-24T00:00:00.000Z",
    windowEnd: "2026-10-01T00:00:00.000Z",
    timeZone: "Europe/London",
  },
  exclusions: [{ entityType: "TASK", entityId: "excluded-task" }],
  provenance: {
    requestId: "request-1",
    attemptId: "attempt-1",
    evidenceReadStartedAt: "2026-10-01T09:00:00.000Z",
    evidenceReadCompletedAt: "2026-10-01T09:05:00.000Z",
    evidence: [
      {
        key: "E1",
        subject: { entityType: "TASK", entityId: "task-1" },
        title: "Ship invoices",
        kind: ProjectReportEvidenceReferenceKindEnum.SelectedPeriod,
      },
    ],
  },
  coverage: {
    status: ProjectReportCoverageStatusEnum.Complete,
    matchingActivityCount: 4,
    processedActivityCount: 4,
    pagesRead: 1,
    limitations: [],
  },
  body: {
    html: '<main><p>Invoices <a href="https://example.com" data-evidence-key="E1">shipped</a> <span data-evidence-key="E9">x</span></p><script>top.x=1</script></main>',
    css: "main { color: red; }",
  },
};

const buildReport = (payload: unknown): ReportDto =>
  ({
    id: "project-report-1",
    organizationId: "org-1",
    audience: ReportAudience.WorkflowOnly,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-10-01T09:05:00.000Z",
    expiresAt: "2026-11-01T00:00:00.000Z",
    entities: [],
    reportType: ReportType.ProjectReport,
    title: "Weekly project state",
    payload,
  }) as ReportDto;

const prefix = "report-viewer-project-report-1-project-report";

describe("ProjectReport", () => {
  it.each(["click", "Enter", " "])(
    "navigates resolved citations using %s",
    async (activation) => {
      render(<ReportViewer report={buildReport(basePayload)} />);
      const frame = screen.getByTestId(
        `${prefix}-body-frame`,
      ) as HTMLIFrameElement;
      const document = new DOMParser().parseFromString(
        frame.srcdoc,
        "text/html",
      );
      const script = document.querySelector("script")?.textContent ?? "";
      const scroll = vi.fn();
      const item = screen.getByTestId(`${prefix}-evidence-item`);
      item.scrollIntoView = scroll;
      const postMessage = vi.fn((data: unknown) => {
        act(() => {
          window.dispatchEvent(
            new MessageEvent("message", { data, source: frame.contentWindow }),
          );
        });
      });
      new Function(
        "document",
        "Element",
        "parent",
        "ResizeObserver",
        "addEventListener",
        script,
      )(document, window.Element, { postMessage }, undefined, undefined);
      const citationCalls = () =>
        postMessage.mock.calls.filter(
          ([data]) =>
            (data as { type?: string }).type ===
            "hey-hey-project-report-citation",
        );
      const citation = document.querySelector('[data-evidence-key="E1"]');
      expect(citation?.getAttribute("tabindex")).toBe("0");
      const activate = (element: Element | null) => {
        element?.dispatchEvent(
          activation === "click"
            ? new MouseEvent("click", { bubbles: true, cancelable: true })
            : new KeyboardEvent("keydown", {
                key: activation,
                bubbles: true,
                cancelable: true,
              }),
        );
      };
      activate(document.querySelector('[data-evidence-key="E9"]'));
      expect(citationCalls()).toHaveLength(0);
      activate(citation);
      expect(citationCalls()).toHaveLength(1);
      expect(screen.getByTestId(`${prefix}-details-toggle`)).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await waitFor(() =>
        expect(scroll).toHaveBeenCalledWith({
          block: "center",
          behavior: "smooth",
        }),
      );
      expect(item).toHaveFocus();
      expect(
        screen.getByTestId(`${prefix}-evidence-unresolved`),
      ).toHaveTextContent("E9");
      scroll.mockClear();
      window.dispatchEvent(
        new MessageEvent("message", {
          data: citationCalls()[0][0],
          source: window,
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "hey-hey-project-report-citation",
            channelToken: "invalid",
            key: "E1",
          },
          source: frame.contentWindow,
        }),
      );
      expect(scroll).not.toHaveBeenCalled();
    },
  );
  it("renders mention tokens as host links that navigate to the entity", () => {
    const navigate = vi.fn();
    renderWithTestingLibrary(
      <MemoryRouter>
        <ProjectContext.Provider
          value={{ organizationId: "org-1", projectId: "project-1", navigate }}
        >
          <ReportViewer
            report={buildReport({
              ...basePayload,
              body: {
                html: '<p title="@[task:attr-1|Attr]">See @[task:task-1|Ship &lt;b&gt;invoices&lt;/b&gt;] and @\\[feature:feature-1|Billing], not @[task:BAD|Nope] or <span data-entity-type="task" data-entity-id="spoof">spoof</span>.</p>',
                css: "",
              },
            })}
          />
        </ProjectContext.Provider>
      </MemoryRouter>,
    );
    const frame = screen.getByTestId(
      `${prefix}-body-frame`,
    ) as HTMLIFrameElement;
    const document = new DOMParser().parseFromString(frame.srcdoc, "text/html");
    const links = Array.from(document.querySelectorAll("a.hh-mention"));
    expect(
      links.map((link) => [
        link.getAttribute("data-entity-type"),
        link.getAttribute("data-entity-id"),
        link.textContent,
      ]),
    ).toEqual([
      ["task", "task-1", "Ship <b>invoices</b>"],
      ["feature", "feature-1", "Billing"],
    ]);
    expect(document.querySelector("b")).toBeNull();
    expect(document.querySelector("p")?.getAttribute("title")).toBe(
      "@[task:attr-1|Attr]",
    );
    expect(document.body.textContent).toContain("@[task:BAD|Nope]");
    expect(document.querySelector("[data-entity-id='spoof']")).toBeNull();

    const script = document.querySelector("script")?.textContent ?? "";
    const postMessage = vi.fn((data: unknown) => {
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", { data, source: frame.contentWindow }),
        );
      });
    });
    new Function(
      "document",
      "Element",
      "parent",
      "ResizeObserver",
      "addEventListener",
      script,
    )(document, window.Element, { postMessage }, undefined, undefined);
    expect(links[1].getAttribute("tabindex")).toBe("0");
    links[1].dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0][0]).toContain("feature-1");

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "hey-hey-project-report-mention",
          channelToken: "invalid",
          entityType: "task",
          entityId: "task-1",
          entityName: "x",
        },
        source: frame.contentWindow,
      }),
    );
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("renders typed host content outside an isolated, script-free body", () => {
    render(<ReportViewer report={buildReport(basePayload)} />);

    expect(screen.getByTestId(`${prefix}-question`)).toHaveTextContent(
      "What changed in billing this week?",
    );
    expect(screen.getByTestId(`${prefix}-summary`)).toHaveTextContent(
      "Billing shipped",
    );
    expect(screen.getByTestId(`${prefix}-scope-period`)).toHaveTextContent(
      "Europe/London",
    );
    expect(screen.getByTestId(`${prefix}-coverage-status`)).toHaveTextContent(
      "Complete",
    );
    expect(
      screen.queryByTestId(`${prefix}-coverage-incomplete`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`${prefix}-provenance`),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId(prefix)).not.toHaveTextContent("request-1");
    expect(screen.getByTestId(prefix)).not.toHaveTextContent("attempt-1");

    const frame = screen.getByTestId(`${prefix}-body-frame`);
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(frame).toHaveStyle({ width: "100%" });
    const srcDoc = frame.getAttribute("srcdoc") ?? "";
    expect(srcDoc).toContain("connect-src 'none'");
    expect(srcDoc).not.toContain("top.x=1");
    expect(srcDoc).toContain("script-src 'nonce-");
    expect(srcDoc).not.toContain("https://example.com");
  });

  it("applies the Hey Hey report theme before authored CSS, not the work-item themes", () => {
    render(<ReportViewer report={buildReport(basePayload)} />);

    const frame = screen.getByTestId(
      `${prefix}-body-frame`,
    ) as HTMLIFrameElement;
    const document = new DOMParser().parseFromString(frame.srcdoc, "text/html");
    const styles = Array.from(document.head.querySelectorAll("style"));
    const hostTheme = styles.findIndex(
      (style) => style.dataset.hostTheme === "report",
    );
    const authored = styles.findIndex((style) =>
      style.hasAttribute("data-authored-css"),
    );
    expect(hostTheme).toBeGreaterThanOrEqual(0);
    expect(hostTheme).toBeLessThan(authored);
    expect(
      document.querySelector(
        'style[data-host-theme="modern"], style[data-host-theme="sketch"]',
      ),
    ).toBeNull();
    const theme = styles[hostTheme].textContent ?? "";
    expect(theme).toContain('"Atkinson Hyperlegible"');
    expect(theme).toContain('"Work Sans"');
    // Class vocabulary the CLI report author is told to use.
    for (const className of [
      "summary",
      "interpretation",
      "limitation",
      "stats",
      "stat-value",
      "stat-label",
      "timeline",
      "bars",
      "bar-label",
      "bar-value",
      "num",
      "muted",
    ]) {
      expect(theme).toContain(`.${className}`);
    }
  });

  it("shows the report first with collapsed details and one host title", () => {
    render(<ReportViewer report={buildReport(basePayload)} />);

    const root = screen.getByTestId(prefix);
    const body = screen.getByTestId(`${prefix}-body`);
    const details = screen.getByTestId(`${prefix}-details`);
    expect(
      body.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId(`${prefix}-details-toggle`)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      within(root).queryByText("Weekly project state"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Weekly project state")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Report details" }));
    expect(screen.getByTestId(`${prefix}-details-toggle`)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("renders its own title only when the viewer shows none", () => {
    const { unmount } = render(
      <ReportViewer report={buildReport(basePayload)} renderHeader={false} />,
    );
    expect(screen.getByTestId(`${prefix}-title`)).toHaveTextContent(
      "Weekly project state",
    );
    unmount();
    render(
      <ReportViewer
        report={buildReport(basePayload)}
        renderHeader={false}
        renderTitle={false}
      />,
    );
    expect(screen.queryByText("Weekly project state")).not.toBeInTheDocument();
  });

  it("hides a leading authored heading that repeats the host title", () => {
    render(
      <ReportViewer
        report={buildReport({
          ...basePayload,
          body: { html: "<h1> Weekly  project state</h1><p>Body</p>", css: "" },
        })}
      />,
    );
    const frame = screen.getByTestId(
      `${prefix}-body-frame`,
    ) as HTMLIFrameElement;
    const document = new DOMParser().parseFromString(frame.srcdoc, "text/html");
    const script = document.querySelector("script")?.textContent ?? "";
    new Function(
      "document",
      "Element",
      "parent",
      "ResizeObserver",
      "addEventListener",
      script,
    )(document, window.Element, { postMessage: vi.fn() }, undefined, undefined);
    expect(
      document.querySelector("h1")?.hasAttribute("data-host-duplicate-title"),
    ).toBe(true);
  });

  it("sizes the frame to the reported document height without inner scrolling", () => {
    render(<ReportViewer report={buildReport(basePayload)} />);
    const frame = screen.getByTestId(
      `${prefix}-body-frame`,
    ) as HTMLIFrameElement;
    const document = new DOMParser().parseFromString(frame.srcdoc, "text/html");
    expect(
      document.querySelector("style[data-host-review]")?.textContent,
    ).toContain("overflow-y: hidden");
    const script = document.querySelector("script")?.textContent ?? "";
    const postMessage = vi.fn();
    new Function(
      "document",
      "Element",
      "parent",
      "ResizeObserver",
      "addEventListener",
      script,
    )(document, window.Element, { postMessage }, undefined, undefined);
    const heightMessage = postMessage.mock.calls
      .map(([data]) => data as { type?: string; channelToken?: string })
      .find((data) => data.type === "hey-hey-project-report-height");
    expect(heightMessage).toBeDefined();
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { ...heightMessage, height: 2400 },
          source: frame.contentWindow,
        }),
      );
    });
    expect(frame).toHaveStyle({ height: "2400px" });
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { ...heightMessage, height: 3100 },
          source: window,
        }),
      );
    });
    expect(frame).toHaveStyle({ height: "2400px" });
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { ...heightMessage, height: 900 },
          source: frame.contentWindow,
        }),
      );
    });
    expect(frame).toHaveStyle({ height: "900px" });
  });

  it("measures content height so the frame can shrink after being tall", () => {
    render(<ReportViewer report={buildReport(basePayload)} />);
    const frame = screen.getByTestId(
      `${prefix}-body-frame`,
    ) as HTMLIFrameElement;
    const document = new DOMParser().parseFromString(frame.srcdoc, "text/html");
    const script = document.querySelector("script")?.textContent ?? "";
    // The root's scrollHeight is clamped up to the frame's height; the body's is the content.
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: 2400,
    });
    Object.defineProperty(document.body, "scrollHeight", { value: 800 });
    document.documentElement.getBoundingClientRect = () =>
      ({ height: 0 }) as DOMRect;
    const postMessage = vi.fn();
    new Function(
      "document",
      "Element",
      "parent",
      "ResizeObserver",
      "addEventListener",
      script,
    )(document, window.Element, { postMessage }, undefined, undefined);
    const heights = postMessage.mock.calls
      .map(([data]) => data as { type?: string; height?: number })
      .filter((data) => data.type === "hey-hey-project-report-height")
      .map((data) => data.height);
    expect(heights).toEqual([800]);
  });

  it("lists evidence accessibly and flags cited keys without typed references", () => {
    render(<ReportViewer report={buildReport(basePayload)} />);
    fireEvent.click(screen.getByRole("button", { name: "Report details" }));

    const list = screen.getByRole("list", { name: "Report evidence" });
    const items = within(list).getAllByTestId(`${prefix}-evidence-item`);
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Ship invoices");
    expect(items[0]).not.toHaveTextContent("[E1]");
    expect(items[0]).toHaveAttribute("data-cited", "true");
    expect(
      screen.getByTestId(`${prefix}-evidence-unresolved`),
    ).toHaveTextContent("E9");
  });

  it("makes incomplete coverage prominent", () => {
    render(
      <ReportViewer
        report={buildReport({
          ...basePayload,
          coverage: {
            ...basePayload.coverage,
            status: ProjectReportCoverageStatusEnum.Incomplete,
            processedActivityCount: 2,
            limitations: ["Activity read budget exhausted"],
          },
        })}
      />,
    );

    expect(
      screen.getByTestId(`${prefix}-coverage-incomplete`),
    ).toHaveTextContent("Incomplete report");
    expect(
      screen.getByTestId(`${prefix}-coverage-incomplete`),
    ).toHaveTextContent("Activity read budget exhausted");
    expect(screen.getByTestId(`${prefix}-coverage`)).toHaveTextContent(
      "Activity read budget exhausted",
    );
  });

  it("omits the read-count sentence when every matching activity was read", () => {
    render(
      <ReportViewer
        report={buildReport({
          ...basePayload,
          coverage: {
            ...basePayload.coverage,
            status: ProjectReportCoverageStatusEnum.Incomplete,
            limitations: ["ui-common had no default-branch commits"],
          },
        })}
      />,
    );

    const alert = screen.getByTestId(`${prefix}-coverage-incomplete`);
    expect(alert).toHaveTextContent("not exhaustive for the selected period");
    expect(alert).toHaveTextContent("ui-common had no default-branch commits");
    expect(alert).not.toHaveTextContent("matching activities were read");
  });

  it("keeps typed metadata when the authored body is unavailable", () => {
    render(
      <ReportViewer
        report={buildReport({ ...basePayload, body: { html: "", css: "" } })}
      />,
    );

    expect(
      screen.getByTestId(`${prefix}-body-unavailable`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`${prefix}-body-frame`),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId(`${prefix}-summary`)).toBeInTheDocument();
  });

  it("reports an invalid payload instead of rendering partial content", () => {
    render(
      <ReportViewer
        report={buildReport({ reportType: "PROJECT_REPORT", title: "x" })}
      />,
    );

    expect(
      screen.getByTestId(
        "report-viewer-project-report-1-project-report-invalid",
      ),
    ).toBeInTheDocument();
  });

  it("leaves other report types on their existing renderers", () => {
    render(
      <ReportViewer
        report={
          {
            ...buildReport(null),
            reportType: ReportType.Snapshot,
            payload: {
              reportType: "SNAPSHOT",
              summary: "Snapshot summary.",
            } satisfies SnapshotReportPayload,
          } as ReportDto
        }
      />,
    );

    expect(
      screen.getByTestId("report-viewer-project-report-1-snapshot"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(prefix)).not.toBeInTheDocument();
  });
});
