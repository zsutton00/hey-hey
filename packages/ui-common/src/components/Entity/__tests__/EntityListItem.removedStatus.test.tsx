import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { EntityListItem } from "../EntityListItem";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

const renderRow = (statusNeedsReplacement: boolean) =>
  render(
    <BrowserRouter>
      <EntityListItem
        title="Rosemary bread"
        status="Testing"
        statusNeedsReplacement={statusNeedsReplacement}
      />
    </BrowserRouter>,
  );

describe("EntityListItem removed status", () => {
  it("keeps the saved status and shows the warning as its own element", () => {
    renderRow(true);

    const warning = screen.getByTestId("entity-list-item-status-warning");

    expect(within(warning).getByText("Needs a new status")).toBeVisible();
    expect(screen.getByText("Testing")).toBeVisible();
    expect(screen.queryByText(/Testing · Needs/)).toBeNull();
  });

  it("shows no warning for a status the type still defines", () => {
    renderRow(false);

    expect(screen.queryByTestId("entity-list-item-status-warning")).toBeNull();
  });
});
