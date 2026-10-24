import React, { type PropsWithChildren } from "react";
import { render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { describe, expect, it, vi } from "vitest";

vi.mock("@hey-hey/ui-common/data", () => ({
  QueryMountPolicyProvider: ({
    children,
    policy,
  }: PropsWithChildren<{ policy: "default" | "always-refetch" }>) => (
    <div data-testid="query-mount-policy" data-policy={policy}>
      {children}
    </div>
  ),
}));

import { DetailPageContainer } from "./DetailPageContainer";
import { PreviewModal } from "../PreviewModal";
import { MemoryRouter } from "react-router-dom";

describe("DetailPageContainer", () => {
  it("fills the expanded preview content width without intrinsic graph overflow", () => {
    render(
      <MemoryRouter>
        <ThemeProvider theme={createTheme()}>
          <PreviewModal open onClose={vi.fn()}>
            <DetailPageContainer>
              <div>Diagram content</div>
            </DetailPageContainer>
          </PreviewModal>
        </ThemeProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("preview-modal-content")).toContainElement(
      screen.getByTestId("detail-page-container"),
    );
    expect(screen.getByTestId("detail-page-container")).toHaveStyle({
      width: "100%",
      minWidth: "0",
      boxSizing: "border-box",
      maxWidth: "none",
    });
  });

  it("applies the Data Layer forced-refetch-on-mount policy to page content", () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <DetailPageContainer>
          <div>Page content</div>
        </DetailPageContainer>
      </ThemeProvider>,
    );

    expect(screen.getByTestId("query-mount-policy")).toHaveAttribute(
      "data-policy",
      "always-refetch",
    );
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });
});
