import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkItemTypeDefinitionDto } from "../../../api";
import {
  useArchiveWorkItemType,
  useEditWorkItemType,
  useMarkWorkItemTypeDataStale,
  useResetWorkItemType,
  useWorkItemTypeSectionContentImpact,
  useWorkItemTypeTrackingLinkRevocationImpact,
} from "../useWorkItemTypeLifecycle";

const { getWorkItemTypesApiMock, mockInvalidateQueries } = vi.hoisted(() => ({
  getWorkItemTypesApiMock: vi.fn(),
  mockInvalidateQueries: vi.fn(),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock("../../collections/workItemTypes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../collections/workItemTypes")>()),
  getWorkItemTypesApi: getWorkItemTypesApiMock,
}));

const projectTypesPrefix = {
  queryKey: ["workItemTypes", "org-1", "project-1"],
};

const mockPatch = vi.fn();
const mockDelete = vi.fn();
const mockReset = vi.fn();
const mockSectionContentImpact = vi.fn();
const mockTrackingLinkRevocationImpact = vi.fn();

const definition: WorkItemTypeDefinitionDto = {
  key: "MARKETING",
  name: "Marketing",
  sections: [],
  allowedStatuses: ["ACTIVE"],
};

const proposal = {
  id: "proposal-1",
  status: "PENDING",
};

describe("useMarkWorkItemTypeDataStale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invalidates every work-item-type read in the project with one prefix", () => {
    const { result } = renderHook(() => useMarkWorkItemTypeDataStale());

    act(() => {
      result.current("org-1", "project-1", "MARKETING");
    });

    expect(mockInvalidateQueries).toHaveBeenCalledTimes(1);
    expect(mockInvalidateQueries).toHaveBeenCalledWith(projectTypesPrefix);
  });
});

describe("useEditWorkItemType", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkItemTypesApiMock.mockReturnValue({
      organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeyPatch:
        mockPatch,
    });
    mockPatch.mockResolvedValue({
      data: {
        success: true,
        message: "Edit submitted",
        data: proposal,
        timestamp: "2026-01-01T00:00:00Z",
        statusCode: 201,
      },
    });
  });

  it("calls the generated edit operation and returns the review payload", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useEditWorkItemType({ onSuccess }));

    const returnedProposal = await act(async () =>
      result.current.mutate({
        organizationId: "org-1",
        projectId: "project-1",
        typeKey: "MARKETING",
        definition,
      }),
    );

    expect(returnedProposal).toEqual(proposal);
    expect(mockPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        typeKey: "MARKETING",
        workItemTypeEditRequestDto: { definition },
      }),
    );
    expect(onSuccess).toHaveBeenCalledWith(proposal);
  });

  it("preserves the complete rejected response for the editor and allows retry", async () => {
    const failure = Object.assign(
      new Error("Request failed with status code 409"),
      {
        response: {
          data: {
            message:
              "Proposal content changed after review. Reconciliation is required.",
            diagnostic: {
              issues: [
                {
                  field: "definition.name",
                  code: "PROPOSAL_RECONCILIATION_REQUIRED",
                  reason: "This field changed after review.",
                  layer: "referential",
                },
              ],
              issueCount: 1,
              truncated: false,
              correlationId: "type-save-correlation",
            },
          },
        },
      },
    );
    mockPatch.mockRejectedValueOnce(failure);
    const onError = vi.fn();
    const { result } = renderHook(() => useEditWorkItemType({ onError }));
    const request = {
      organizationId: "org-1",
      projectId: "project-1",
      typeKey: "MARKETING",
      definition,
    };
    await act(async () => {
      await expect(result.current.mutate(request)).rejects.toBe(failure);
    });
    expect(onError).toHaveBeenCalledWith(failure);
    expect(result.current.error).toBe(failure);
    expect(mockInvalidateQueries).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.mutate(request);
    });
    expect(mockPatch.mock.calls[1][0].workItemTypeEditRequestDto).toEqual({
      definition,
    });
  });

  it("sends canonical customization acknowledgement after confirmation", async () => {
    const { result } = renderHook(() => useEditWorkItemType());

    await act(async () =>
      result.current.mutate({
        organizationId: "org-1",
        projectId: "project-1",
        typeKey: "STANDARD",
        definition,
        acknowledgeCanonicalCustomization: true,
      }),
    );

    expect(mockPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemTypeEditRequestDto: {
          definition,
          acknowledgeCanonicalCustomization: true,
        },
      }),
    );
  });

  it("omits canonical customization acknowledgement for ordinary edits", async () => {
    const { result } = renderHook(() => useEditWorkItemType());

    await act(async () =>
      result.current.mutate({
        organizationId: "org-1",
        projectId: "project-1",
        typeKey: "MARKETING",
        definition,
      }),
    );

    const request = mockPatch.mock.calls[0][0].workItemTypeEditRequestDto;
    expect(request).toEqual({ definition });
    expect(request).not.toHaveProperty("acknowledgeCanonicalCustomization");
  });

  it("invalidates the project's work-item-type reads after a successful edit start", async () => {
    const { result } = renderHook(() => useEditWorkItemType());

    await act(async () =>
      result.current.mutate({
        organizationId: "org-1",
        projectId: "project-1",
        typeKey: "MARKETING",
        definition,
      }),
    );

    expect(mockInvalidateQueries).toHaveBeenCalledTimes(1);
    expect(mockInvalidateQueries).toHaveBeenCalledWith(projectTypesPrefix);
  });

  it("throws when the edit response carries no review payload", async () => {
    mockPatch.mockResolvedValue({
      data: {
        success: true,
        message: "Edit submitted",
        data: null,
        timestamp: "2026-01-01T00:00:00Z",
        statusCode: 201,
      },
    });

    const { result } = renderHook(() => useEditWorkItemType());

    await expect(
      act(async () =>
        result.current.mutate({
          organizationId: "org-1",
          projectId: "project-1",
          typeKey: "MARKETING",
          definition,
        }),
      ),
    ).rejects.toThrow("No proposal returned from edit work-item-type endpoint");
    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });
});

