import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityPromptTemplateCatalogEntryDto } from "../../../api";
import { useEntityPromptTemplates } from "../useEntityPromptTemplates";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
}));

vi.mock("jotai", () => ({
  useAtomValue: () => ({}),
  useSetAtom: () => vi.fn(),
}));

vi.mock("../../query/useDataLayerQuery", () => ({
  useDataLayerQuery: (...args: unknown[]) => {
    const state = mocks.useQuery(...args);
    return { result: { data: state.data ?? undefined }, state };
  },
}));

const template = (templateKey: string): EntityPromptTemplateCatalogEntryDto => ({
  templateKey,
  canonicalDefault: {
    templateKey,
    selector: { entityType: "PROJECT" },
    syntaxVersion: "V1",
    revisionId: `${templateKey}-canonical`,
    revisionNumber: 1,
    content: templateKey,
    ownershipScope: { scope: "CANONICAL" },
    lifecycleState: "PUBLISHED",
    validation: { status: "VALID", issues: [] },
  },
  revisionHistory: [],
  effective: {
    templateKey,
    selector: { entityType: "PROJECT" },
    syntaxVersion: "V1",
    content: templateKey,
    ownershipSource: { scope: "CANONICAL" },
    revisionId: `${templateKey}-canonical`,
    revisionNumber: 1,
    lifecycleState: "PUBLISHED",
    validationStatus: "VALID",
    publishedAt: "2026-08-01T00:00:00.000Z",
  },
});

const queryResult = (data: EntityPromptTemplateCatalogEntryDto[] | null) => ({
  data,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  error: null,
  isStale: false,
  refetch: vi.fn().mockResolvedValue(data),
  markStale: vi.fn(),
});

describe("useEntityPromptTemplates catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enables one complete-scope catalog query and returns every template", () => {
    const templates = [template("entity_context"), template("plan_context")];
    mocks.useQuery.mockReturnValue(queryResult(templates));

    const { result } = renderHook(() =>
      useEntityPromptTemplates({
        organizationId: "org-1",
        projectId: "project-1",
      })
    );

    expect(mocks.useQuery).toHaveBeenCalledOnce();
    const [options, hookOptions] = mocks.useQuery.mock.calls[0] ?? [];
    expect(hookOptions.enabled).toBe(true);
    expect(options.queryKey).toEqual([
      "entityPromptTemplates",
      "org-1",
      "project-1",
      "catalog",
    ]);
    expect(result.current.catalog).toEqual({
      projectId: "project-1",
      templates,
    });
  });

  it("disables missing scope and preserves a successful empty catalog", () => {
    mocks.useQuery.mockReturnValue(queryResult(null));
    const { result: disabled } = renderHook(() =>
      useEntityPromptTemplates(undefined)
    );
    expect(mocks.useQuery.mock.calls[0]?.[1].enabled).toBe(false);
    expect(disabled.current.catalog).toBeNull();

    mocks.useQuery.mockReturnValue(queryResult([]));
    const { result: empty } = renderHook(() =>
      useEntityPromptTemplates({
        organizationId: "org-1",
        projectId: "project-1",
      })
    );
    expect(empty.current.catalog).toEqual({
      projectId: "project-1",
      templates: [],
    });
    expect(empty.current.isReady).toBe(true);
  });
});
