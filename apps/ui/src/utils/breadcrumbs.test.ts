import { describe, expect, it, vi } from "vitest";
import { ProjectStatus } from "@hey-hey/ui-common/api";
import { AppEntityType, PageKind, getBreadcrumbs } from "./breadcrumbs";

vi.mock("@hey-hey/ui-common/services", async () => {
  const actual = await vi.importActual<
    typeof import("@hey-hey/ui-common/services")
  >("@hey-hey/ui-common/services");

  return {
    ...actual,
    WebPathService: {
      ...actual.WebPathService,
      returnToProject: (projectId: string) => `/projects/${projectId}`,
      returnToOnboarding: (projectId: string) =>
        `/projects/${projectId}/onboarding`,
      initiativeDetail: ({
        projectId,
        initiativeId,
      }: {
        projectId: string;
        initiativeId: string;
      }) => `/projects/${projectId}/initiatives/${initiativeId}`,
    },
  };
});

describe("getBreadcrumbs", () => {
  it("builds onboarding initiative edit trail with workstreams breadcrumb", () => {
    const crumbs = getBreadcrumbs(AppEntityType.Initiative, PageKind.Edit, {
      projectId: "p1",
      initiativeId: "i1",
      initiativeName: "Init",
      projectStatus: ProjectStatus.Onboarding,
      onboardingComplete: false,
    });

    expect(crumbs.map((c) => c.label)).toEqual([
      "Projects",
      "Onboarding",
      "Initiatives",
      "Init",
      "Edit",
    ]);
    expect(crumbs[1].to).toBe("/projects/p1/onboarding");
    expect(crumbs[2].to).toBe("/projects/p1/initiatives");
    expect(crumbs[3].to).toBe("/projects/p1/initiatives/i1");
    expect(crumbs[4].isCurrent).toBe(true);
  });

  it("builds active project initiative detail trail", () => {
    const crumbs = getBreadcrumbs(AppEntityType.Initiative, PageKind.Detail, {
      projectId: "p2",
      projectName: "Alpha",
      initiativeId: "i2",
      initiativeName: "Second",
      projectStatus: ProjectStatus.Active,
      onboardingComplete: true,
    });

    expect(crumbs.map((c) => c.label)).toEqual([
      "Projects",
      "Alpha",
      "Initiatives",
      "Second",
    ]);
    expect(crumbs[1].to).toBe("/projects/p2");
    expect(crumbs[2].to).toBe("/projects/p2/initiatives");
    expect(crumbs[3].isCurrent).toBe(true);
  });
});
