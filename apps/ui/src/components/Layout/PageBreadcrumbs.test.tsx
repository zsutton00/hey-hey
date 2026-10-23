import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { BreadcrumbItem } from "@hey-hey/ui-common/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageBreadcrumbs } from "./PageBreadcrumbs";

// Stub the ui-common primitive: it pulls in jotai/useProject providers that are
// irrelevant to the portal-vs-in-flow behavior under test here.
vi.mock("@hey-hey/ui-common/components", () => ({
  Breadcrumbs: ({ items }: { items: BreadcrumbItem[] }) => (
    <nav data-testid="breadcrumbs">
      {items.map((item) => (
        <span key={item.label}>{item.label}</span>
      ))}
    </nav>
  ),
}));
import {
  MobileHeaderBreadcrumbProvider,
  MobileHeaderBreadcrumbSlot,
} from "./MobileHeaderBreadcrumbSlot";

const setMobileViewport = (isMobile: boolean): void => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    // MUI's breakpoints.down("md") compiles to a `max-width` media query.
    matches: isMobile && query.includes("max-width"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

const items: BreadcrumbItem[] = [
  { label: "Projects", to: "/projects" },
  { label: "My Project", isCurrent: true, type: "project" },
];

const renderWithSlot = () =>
  render(
    <MemoryRouter>
      <MobileHeaderBreadcrumbProvider>
        <div data-testid="header">
          <MobileHeaderBreadcrumbSlot />
        </div>
        <PageBreadcrumbs items={items} />
      </MobileHeaderBreadcrumbProvider>
    </MemoryRouter>,
  );

describe("PageBreadcrumbs", () => {
  afterEach(() => {
    setMobileViewport(false);
  });

  it("portals breadcrumbs into the mobile header slot on ≤ md", () => {
    setMobileViewport(true);

    renderWithSlot();

    const slot = screen.getByTestId("mobile-header-breadcrumb-slot");
    expect(within(slot).getByText("My Project")).toBeInTheDocument();
    expect(slot).toHaveStyle({
      justifyContent: "center",
      minWidth: "0",
      overflow: "visible",
      width: "100%",
    });
  });

  it("renders an in-flow bar on desktop, leaving the header slot empty", () => {
    setMobileViewport(false);

    renderWithSlot();

    const slot = screen.getByTestId("mobile-header-breadcrumb-slot");
    expect(within(slot).queryByText("My Project")).not.toBeInTheDocument();
    expect(screen.getByText("My Project")).toBeInTheDocument();
  });

  it("falls back to the in-flow bar on mobile when no slot is mounted", () => {
    setMobileViewport(true);

    render(
      <MemoryRouter>
        <PageBreadcrumbs items={items} />
      </MemoryRouter>,
    );

    expect(screen.getByText("My Project")).toBeInTheDocument();
  });
});
