import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EntityType } from "../../../api";
import { useEntityContext } from "../useEntityContext";
import { useFullEntityContext } from "../useFullEntityContext";

vi.mock("../useFullEntityContext", () => ({
  useFullEntityContext: vi.fn(),
}));

const mockUseFullEntityContext = vi.mocked(useFullEntityContext);
const refetch = vi.fn();

describe("useEntityContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFullEntityContext.mockReturnValue({
      data: null,
      isLoading: false,
      isFetched: false,
      error: null,
      refetch,
    });
  });

  it("stays lazy, then requests a shared full Context with related entities", () => {
    const { result } = renderHook(() =>
      useEntityContext({
        organizationId: "org-1",
        projectId: "project-1",
        entityType: EntityType.Task,
        entityId: "task-1",
      })
    );

    expect(mockUseFullEntityContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );

    act(() => result.current.fetch());

    expect(mockUseFullEntityContext).toHaveBeenLastCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      entityType: EntityType.Task,
      entityId: "task-1",
      enabled: true,
      includeRelatedEntities: true,
      includeFeatureHierarchy: true,
      includeProposals: true,
      includeAvailableMcpTools: true,
    });
    expect(refetch).not.toHaveBeenCalled();

    act(() => result.current.fetch());
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
