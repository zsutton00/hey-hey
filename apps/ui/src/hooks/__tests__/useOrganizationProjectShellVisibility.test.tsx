import { useOrganization } from "@hey-hey/ui-common/context";
import { useProjects } from "@hey-hey/ui-common/data";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOrganizationProjectShellVisibility } from "../useOrganizationProjectShellVisibility";

vi.mock("@hey-hey/ui-common/context", () => ({
  useOrganization: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useProjects: vi.fn(),
}));

const useOrganizationMock = vi.mocked(useOrganization);
const useProjectsMock = vi.mocked(useProjects);

const projectsForCount = (
  count: number,
): ReturnType<typeof useProjects>["projects"] =>
  Array.from({ length: count }, (_, index) => ({
    id: `project-${index + 1}`,
  })) as ReturnType<typeof useProjects>["projects"];

const setOrganization = (loading = false): void => {
  useOrganizationMock.mockReturnValue({
    currentOrganization: { id: "org-1" },
    loading,
  } as ReturnType<typeof useOrganization>);
};

const setProjects = (
  count: number,
  { isFetched = true, isReady = true } = {},
): void => {
  useProjectsMock.mockReturnValue({
    projects: projectsForCount(count),
    isFetched,
    isReady,
  } as ReturnType<typeof useProjects>);
};

describe("useOrganizationProjectShellVisibility", () => {
  beforeEach(() => {
    setOrganization();
    setProjects(2);
  });

  it("preserves shell visibility until the organization project collection is ready", () => {
    setOrganization(true);
    setProjects(0, { isFetched: false, isReady: false });

    const { result } = renderHook(() =>
      useOrganizationProjectShellVisibility(),
    );

    expect(result.current).toEqual({
      isProjectCollectionReady: false,
      shouldShowProjectShell: true,
    });
  });

  it.each([
    { projectCount: 0, shouldShowProjectShell: false },
    { projectCount: 1, shouldShowProjectShell: false },
    { projectCount: 2, shouldShowProjectShell: true },
  ])(
    "sets shell visibility for $projectCount ready projects",
    ({ projectCount, shouldShowProjectShell }) => {
      setProjects(projectCount);

      const { result } = renderHook(() =>
        useOrganizationProjectShellVisibility(),
      );

      expect(result.current).toEqual({
        isProjectCollectionReady: true,
        shouldShowProjectShell,
      });
      expect(useProjectsMock).toHaveBeenCalledWith("org-1", {
        enabled: true,
      });
    },
  );

  it("reacts when the ready collection grows from one project to two", () => {
    setProjects(1);
    const { result, rerender } = renderHook(() =>
      useOrganizationProjectShellVisibility(),
    );

    expect(result.current.shouldShowProjectShell).toBe(false);

    setProjects(2);
    rerender();

    expect(result.current.shouldShowProjectShell).toBe(true);
  });
});
