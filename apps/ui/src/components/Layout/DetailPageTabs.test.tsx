import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@hey-hey/ui-common/components", () => ({
  ResponsiveTabs: ({
    tabs,
  }: {
    tabs: Array<{ value: string; label: string }>;
  }) => (
    <div role="tablist">
      {tabs.map((tab) => (
        <button key={tab.value} role="tab" type="button">
          {tab.label}
        </button>
      ))}
    </div>
  ),
}));

import { DetailPageTabs } from "./DetailPageTabs";

describe("DetailPageTabs", () => {
  it("renders the shared page navigation with a mobile compact sizing contract", () => {
    render(
      <DetailPageTabs
        value="project"
        onChange={vi.fn()}
        tabs={[
          { value: "project", label: "Overview" },
          { value: "features", label: "Features" },
          { value: "plans", label: "Plans" },
        ]}
      />,
    );

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
  });

  it("renders role type lists as tooltips without changing the tab label", async () => {
    render(
      <DetailPageTabs
        value="work-item"
        onChange={vi.fn()}
        tabs={[
          {
            value: "work-item",
            label: "Work Items",
            tooltip: "Types: Tasks, Bugs",
          },
        ]}
      />,
    );

    expect(screen.getByRole("tab", { name: "Work Items" })).toBeInTheDocument();
    fireEvent.mouseOver(screen.getByText("Work Items"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Types: Tasks, Bugs",
    );
  });
});
