import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportDto } from "../../../api";
import { logger } from "../../../utils/logger";
import savedReports from "./fixtures/project-reports.json";

const query = vi.hoisted(() => vi.fn());
vi.mock("../../../data/hooks/useProjectReports", () => ({
  useProjectReports: query,
}));
import { ProjectReportsOverview } from "../ProjectReportsOverview";

const [newest, middle, oldest] = savedReports as unknown as ReportDto[];

const withBody = (report: ReportDto, body: unknown): ReportDto => ({
  ...report,
  payload: { ...(report.payload as object), body } as ReportDto["payload"],
});
const withPayload = (report: ReportDto, payload: unknown): ReportDto => ({
  ...report,
  payload: payload as ReportDto["payload"],
});

const Location = () => (
  <span data-testid="location">{useLocation().pathname}</span>
);
const mount = () =>
  render(
    <MemoryRouter>
      <ProjectReportsOverview organizationId="org" projectId="project" />
      <Location />
    </MemoryRouter>,
  );
const ready = (reports: ReportDto[]) => ({
  reports,
  isFetched: true,
  isLoading: false,
  error: null,
});

beforeEach(() => {
  query.mockReset();
  vi.restoreAllMocks();
  // jsdom has no layout; give previews a measurable width.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 480,
    height: 300,
  } as DOMRect);
});

