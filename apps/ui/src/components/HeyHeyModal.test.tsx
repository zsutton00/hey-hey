import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeyHeyModal } from "./HeyHeyModal";
import { ModalType } from "@hey-hey/ui-common/context";

const { useModalMock, useUserIdentityMock } = vi.hoisted(() => ({
  useModalMock: vi.fn(),
  useUserIdentityMock: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hey-hey/ui-common/context")>();
  return { ...actual, useModal: useModalMock };
});

vi.mock("@hey-hey/ui-common/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hey-hey/ui-common/hooks")>();
  return { ...actual, useUserIdentity: useUserIdentityMock };
});

vi.mock("@hey-hey/ui-common/components/AdvancedSearch", () => ({
  AdvancedSearch: () => (
    <div data-testid="advanced-search">
      <div className="MuiInputBase-adornedEnd">
        <span className="MuiTypography-root" data-testid="search-helper">
          Press enter to search
        </span>
      </div>
    </div>
  ),
}));

vi.mock("@hey-hey/ui-common/components/DesignDoc", () => ({
  CreateDocumentContent: () => null,
}));

vi.mock("@hey-hey/ui-common/components/Entity", () => ({
  EntityIcon: () => null,
}));

vi.mock("@hey-hey/ui-common/components/shared/EntityPreview", () => ({
  EntityPreview: () => null,
}));

vi.mock("@hey-hey/ui-common/components/EntityViewer", () => ({
  EntityViewerLoader: () => null,
}));

vi.mock("@hey-hey/ui-common/components/Modals", () => ({
  SuggestedActionTaskModal: () => null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback }),
}));

vi.mock("../hooks", () => ({
  useActiveProjectId: () => "project-1",
}));

const setMobileViewport = (matches: boolean): void => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: matches && query.includes("max-width"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const renderSearchModal = () =>
  render(
    <MemoryRouter>
      <HeyHeyModal />
    </MemoryRouter>,
  );

describe("HeyHeyModal search surface", () => {
  beforeEach(() => {
    useUserIdentityMock.mockReturnValue({ currentOrgId: "org-1" });
    useModalMock.mockReturnValue({
      currentModal: {
        type: ModalType.ADVANCED_SEARCH,
        organizationId: "org-1",
        onSelect: vi.fn(),
      },
      closeModal: vi.fn(),
    });
  });

  it("hides the shared helper on mobile and preserves it on desktop", () => {
    setMobileViewport(true);
    const { unmount } = renderSearchModal();

    expect(screen.getByTestId("search-helper")).toHaveStyle({
      display: "none",
    });

    unmount();
    setMobileViewport(false);
    renderSearchModal();

    expect(screen.getByTestId("search-helper")).toHaveStyle({
      display: "flex",
    });
  });
});
