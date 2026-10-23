import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";

const mocks = vi.hoisted(() => ({ usePlatformAdminAccess: vi.fn() }));
vi.mock("@hey-hey/ui-common/data", () => ({
  usePlatformAdminAccess: mocks.usePlatformAdminAccess,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div data-testid="home-page" />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route
            path="organizations"
            element={<div data-testid="organizations-page" />}
          />
          <Route
            path="beta-access"
            element={<div data-testid="beta-access-page" />}
          />
          <Route path="demo" element={<div data-testid="demo-page" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

describe("AdminLayout", () => {
  beforeEach(() =>
    mocks.usePlatformAdminAccess.mockReturnValue({
      isPlatformAdmin: true,
      isResolved: true,
    }),
  );

  it("serves Beta access at /admin/beta-access with its tab selected", () => {
    renderAt("/admin/beta-access");

    expect(screen.getByTestId("beta-access-page")).toBeInTheDocument();
    const tab = screen.getByTestId("admin-tab-beta-access");
    expect(tab).toHaveAttribute("href", "/admin/beta-access");
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("admin-tab-demo")).toHaveAttribute(
      "href",
      "/admin/demo",
    );
  });

  it("waits for the server's answer before admitting or turning anyone away", () => {
    mocks.usePlatformAdminAccess.mockReturnValue({
      isPlatformAdmin: false,
      isResolved: false,
    });
    renderAt("/admin/beta-access");

    expect(screen.getByTestId("admin-access-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("beta-access-page")).toBeNull();
    expect(screen.queryByTestId("home-page")).toBeNull();
  });

  it("sends people who aren't platform admins away from every admin tab", () => {
    mocks.usePlatformAdminAccess.mockReturnValue({
      isPlatformAdmin: false,
      isResolved: true,
    });
    for (const path of [
      "/admin/organizations",
      "/admin/beta-access",
      "/admin/demo",
    ]) {
      const view = renderAt(path);
      expect(screen.getByTestId("home-page")).toBeInTheDocument();
      expect(screen.queryByTestId("admin-layout")).toBeNull();
      view.unmount();
    }
  });
});
