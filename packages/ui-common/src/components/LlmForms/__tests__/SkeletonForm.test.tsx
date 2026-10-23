import React from "react";
import { render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkeletonForm } from "../SkeletonForm";
import type { UIHints } from "../../../api";

vi.mock("../../../animations", () => ({
  SlideUp: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="slide-up">{children}</div>
  ),
  FadeIn: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="fade-in">{children}</div>
  ),
  Pulse: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pulse">{children}</div>
  ),
}));

const renderWithTheme = (ui: React.ReactNode) => {
  const theme = createTheme();
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
};

describe("SkeletonForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reduces fallback skeletons as elements arrive", () => {
    renderWithTheme(
      <SkeletonForm fallbackCount={3} deliveredElementCount={1} />
    );

    const skeletons = screen.getAllByTestId(/field-skeleton/);
    expect(skeletons).toHaveLength(2);
  });

  it("does not render fallback skeletons when all elements are delivered", () => {
    renderWithTheme(
      <SkeletonForm fallbackCount={2} deliveredElementCount={3} />
    );

    const skeletons = screen.queryAllByTestId(/field-skeleton/);
    expect(skeletons).toHaveLength(0);
  });

  it("reduces hinted skeletons based on delivered elements", () => {
    const uiHints: UIHints = {
      expectedElements: [
        { type: "text_input", count: 2 },
        { type: "textarea", count: 1 },
      ],
    };

    renderWithTheme(
      <SkeletonForm uiHints={uiHints} deliveredElementCount={1} />
    );

    const skeletons = screen.getAllByTestId(/field-skeleton/);
    expect(skeletons).toHaveLength(2);
    const textSkeletons = screen.getAllByTestId(/field-skeleton-text_input/);
    expect(textSkeletons).toHaveLength(2);
  });

  it("does not render hinted skeletons when elements exceed expectations", () => {
    const uiHints: UIHints = {
      expectedElements: [
        { type: "text_input", count: 1 },
        { type: "textarea", count: 1 },
      ],
    };

    renderWithTheme(
      <SkeletonForm uiHints={uiHints} deliveredElementCount={3} />
    );

    const skeletons = screen.queryAllByTestId(/field-skeleton/);
    expect(skeletons).toHaveLength(0);
  });
});
