import { render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchInputsSurface } from "./SearchInputsSurface";

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

const renderSurface = () =>
  render(
    <ThemeProvider theme={createTheme()}>
      <SearchInputsSurface>
        <div className="MuiInputBase-adornedEnd">
          <span className="MuiTypography-root" data-testid="typography-helper">
            Press enter to search
          </span>
        </div>
        <span className="MuiInputAdornment-root" data-testid="adornment-helper">
          Press enter to search
        </span>
      </SearchInputsSurface>
    </ThemeProvider>,
  );

describe("SearchInputsSurface", () => {
  afterEach(() => {
    setMobileViewport(false);
  });

  it("hides both shared helper renderings on mobile and preserves them on desktop", () => {
    setMobileViewport(true);
    const { unmount } = renderSurface();

    expect(screen.getByTestId("typography-helper")).toHaveStyle({
      display: "none",
    });
    expect(screen.getByTestId("adornment-helper")).toHaveStyle({
      display: "none",
    });

    unmount();
    setMobileViewport(false);
    renderSurface();

    expect(screen.getByTestId("typography-helper")).toHaveStyle({
      display: "flex",
    });
    expect(screen.getByTestId("adornment-helper")).toHaveStyle({
      display: "flex",
    });
  });
});
