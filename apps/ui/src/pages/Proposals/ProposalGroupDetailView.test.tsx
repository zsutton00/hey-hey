import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProposalGroupDetailView } from "./ProposalGroupDetailView";

const { groupReviewSpy, trackingSpy, breadcrumbsSpy } = vi.hoisted(() => ({
  groupReviewSpy: vi.fn(),
  trackingSpy: vi.fn(),
  breadcrumbsSpy: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  ProposalGroupReview: (props: unknown) => {
    groupReviewSpy(props);
    return <div data-testid="proposal-group-review" />;
  },
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  TrackingProvider: ({
    children,
    context,
  }: {
    children: ReactNode;
    context: unknown;
  }) => {
    trackingSpy(context);
    return children;
  },
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useProject: () => ({ data: { name: "Project Name" } }),
}));

vi.mock("@hey-hey/ui-common/i18n", () => ({
  compose: (value: string) => value,
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  WebPathService: {
    proposalGroup: ({
      projectId,
      groupId,
    }: {
      projectId: string;
      groupId: string;
    }) => `/projects/${projectId}/proposal-groups/${groupId}`,
  },
}));

vi.mock("../../components/Layout", () => ({
  DetailPageContainer: ({ children }: { children: ReactNode }) => children,
  DetailPageBody: ({ content }: { content: ReactNode }) => content,
  PageBreadcrumbs: (props: unknown) => {
    breadcrumbsSpy(props);
    return <nav data-testid="breadcrumbs" />;
  },
}));

describe("ProposalGroupDetailView", () => {
  it("renders canonical group review in project detail chrome", () => {
    render(
      <ProposalGroupDetailView
        organizationId="organization-id"
        projectId="project-id"
        groupId="group-id"
      />,
    );

    expect(screen.getByTestId("proposal-group-review")).toBeInTheDocument();
    expect(groupReviewSpy).toHaveBeenCalledWith({
      organizationId: "organization-id",
      projectId: "project-id",
      groupId: "group-id",
    });
    expect(trackingSpy).toHaveBeenCalledWith({
      page: {
        name: "proposal-group",
        path: "/projects/project-id/proposal-groups/group-id",
      },
    });
    expect(breadcrumbsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          { label: "Projects", to: "/projects" },
          {
            label: "Project Name",
            to: "/projects/project-id",
            type: "project",
          },
          {
            label: "Proposals",
            to: "/projects/project-id/proposals",
            type: "proposal",
          },
          { label: "Group", isCurrent: true },
        ],
      }),
    );
  });
});