describe("useArchiveWorkItemType", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkItemTypesApiMock.mockReturnValue({
      organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeyDelete:
        mockDelete,
    });
    mockDelete.mockResolvedValue({
      data: {
        success: true,
        message: "Archive submitted",
        data: proposal,
        timestamp: "2026-01-01T00:00:00Z",
        statusCode: 201,
      },
    });
  });

  it("calls the generated archive operation and returns the review payload", async () => {
    const { result } = renderHook(() => useArchiveWorkItemType());

    const returnedProposal = await act(async () =>
      result.current.mutate({
        organizationId: "org-1",
        projectId: "project-1",
        typeKey: "MARKETING",
        reason: "No longer used",
      }),
    );

    expect(returnedProposal).toEqual(proposal);
    expect(mockDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        typeKey: "MARKETING",
        workItemTypeArchiveRequestDto: { reason: "No longer used" },
      }),
    );
    expect(mockInvalidateQueries).toHaveBeenCalledWith(projectTypesPrefix);
  });

  it("throws when the archive response carries no review payload", async () => {
    mockDelete.mockResolvedValue({
      data: {
        success: true,
        message: "Archive submitted",
        data: undefined,
        timestamp: "2026-01-01T00:00:00Z",
        statusCode: 201,
      },
    });

    const { result } = renderHook(() => useArchiveWorkItemType());

    await expect(
      act(async () =>
        result.current.mutate({
          organizationId: "org-1",
          projectId: "project-1",
          typeKey: "MARKETING",
        }),
      ),
    ).rejects.toThrow(
      "No proposal returned from archive work-item-type endpoint",
    );
    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });
});

