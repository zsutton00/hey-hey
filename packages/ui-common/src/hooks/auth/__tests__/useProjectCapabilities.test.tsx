import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectRole, type ProjectResponseDto } from "../../../api";
import { useProject } from "../../../data/hooks/useProject";
import {
  projectCapabilitiesForRole,
  useProjectCapabilities,
} from "../useProjectCapabilities";

vi.mock("../../../data/hooks/useProject", () => ({ useProject: vi.fn() }));

const stubProject = (
  currentUserRole: ProjectRole | null
): ReturnType<typeof useProject> =>
  ({
    data:
      currentUserRole === null
        ? null
        : ({ currentUserRole } as ProjectResponseDto),
  }) as ReturnType<typeof useProject>;

describe("projectCapabilitiesForRole", () => {
  it.each([
    [
      ProjectRole.Owner,
      {
        inviteToProject: true,
        removeMember: true,
        manageSettings: true,
        manageWorkItemTypes: true,
        deleteProject: true,
        viewProjectEmbeddings: true,
      },
    ],
    [
      ProjectRole.Architect,
      {
        inviteToProject: true,
        removeMember: false,
        manageSettings: true,
        manageWorkItemTypes: true,
        deleteProject: false,
        viewProjectEmbeddings: false,
      },
    ],
    [
      ProjectRole.Member,
      {
        inviteToProject: false,
        removeMember: false,
        manageSettings: false,
        manageWorkItemTypes: false,
        deleteProject: false,
        viewProjectEmbeddings: false,
      },
    ],
    [
      ProjectRole.Viewer,
      {
        inviteToProject: false,
        removeMember: false,
        manageSettings: false,
        manageWorkItemTypes: false,
        deleteProject: false,
        viewProjectEmbeddings: false,
      },
    ],
    [
      null,
      {
        inviteToProject: false,
        removeMember: false,
        manageSettings: false,
        manageWorkItemTypes: false,
        deleteProject: false,
        viewProjectEmbeddings: false,
      },
    ],
  ])("maps %s to the Role Permissions matrix", (role, expected) => {
    expect(projectCapabilitiesForRole(role)).toEqual({
      currentUserRole: role,
      ...expected,
    });
  });
});

describe("useProjectCapabilities", () => {
  beforeEach(() => {
    vi.mocked(useProject).mockReset();
  });

  it("derives capabilities from the server-reported currentUserRole", () => {
    vi.mocked(useProject).mockReturnValue(stubProject(ProjectRole.Architect));

    const { result } = renderHook(() => useProjectCapabilities("org-1", "p-1"));

    expect(useProject).toHaveBeenCalledWith("org-1", "p-1");
    expect(result.current).toEqual(
      projectCapabilitiesForRole(ProjectRole.Architect)
    );
  });

  it("grants nothing until the project has loaded", () => {
    vi.mocked(useProject).mockReturnValue(stubProject(null));

    const { result } = renderHook(() => useProjectCapabilities("org-1", "p-1"));

    expect(result.current).toEqual(projectCapabilitiesForRole(null));
  });
});
