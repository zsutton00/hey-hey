import { render, screen } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";
import { ProjectAdminDestination } from "./ProjectAdminDestination";

const subtab = vi.hoisted(() => vi.fn());
vi.mock("./ProjectHintsSubtab", () => ({
  ProjectHintsSubtab: (props: {
    projectId: string;
    organizationId: string;
  }) => {
    subtab(props);
    return <div>Graph Hints</div>;
  },
}));

describe("ProjectAdminDestination", () => {
  it("restores the URL-selected Hints subtab and passes the selected project scope", () => {
    const onUrlUpdate = vi.fn();
    render(
      <NuqsTestingAdapter
        searchParams="?tab=admin&adminSubTab=hints"
        onUrlUpdate={onUrlUpdate}
      >
        <ProjectAdminDestination
          projectId="project"
          organizationId="organization"
        />
      </NuqsTestingAdapter>,
    );
    expect(
      screen.getByRole("tab", { name: "Hints", selected: true }),
    ).toBeInTheDocument();
    expect(screen.getByText("Graph Hints")).toBeInTheDocument();
    expect(subtab).toHaveBeenCalledWith({
      projectId: "project",
      organizationId: "organization",
    });
    expect(onUrlUpdate).not.toHaveBeenCalled();
  });
});