describe("useResetWorkItemType", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkItemTypesApiMock.mockReturnValue({
      organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeyResetPost:
        mockReset,
    });
    mockReset.mockResolvedValue({
      data: {
        success: true,
        message: "Reset review submitted",
        data: proposal,
        timestamp: "2026-01-01T00:00:00Z",
        statusCode: 201,
      },
    });
  });

  it("calls the generated no-body reset operation and returns its review", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useResetWorkItemType({ onSuccess }));

    const returnedProposal = await act(async () =>
      result.current.mutate({
        organizationId: "org-1",
        projectId: "project-1",
        typeKey: "MARKETING",
      }),
    );

    expect(returnedProposal).toEqual(proposal);
    expect(mockReset).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      typeKey: "MARKETING",
    });
    expect(mockReset.mock.calls[0]).toHaveLength(1);
    expect(onSuccess).toHaveBeenCalledWith(proposal);
    expect(mockInvalidateQueries).toHaveBeenCalledWith(projectTypesPrefix);
  });

  it("shares an in-flight request when reset is triggered twice", async () => {
    let resolveRequest: ((value: { data: unknown }) => void) | undefined;
    mockReset.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    const { result } = renderHook(() => useResetWorkItemType());
    let firstRequest: Promise<unknown>;
    let secondRequest: Promise<unknown>;
    act(() => {
      firstRequest = result.current.mutate({
        organizationId: "org-1",
        projectId: "project-1",
        typeKey: "MARKETING",
      });
      secondRequest = result.current.mutate({
        organizationId: "org-1",
        projectId: "project-1",
        typeKey: "MARKETING",
      });
    });

    expect(secondRequest!).toBe(firstRequest!);
    expect(mockReset).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRequest?.({
        data: {
          success: true,
          message: "Reset review submitted",
          data: proposal,
          timestamp: "2026-01-01T00:00:00Z",
          statusCode: 201,
        },
      });
      await firstRequest!;
    });
  });

  it("keeps different project/type resets independent while pending", async () => {
    let resolveFirst: ((value: { data: unknown }) => void) | undefined;
    let resolveSecond: ((value: { data: unknown }) => void) | undefined;
    mockReset
      .mockReturnValueOnce(
        new Promise<{ data: unknown }>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<{ data: unknown }>((resolve) => {
          resolveSecond = resolve;
        }),
      );

    const { result } = renderHook(() => useResetWorkItemType());
    let firstRequest: Promise<unknown>;
    let secondRequest: Promise<unknown>;
    act(() => {
      firstRequest = result.current.mutate({
        organizationId: "org-1",
        projectId: "project-1",
        typeKey: "MARKETING",
      });
      secondRequest = result.current.mutate({
        organizationId: "org-1",
        projectId: "project-2",
        typeKey: "MARKETING",
      });
    });

    expect(secondRequest!).not.toBe(firstRequest!);
    expect(mockReset).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveFirst?.({ data: { data: proposal } });
      resolveSecond?.({ data: { data: proposal } });
      await Promise.all([firstRequest!, secondRequest!]);
    });
  });

  it("surfaces a missing server review payload as a recoverable error", async () => {
    mockReset.mockResolvedValue({
      data: {
        success: true,
        message: "Reset review submitted",
        data: null,
        timestamp: "2026-01-01T00:00:00Z",
        statusCode: 201,
      },
    });

    const onError = vi.fn();
    const { result } = renderHook(() => useResetWorkItemType({ onError }));

    await expect(
      act(async () =>
        result.current.mutate({
          organizationId: "org-1",
          projectId: "project-1",
          typeKey: "MARKETING",
        }),
      ),
    ).rejects.toThrow(
      "No proposal returned from reset work-item-type endpoint",
    );
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "No proposal returned from reset work-item-type endpoint",
        }),
      ),
    );
    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });
});

describe("useWorkItemTypeSectionContentImpact", () => {
  const impact = {
    totalAffectedItemCount: 3,
    sections: [
      {
        sectionKey: "audience",
        affectedItemCount: 2,
      },
      {
        sectionKey: "constraints",
        affectedItemCount: 1,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getWorkItemTypesApiMock.mockReturnValue({
      organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeySectionContentImpactGet:
        mockSectionContentImpact,
    });
    mockSectionContentImpact.mockResolvedValue({
      data: {
        success: true,
        message: "Impact read",
        data: impact,
        timestamp: "2026-01-01T00:00:00Z",
        statusCode: 200,
      },
    });
  });

  it("calls the generated section-content impact operation with request params and returns the payload", async () => {
    const { result } = renderHook(() =>
      useWorkItemTypeSectionContentImpact("org-1", "project-1", "MARKETING", [
        "audience",
        "constraints",
      ]),
    );

    await waitFor(() => expect(result.current.data).toEqual(impact));

    expect(mockSectionContentImpact).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        typeKey: "MARKETING",
        removedSectionKeys: new Set(["audience", "constraints"]),
      }),
      { signal: expect.any(AbortSignal) },
    );
    expect(result.current.error).toBeNull();
  });

  it.each([
    {
      organizationId: undefined,
      projectId: "project-1",
      typeKey: "MARKETING",
      removedSectionKeys: ["audience"],
    },
    {
      organizationId: "org-1",
      projectId: undefined,
      typeKey: "MARKETING",
      removedSectionKeys: ["audience"],
    },
    {
      organizationId: "org-1",
      projectId: "project-1",
      typeKey: undefined,
      removedSectionKeys: ["audience"],
    },
    {
      organizationId: "org-1",
      projectId: "project-1",
      typeKey: "MARKETING",
      removedSectionKeys: [],
    },
  ])(
    "stays disabled until required section-content context exists: %#",
    ({ organizationId, projectId, typeKey, removedSectionKeys }) => {
      const { result } = renderHook(() =>
        useWorkItemTypeSectionContentImpact(
          organizationId,
          projectId,
          typeKey,
          removedSectionKeys,
        ),
      );

      expect(result.current.data).toBeNull();
      expect(result.current.isFetched).toBe(false);
      expect(mockSectionContentImpact).not.toHaveBeenCalled();
    },
  );

  it("stays disabled when the caller disables section-content impact fetching", () => {
    renderHook(() =>
      useWorkItemTypeSectionContentImpact(
        "org-1",
        "project-1",
        "MARKETING",
        ["audience"],
        { enabled: false },
      ),
    );

    expect(mockSectionContentImpact).not.toHaveBeenCalled();
  });

  it("surfaces missing section-content impact payloads as errors", async () => {
    mockSectionContentImpact.mockResolvedValue({
      data: {
        success: true,
        message: "Impact read",
        data: undefined,
        timestamp: "2026-01-01T00:00:00Z",
        statusCode: 200,
      },
    });

    const { result } = renderHook(() =>
      useWorkItemTypeSectionContentImpact("org-1", "project-1", "MARKETING", [
        "audience",
      ]),
    );

    await waitFor(() =>
      expect(result.current.error?.message).toBe(
        "No section-content impact payload returned from work-item-type endpoint",
      ),
    );
    expect(result.current.data).toBeNull();
  });
});