describe("ProjectReportsOverview", () => {
  it("shows the latest three reports newest first and opens the chosen one", () => {
    query.mockReturnValue(ready([newest, middle, oldest]));
    const warn = vi.spyOn(logger, "warn");
    mount();

    expect(query).toHaveBeenCalledWith(
      "org",
      "project",
      expect.objectContaining({ limit: 3, offset: 0 }),
    );
    const tiles = screen.getAllByTestId("project-report-preview");
    expect(tiles.map((tile) => tile.getAttribute("data-report-id"))).toEqual([
      "report-new",
      "report-mid",
      "report-old",
    ]);
    expect(screen.getByTestId("project-report-latest")).toHaveAttribute(
      "data-report-id",
      "report-new",
    );
    expect(tiles[0]).toHaveTextContent("Weekly progress — Nov 5");
    expect(tiles[0]).toHaveTextContent("Latest");
    expect(tiles[0]).toHaveTextContent(
      "11/5/2026 – 11/12/2026 · Created 11/12/2026",
    );
    // Report timezone: 2026-11-05T08:00Z is still Nov 5 in Los Angeles, window starts Oct 29.
    expect(tiles[1]).toHaveTextContent(
      "10/28/2026 – 11/4/2026 · Created 11/5/2026",
    );
    // 24-hour window keeps times.
    expect(tiles[2]).toHaveTextContent(
      "10/28/2026, 12:00:00 AM – 10/29/2026, 12:00:00 AM · Created 10/29/2026",
    );
    expect(warn).not.toHaveBeenCalled();

    fireEvent.click(
      within(tiles[1]).getByRole("button", {
        name: "Open Weekly progress — Oct 29",
      }),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project/reports/report-mid",
    );
  });

  it("renders every preview as an inert, script-free frame", () => {
    query.mockReturnValue(ready([newest, middle, oldest]));
    mount();

    const frames = screen.getAllByTestId("project-report-preview-frame");
    expect(frames).toHaveLength(3);
    for (const frame of frames) {
      const srcdoc = frame.getAttribute("srcdoc") ?? "";
      expect(frame.getAttribute("sandbox")).toBe("");
      expect(frame).toHaveAttribute("tabindex", "-1");
      expect(frame).toHaveAttribute("aria-hidden", "true");
      expect(srcdoc).toContain("script-src 'none'");
      expect(srcdoc).not.toMatch(/<script/i);
      expect(srcdoc).not.toContain("@[");
      expect(srcdoc).not.toContain("tracker.example");
      expect(srcdoc).not.toContain("evil.example");
    }
    expect(frames[0].getAttribute("srcdoc")).toContain("Reports page");
  });

  it("shows only the large preview for one report", () => {
    query.mockReturnValue(ready([newest]));
    mount();
    expect(screen.getAllByTestId("project-report-preview")).toHaveLength(1);
    expect(screen.getByTestId("project-report-latest")).toBeInTheDocument();
  });

  it("offers creation in the empty state", () => {
    query.mockReturnValue(ready([]));
    mount();
    expect(screen.getByText("No project reports yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("project-report-create-route"));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project/reports/new",
    );
  });

  it("keeps the other previews when one report body is unusable, and logs why", () => {
    query.mockReturnValue(
      ready([newest, withBody(middle, { html: "  ", css: "" }), oldest]),
    );
    const warn = vi.spyOn(logger, "warn");
    mount();

    expect(screen.getAllByTestId("project-report-preview-frame")).toHaveLength(
      2,
    );
    const unavailable = screen.getByTestId(
      "project-report-preview-unavailable",
    );
    expect(unavailable).toHaveTextContent("Preview unavailable");
    const tile = screen.getAllByTestId("project-report-preview")[1];
    expect(tile).toHaveTextContent("Weekly progress — Oct 29");
    expect(tile).toHaveTextContent("Created 11/5/2026");
    expect(warn).toHaveBeenCalledWith(
      "ui",
      expect.any(String),
      expect.objectContaining({
        reportId: "report-mid",
        reason: "body-unusable",
      }),
    );
    fireEvent.click(within(tile).getByRole("button"));
    expect(screen.getByTestId("location")).toHaveTextContent("report-mid");
  });

  it("keeps the readable title and period when other metadata is missing, and logs why", () => {
    const { provenance: _provenance, ...withoutProvenance } =
      middle.payload as unknown as Record<string, unknown>;
    query.mockReturnValue(
      ready([newest, withPayload(middle, withoutProvenance), oldest]),
    );
    const warn = vi.spyOn(logger, "warn");
    mount();

    const tile = screen.getAllByTestId("project-report-preview")[1];
    expect(tile).toHaveTextContent("Weekly progress — Oct 29");
    expect(tile).toHaveTextContent(
      "10/28/2026 – 11/4/2026 · Created 11/5/2026",
    );
    expect(tile).not.toHaveTextContent("Details unavailable");
    expect(screen.getAllByTestId("project-report-preview-frame")).toHaveLength(
      3,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to the report's own title when the payload title is blank", () => {
    const payload = { ...(middle.payload as object), title: "  " };
    query.mockReturnValue(ready([newest, withPayload(middle, payload)]));
    const warn = vi.spyOn(logger, "warn");
    mount();

    const tile = screen.getAllByTestId("project-report-preview")[1];
    expect(tile).toHaveTextContent("Weekly progress — Oct 29");
    expect(tile).toHaveTextContent("Created 11/5/2026");
    expect(warn).toHaveBeenCalledWith(
      "ui",
      expect.any(String),
      expect.objectContaining({
        reportId: "report-mid",
        reason: "blank-title",
      }),
    );
  });

  it("keeps the creation date when the covered window is unreadable", () => {
    const payload = {
      ...(middle.payload as { scope: object }),
      scope: {
        ...(middle.payload as { scope: object }).scope,
        windowEnd: "nope",
      },
    };
    query.mockReturnValue(ready([newest, withPayload(middle, payload)]));
    const warn = vi.spyOn(logger, "warn");
    mount();

    const tile = screen.getAllByTestId("project-report-preview")[1];
    expect(tile).toHaveTextContent("Weekly progress — Oct 29");
    expect(tile).toHaveTextContent("Created 11/5/2026");
    expect(tile).not.toHaveTextContent("–");
    expect(warn).toHaveBeenCalledWith(
      "ui",
      expect.any(String),
      expect.objectContaining({
        reportId: "report-mid",
        reason: "invalid-dates",
      }),
    );
  });

  it("shows dates in UTC, labelled, when the report timezone is unusable", () => {
    const payload = {
      ...(middle.payload as { scope: object }),
      scope: {
        ...(middle.payload as { scope: object }).scope,
        timeZone: "Mars/Base",
      },
    };
    query.mockReturnValue(ready([newest, withPayload(middle, payload)]));
    const warn = vi.spyOn(logger, "warn");
    mount();

    const tile = screen.getAllByTestId("project-report-preview")[1];
    expect(tile).toHaveTextContent(
      "10/29/2026 – 11/5/2026 · Created 11/5/2026 (UTC)",
    );
    expect(warn).toHaveBeenCalledWith(
      "ui",
      expect.any(String),
      expect.objectContaining({
        reason: "unusable-time-zone",
        detail: "Mars/Base",
      }),
    );
  });

  it("shows only the report's own title when nothing else in the payload is readable", () => {
    query.mockReturnValue(
      ready([
        newest,
        { ...withPayload(middle, "garbage"), createdAt: "not a date" },
      ]),
    );
    const warn = vi.spyOn(logger, "warn");
    mount();

    const tile = screen.getAllByTestId("project-report-preview")[1];
    expect(tile).toHaveTextContent("Weekly progress — Oct 29");
    expect(tile).toHaveTextContent("Details unavailable");
    expect(warn).toHaveBeenCalledWith(
      "ui",
      expect.any(String),
      expect.objectContaining({
        reportId: "report-mid",
        reason: "payload-shape-invalid",
      }),
    );
  });

  it("never shows the title of, or opens, a report from another project", () => {
    query.mockReturnValue(
      ready([newest, { ...middle, projectId: "other" }, oldest]),
    );
    const warn = vi.spyOn(logger, "warn");
    mount();

    expect(
      screen.queryByText("Weekly progress — Oct 29"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Open / })).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith(
      "ui",
      expect.any(String),
      expect.objectContaining({
        reportId: "report-mid",
        reason: "other-organization-or-project",
      }),
    );
  });

  it("links to history and shows loading and failure states", () => {
    query.mockReturnValue(ready([newest]));
    const view = mount();
    expect(screen.getByTestId("project-report-history")).toHaveAttribute(
      "href",
      "/projects/project/reports",
    );

    query.mockReturnValue({ ...ready([]), isFetched: false, isLoading: true });
    view.rerender(
      <MemoryRouter>
        <ProjectReportsOverview organizationId="org" projectId="project" />
      </MemoryRouter>,
    );
    expect(
      screen.getByLabelText("Loading project reports"),
    ).toBeInTheDocument();

    const refetch = vi.fn();
    query.mockReturnValue({ ...ready([]), error: new Error("down"), refetch });
    view.rerender(
      <MemoryRouter>
        <ProjectReportsOverview organizationId="org" projectId="project" />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("Could not load project reports."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });
});
