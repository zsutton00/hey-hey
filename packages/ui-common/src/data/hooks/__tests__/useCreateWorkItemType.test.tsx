import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCreateWorkItemType } from "../useCreateWorkItemType";
const { mockCreateWorkItemType } = vi.hoisted(() => ({
  mockCreateWorkItemType: vi.fn(),
}));

vi.mock("../../../clients", () => ({
  getApiRuntime: () => ({
    clients: {
      workItemTypes: {
        organizationsOrganizationIdProjectsProjectIdWorkItemTypesPost:
          mockCreateWorkItemType,
      },
    },
  }),
}));

describe("useCreateWorkItemType", () => {
  const mockDefinition = {
    key: "MARKETING",
    name: "Marketing",
    description: "Marketing work",
    sections: [],
    allowedStatuses: ["ACTIVE"],
  };

  const mockProposal = {
    id: "proposal-123",
    status: "PENDING",
    targetEntityId: "00000000-0000-0000-0000-000000000000",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateWorkItemType.mockResolvedValue({
      data: {
        success: true,
        message: "Work item type submitted",
        data: mockProposal,
        timestamp: "2024-01-01T00:00:00Z",
        statusCode: 201,
        path: "/organizations/org-123/projects/project-123/work-item-types",
      },
    });
  });

  describe("successful creation", () => {
    it("submits the definition and resolves to the proposal", async () => {
      const onSuccess = vi.fn();
      const { result } = renderHook(() => useCreateWorkItemType({ onSuccess }));

      expect(result.current.isPending).toBe(false);
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.isError).toBe(false);
      expect(result.current.error).toBeNull();

      const proposal = await result.current.mutate({
        organizationId: "org-123",
        projectId: "project-123",
        definition: mockDefinition,
      });

      expect(proposal).toEqual(mockProposal);
      expect(mockCreateWorkItemType).toHaveBeenCalledWith({
        organizationId: "org-123",
        projectId: "project-123",
        workItemTypeDefinitionDto: mockDefinition,
      });
      expect(onSuccess).toHaveBeenCalledWith(mockProposal);
    });
  });

  describe("error handling", () => {
    it("propagates API errors", async () => {
      const onError = vi.fn();
      mockCreateWorkItemType.mockRejectedValue(new Error("Creation failed"));

      const { result } = renderHook(() => useCreateWorkItemType({ onError }));

      await expect(
        result.current.mutate({
          organizationId: "org-123",
          projectId: "project-123",
          definition: mockDefinition,
        })
      ).rejects.toThrow("Creation failed");

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it("throws when the response carries no proposal", async () => {
      mockCreateWorkItemType.mockResolvedValue({
        data: {
          success: false,
          message: "No data returned",
          data: null,
          timestamp: "2024-01-01T00:00:00Z",
          statusCode: 201,
          path: "/organizations/org-123/projects/project-123/work-item-types",
        },
      });

      const { result } = renderHook(() => useCreateWorkItemType());

      await expect(
        result.current.mutate({
          organizationId: "org-123",
          projectId: "project-123",
          definition: mockDefinition,
        })
      ).rejects.toThrow(
        "No proposal returned from create work-item-type endpoint"
      );
    });
  });

  it("preserves a stable retained-key target returned for restoration", async () => {
    const restoredProposal = {
      ...mockProposal,
      targetEntityId: "MARKETING",
    };
    mockCreateWorkItemType.mockResolvedValueOnce({
      data: {
        data: restoredProposal,
      },
    });

    const { result } = renderHook(() => useCreateWorkItemType());

    const proposal = await result.current.mutate({
      organizationId: "org-123",
      projectId: "project-123",
      definition: mockDefinition,
    });

    expect(proposal.targetEntityId).toBe("MARKETING");
    expect(mockCreateWorkItemType).toHaveBeenCalledWith({
      organizationId: "org-123",
      projectId: "project-123",
      workItemTypeDefinitionDto: mockDefinition,
    });
  });

  describe("state management", () => {
    it("returns initial idle state", () => {
      const { result } = renderHook(() => useCreateWorkItemType());

      expect(result.current.isPending).toBe(false);
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.isError).toBe(false);
      expect(result.current.error).toBeNull();
      expect(typeof result.current.mutate).toBe("function");
    });

    it("calls onSettled on success and error", async () => {
      const onSettled = vi.fn();
      const { result } = renderHook(() => useCreateWorkItemType({ onSettled }));

      await result.current.mutate({
        organizationId: "org-123",
        projectId: "project-123",
        definition: mockDefinition,
      });
      expect(onSettled).toHaveBeenCalled();

      onSettled.mockClear();
      mockCreateWorkItemType.mockRejectedValue(new Error("Test error"));

      await expect(
        result.current.mutate({
          organizationId: "org-123",
          projectId: "project-123",
          definition: mockDefinition,
        })
      ).rejects.toThrow();
      expect(onSettled).toHaveBeenCalled();
    });
  });
});