describe("useWorkItemTypeTrackingLinkRevocationImpact", () => {
  const impact = {
    totalAffectedLinkCount: 4,
    sources: [
      {
        sourceTypeKey: "BUG",
        affectedLinkCount: 4,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getWorkItemTypesApiMock.mockReturnValue({
      organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeyTrackingLinkRevocationImpactGet:
        mockTrackingLinkRevocationImpact,
    });
    mockTrackingLinkRevocationImpact.mockResolvedValue({
      data: {
        success: true,
        message: "Impact read",
        data: impact,
        timestamp: "2026-01-01T00:00:00Z",
        statusCode: 200,
      },
    });
  });

  it("calls the generated tracking-link impact operation with request params and returns the payload", async () => {
    const { result } = renderHook(() =>
      useWorkItemTypeTrackingLinkRevocationImpact(
        "org-1",
        "project-1",
        "MARKETING",
        ["BUG"],
      ),
    );

    await waitFor(() => expect(result.current.data).toEqual(impact));

    expect(mockTrackingLinkRevocationImpact).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        typeKey: "MARKETING",
        revokedTrackingSourceTypeKeys: new Set(["BUG"]),
      }),
      { signal: expect.any(AbortSignal) },
    );
    expect(result.current.error).toBeNull();
  });

  it.each([
    {
      organizationId: undefined,
      projectId: "project-1",
      typeKey: "MARKETING",
      revokedTrackingSourceTypeKeys: ["BUG"],
    },
    {
      organizationId: "org-1",
      projectId: undefined,
      typeKey: "MARKETING",
      revokedTrackingSourceTypeKeys: ["BUG"],
    },
    {
      organizationId: "org-1",
      projectId: "project-1",
      typeKey: undefined,
      revokedTrackingSourceTypeKeys: ["BUG"],
    },
    {
      organizationId: "org-1",
      projectId: "project-1",
      typeKey: "MARKETING",
      revokedTrackingSourceTypeKeys: [],
    },
  ])(
    "stays disabled until required tracking-link context exists: %#",
    ({ organizationId, projectId, typeKey, revokedTrackingSourceTypeKeys }) => {
      const { result } = renderHook(() =>
        useWorkItemTypeTrackingLinkRevocationImpact(
          organizationId,
          projectId,
          typeKey,
          revokedTrackingSourceTypeKeys,
        ),
      );

      expect(result.current.data).toBeNull();
      expect(result.current.isFetched).toBe(false);
      expect(mockTrackingLinkRevocationImpact).not.toHaveBeenCalled();
    },
  );

  it("surfaces missing tracking-link impact payloads as errors", async () => {
    mockTrackingLinkRevocationImpact.mockResolvedValue({
      data: {
        success: true,
        message: "Impact read",
        data: null,
        timestamp: "2026-01-01T00:00:00Z",
        statusCode: 200,
      },
    });

    const { result } = renderHook(() =>
      useWorkItemTypeTrackingLinkRevocationImpact(
        "org-1",
        "project-1",
        "MARKETING",
        ["BUG"],
      ),
    );

    await waitFor(() =>
      expect(result.current.error?.message).toBe(
        "No tracking-link-revocation impact payload returned from work-item-type endpoint",
      ),
    );
    expect(result.current.data).toBeNull();
  });
});
