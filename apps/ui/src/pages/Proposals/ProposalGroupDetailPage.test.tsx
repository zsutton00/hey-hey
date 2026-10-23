import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProposalGroupDetailPage } from "./ProposalGroupDetailPage";

const { identity, detailViewSpy } = vi.hoisted(() => ({
  identity: { currentOrgId: "organization-id" as string | undefined },
  detailViewSpy: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: identity.currentOrgId }),
}));

vi.mock("./ProposalGroupDetailView", () => ({
  ProposalGroupDetailView: (props: unknown) => {
    detailViewSpy(props);
    return <div data-testid="proposal-group-detail-view" />;
  },
}));

function renderPage(
  initialEntry: string,
  path = "/projects/:projectId/proposal-groups/:groupId",
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path={path} element={<ProposalGroupDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  identity.currentOrgId = "organization-id";
  detailViewSpy.mockClear();
});

describe("ProposalGroupDetailPage", () => {
  it("propagates organization, project, and group route identity", () => {
    renderPage("/projects/project-id/proposal-groups/group-id");

    expect(screen.getByTestId("proposal-group-detail-view")).toBeInTheDocument();
    expect(detailViewSpy).toHaveBeenCalledWith({
      organizationId: "organization-id",
      projectId: "project-id",
      groupId: "group-id",
    });
  });

  it("reports missing route parameters explicitly", () => {
    renderPage("/projects/project-id", "/projects/:projectId");

    expect(screen.getByText("Missing required parameters.")).toBeInTheDocument();
    expect(detailViewSpy).not.toHaveBeenCalled();
  });

  it("reports a missing organization explicitly", () => {
    identity.currentOrgId = undefined;
    renderPage("/projects/project-id/proposal-groups/group-id");

    expect(screen.getByText("Missing required parameters.")).toBeInTheDocument();
    expect(detailViewSpy).not.toHaveBeenCalled();
  });
});
