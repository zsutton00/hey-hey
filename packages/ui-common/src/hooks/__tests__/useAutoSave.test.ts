import { renderHook, act } from "@testing-library/react";
import { vi, beforeEach, describe, it, expect } from "vitest";
import { useAutoSave } from "../useAutoSave";
import type { ArtifactMetadata } from "../../types/artifacts";
import { ArtifactSourceType } from "../../api";

// Mock dependencies
vi.mock("../index", () => ({
  useUserIdentity: () => ({ currentOrgId: "test-org-id" }),
}));

vi.mock("../../clients", () => ({
  apiClient: {
    createArtifact: vi.fn(),
    updateArtifact: vi.fn(),
  },
}));

import { apiClient } from "../../clients";

const mockCreateArtifact = vi.mocked(apiClient.createArtifact);
const mockUpdateArtifact = vi.mocked(apiClient.updateArtifact);

describe("useAutoSave", () => {
  const mockMetadata: ArtifactMetadata = {
    title: "Test Document",
    tags: ["test"],
    category: "Documentation",
    status: "DRAFT",
    isPublic: false,
  };

  const mockOptions = {
    projectId: "test-project-id",
    sourceType: ArtifactSourceType.System,
    sourceId: "document-editor",
    onArtifactCreated: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should initialize with saved status", () => {
    const { result } = renderHook(() =>
      useAutoSave("test content", mockMetadata, null, mockOptions)
    );

    expect(result.current.saveStatus).toBe("saved");
    expect(result.current.lastSaved).toBeNull();
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.retryCount).toBe(0);
  });

  it("should debounce save operations", () => {
    const { result, rerender } = renderHook(
      ({ content }) => useAutoSave(content, mockMetadata, null, mockOptions),
      { initialProps: { content: "initial content" } }
    );

    // Change content
    rerender({ content: "updated content" });

    // Should not save immediately
    expect(mockCreateArtifact).not.toHaveBeenCalled();

    // Fast forward debounce timer
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(mockCreateArtifact).toHaveBeenCalledTimes(1);
  });

  it("should not save empty documents without meaningful metadata", () => {
    const emptyMetadata: ArtifactMetadata = {
      title: "",
      tags: [],
      category: "",
      status: "DRAFT",
      isPublic: false,
    };

    const { rerender } = renderHook(
      ({ content }) => useAutoSave(content, emptyMetadata, null, mockOptions),
      { initialProps: { content: "" } }
    );

    rerender({ content: "   " }); // Just whitespace

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(mockCreateArtifact).not.toHaveBeenCalled();
  });

  it("should update existing artifacts", async () => {
    mockUpdateArtifact.mockResolvedValueOnce({ data: {} } as any);

    const { result } = renderHook(() =>
      useAutoSave(
        "test content",
        mockMetadata,
        "existing-artifact-id",
        mockOptions
      )
    );

    act(() => {
      result.current.forceSave();
    });

    expect(result.current.saveStatus).toBe("saving");
    expect(mockUpdateArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "test-org-id",
        id: "existing-artifact-id",
        updateArtifactDto: {
          title: "Test Document",
          data: {
            content: "test content",
            title: "Test Document",
            type: "DOCUMENT",
          },
          tags: ["test"],
          category: "Documentation",
          status: "DRAFT",
          isPublic: false,
        },
      })
    );
  });

  it("should create new artifacts", async () => {
    mockCreateArtifact.mockResolvedValueOnce({
      data: { artifact: { id: "new-artifact-id" } },
    } as any);

    const { result } = renderHook(() =>
      useAutoSave("test content", mockMetadata, null, mockOptions)
    );

    act(() => {
      result.current.forceSave();
    });

    expect(result.current.saveStatus).toBe("saving");
    expect(mockCreateArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "test-org-id",
        createArtifactDto: {
          projectId: "test-project-id",
          organizationId: "test-org-id",
          type: "DOCUMENT",
          title: "Test Document",
          data: {
            content: "test content",
            title: "Test Document",
            type: "DOCUMENT",
          },
          sourceType: ArtifactSourceType.System,
          sourceId: "document-editor",
          tags: ["test"],
          category: "Documentation",
          status: "DRAFT",
          isPublic: false,
          generateEmbedding: true,
        },
      })
    );
  });
});
