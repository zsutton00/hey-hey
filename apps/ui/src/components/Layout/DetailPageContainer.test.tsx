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

describe("DetailPageContainer", () => {
  it("applies the Data Layer forced-refetch-on-mount policy to page content", () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <DetailPageContainer>
          <div>Page content</div>
        </DetailPageContainer>
      </ThemeProvider>
    );

    expect(screen.getByTestId("query-mount-policy")).toHaveAttribute(
      "data-policy",
      "always-refetch"
    );
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });
});
