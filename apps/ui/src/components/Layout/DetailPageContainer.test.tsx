import { render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { describe, expect, it, vi } from "vitest";

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
});
