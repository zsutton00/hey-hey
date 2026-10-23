import { act, renderHook, waitFor } from "@testing-library/react";
import { AxiosHeaders, type AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  CanonicalTaskMetadataTypeEnum,
  EntityType,
  UnifiedEmbeddingsSearchOptionsQueryModeEnum,
  UnifiedSearchIntent,
  type CanonicalTaskMetadata,
  type UnifiedSearch200Response,
  type UnifiedSearchResult,
  type WorkItemTypeGraphSearchableMetaLinkTarget,
} from "../../../api";
import { unifiedApiClient } from "../../../clients/serviceClients";
import { useWorkItemGraphMetaLinkSearch } from "../useWorkItemGraphMetaLinkSearch";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    unifiedSearch: vi.fn(),
  },
}));

const mockedClient = vi.mocked(unifiedApiClient);

const ORGANIZATION_ID = "d94f5b84-a6dc-4bc2-a744-f95e3d0d1cc8";
const PROJECT_ID = "ca9b1ac7-41ea-4839-959b-f6575c709b0c";
const SOURCE_CHILD_ID = "46e35175-87bf-41d7-a413-a126ea000142";
const CONTRACT_ID = "c4a178eb-3bc2-463c-92b5-4f4aba818540";
const APPROVAL_ID = "b0f3332c-a9b6-4ad8-b3c8-b5a2f445d2cb";

const SOURCE_CHILD = { refType: "existing", id: SOURCE_CHILD_ID } as const;

const CONTRACT_DECLARATION: WorkItemTypeGraphSearchableMetaLinkTarget = {
  edgeType: AgentEdgeType.DependsOn,
  targetEntityTypes: [AgentEdgeEndpointEntityType.Task],
  targetWorkItemTypeKeys: ["CONTRACT"],
};

const APPROVAL_DECLARATION: WorkItemTypeGraphSearchableMetaLinkTarget = {
  edgeType: AgentEdgeType.RelatedTo,
  targetEntityTypes: [AgentEdgeEndpointEntityType.Task],
  targetWorkItemTypeKeys: ["APPROVAL_GATE"],
};

function canonicalTaskMetadata(
  id: string,
  title: string,
  taskType: string
): CanonicalTaskMetadata {
  return {
    id,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    type: CanonicalTaskMetadataTypeEnum.Task,
    taskType,
    name: title,
  };
}

function searchResult({
  id,
  title,
  taskType,
  entityType = EntityType.Task,
}: {
  id: string;
  title?: string;
  taskType?: string;
  entityType?: EntityType;
}): UnifiedSearchResult {
  return {
    entityId: id,
    entityType,
    title,
    embeddings: taskType
      ? { metadata: canonicalTaskMetadata(id, title ?? "", taskType) }
      : undefined,
  };
}

function searchResponse(
  results: UnifiedSearchResult[]
): AxiosResponse<UnifiedSearch200Response> {
  return {
    data: {
      success: true,
      message: "OK",
      data: {
        intent: UnifiedSearchIntent.Hybrid,
        query: "query",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        results,
        execution: { totalMs: 1 },
      },
      timestamp: "2026-07-14T00:00:00.000Z",
      statusCode: 200,
    },
    status: 200,
    statusText: "OK",
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      if (!resolvePromise)
        throw new Error("Deferred promise was not initialized.");
      resolvePromise(value);
    },
  };
}

describe("useWorkItemGraphMetaLinkSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes Contract lookup and excludes disallowed, invalid, duplicate, and self results", async () => {
    mockedClient.unifiedSearch.mockResolvedValue(
      searchResponse([
        searchResult({
          id: CONTRACT_ID,
          title: "Data Retention Contract",
          taskType: "CONTRACT",
        }),
        searchResult({
          id: CONTRACT_ID,
          title: "Duplicate Contract",
          taskType: "CONTRACT",
        }),
        searchResult({
          id: "ec59cbe4-f4cb-46b0-a40d-84e52dd1e895",
          title: "Wrong work-item type",
          taskType: "FEATURE",
        }),
        searchResult({
          id: "02f225b5-80ce-4409-8385-253feabf36bf",
          title: "Wrong entity type",
          taskType: "CONTRACT",
          entityType: EntityType.DesignDoc,
        }),
        searchResult({
          id: "55487a64-e187-4bbb-acad-a0896d2ea68e",
          title: "   ",
          taskType: "CONTRACT",
        }),
        searchResult({
          id: "3e021284-d30e-4665-b044-c14993fb39a2",
          title: "Missing work-item type",
        }),
        searchResult({
          id: SOURCE_CHILD_ID,
          title: "Source child",
          taskType: "CONTRACT",
        }),
      ])
    );

    const { result } = renderHook(() =>
      useWorkItemGraphMetaLinkSearch({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        sourceChild: SOURCE_CHILD,
        searchTarget: CONTRACT_DECLARATION,
        query: "  retention  ",
      })
    );

    expect(result.current.status).toBe("loading");

    await waitFor(() => expect(result.current.status).toBe("success"));

    expect(mockedClient.unifiedSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        unifiedSearchRequest: {
          intent: UnifiedSearchIntent.Hybrid,
          query: "retention",
          common: {
            types: [EntityType.Task],
            taskTypes: ["CONTRACT"],
          },
          graph: { size: 20 },
          embeddings: {
            maxResults: 20,
            queryMode: UnifiedEmbeddingsSearchOptionsQueryModeEnum.TitleFuzzy,
            hybridResultStrategy: "embeddingsRequired",
          },
        },
      })
    );
    expect(result.current.results).toEqual([
      {
        identity: { refType: "existing", id: CONTRACT_ID },
        entityType: EntityType.Task,
        workItemTypeKey: "CONTRACT",
        title: "Data Retention Contract",
      },
    ]);
    expect(result.current.isSelectable).toBe(true);
  });

  it("derives another configured work-item target from the declaration for a temporary source", async () => {
    mockedClient.unifiedSearch.mockResolvedValue(
      searchResponse([
        searchResult({
          id: APPROVAL_ID,
          title: "Security Approval",
          taskType: "APPROVAL_GATE",
        }),
      ])
    );

    const { result } = renderHook(() =>
      useWorkItemGraphMetaLinkSearch({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        sourceChild: { refType: "temporary", tempId: "new-step" },
        searchTarget: APPROVAL_DECLARATION,
        query: "security",
        limit: 100,
      })
    );

    await waitFor(() => expect(result.current.status).toBe("success"));

    expect(mockedClient.unifiedSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        unifiedSearchRequest: expect.objectContaining({
          common: {
            types: [EntityType.Task],
            taskTypes: ["APPROVAL_GATE"],
          },
          graph: { size: 20 },
          embeddings: expect.objectContaining({ maxResults: 20 }),
        }),
      })
    );
    expect(result.current.results[0]?.workItemTypeKey).toBe("APPROVAL_GATE");
  });

  it("searches every TASK work-item type when the generated target leaves type keys unbounded", async () => {
    mockedClient.unifiedSearch.mockResolvedValue(
      searchResponse([
        searchResult({
          id: CONTRACT_ID,
          title: "Data Retention Contract",
          taskType: "CONTRACT",
        }),
        searchResult({
          id: APPROVAL_ID,
          title: "Security Approval",
          taskType: "APPROVAL_GATE",
        }),
      ])
    );

    const { result } = renderHook(() =>
      useWorkItemGraphMetaLinkSearch({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        sourceChild: SOURCE_CHILD,
        searchTarget: {
          edgeType: AgentEdgeType.RelatedTo,
          targetEntityTypes: [AgentEdgeEndpointEntityType.Task],
        },
        query: "related",
      })
    );

    await waitFor(() => expect(result.current.status).toBe("success"));

    expect(mockedClient.unifiedSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        unifiedSearchRequest: expect.objectContaining({
          common: { types: [EntityType.Task] },
        }),
      })
    );
    expect(result.current.results.map((item) => item.workItemTypeKey)).toEqual([
      "CONTRACT",
      "APPROVAL_GATE",
    ]);
  });

  it.each([
    {
      label: "organization",
      input: {
        organizationId: null,
        projectId: PROJECT_ID,
        sourceChild: SOURCE_CHILD,
        searchTarget: CONTRACT_DECLARATION,
      },
    },
    {
      label: "project",
      input: {
        organizationId: ORGANIZATION_ID,
        projectId: null,
        sourceChild: SOURCE_CHILD,
        searchTarget: CONTRACT_DECLARATION,
      },
    },
    {
      label: "source child",
      input: {
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        sourceChild: null,
        searchTarget: CONTRACT_DECLARATION,
      },
    },
    {
      label: "relationship declaration",
      input: {
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        sourceChild: SOURCE_CHILD,
        searchTarget: null,
      },
    },
  ])(
    "stays explicitly idle when $label context is missing",
    async ({ input }) => {
      const { result } = renderHook(() =>
        useWorkItemGraphMetaLinkSearch({ ...input, query: "contract" })
      );

      await waitFor(() => expect(result.current.status).toBe("idle"));
      expect(result.current).toMatchObject({
        reason: "missing-context",
        results: [],
        isSelectable: false,
        error: null,
      });
      expect(mockedClient.unifiedSearch).not.toHaveBeenCalled();
    }
  );

  it("does not request an empty query", async () => {
    const { result } = renderHook(() =>
      useWorkItemGraphMetaLinkSearch({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        sourceChild: SOURCE_CHILD,
        searchTarget: CONTRACT_DECLARATION,
        query: "   ",
      })
    );

    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current).toMatchObject({
      reason: "empty-query",
      isSelectable: false,
    });
    expect(mockedClient.unifiedSearch).not.toHaveBeenCalled();
  });

  it("does not search a declaration without bounded TASK type targets", async () => {
    const { result } = renderHook(() =>
      useWorkItemGraphMetaLinkSearch({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        sourceChild: SOURCE_CHILD,
        searchTarget: {
          edgeType: AgentEdgeType.DependsOn,
          targetEntityTypes: [AgentEdgeEndpointEntityType.DesignDoc],
          targetWorkItemTypeKeys: [],
        },
        query: "contract",
      })
    );

    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current).toMatchObject({
      reason: "no-searchable-targets",
      isSelectable: false,
    });
    expect(mockedClient.unifiedSearch).not.toHaveBeenCalled();
  });

  it("exposes non-selectable empty and error states", async () => {
    mockedClient.unifiedSearch.mockResolvedValueOnce(searchResponse([]));

    const { result, rerender } = renderHook(
      ({ query }) =>
        useWorkItemGraphMetaLinkSearch({
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          sourceChild: SOURCE_CHILD,
          searchTarget: CONTRACT_DECLARATION,
          query,
        }),
      { initialProps: { query: "missing" } }
    );

    await waitFor(() => expect(result.current.status).toBe("empty"));
    expect(result.current.isSelectable).toBe(false);

    const serviceError = new Error("search unavailable");
    mockedClient.unifiedSearch.mockRejectedValueOnce(serviceError);
    rerender({ query: "failure" });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current).toMatchObject({
      results: [],
      isSelectable: false,
      error: serviceError,
    });
  });

  it("suppresses an older response after query and relationship selection change", async () => {
    const firstRequest = deferred<AxiosResponse<UnifiedSearch200Response>>();
    const secondRequest = deferred<AxiosResponse<UnifiedSearch200Response>>();
    mockedClient.unifiedSearch
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);

    const { result, rerender } = renderHook(
      ({
        query,
        searchTarget,
      }: {
        query: string;
        searchTarget: WorkItemTypeGraphSearchableMetaLinkTarget;
      }) =>
        useWorkItemGraphMetaLinkSearch({
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          sourceChild: SOURCE_CHILD,
          searchTarget,
          query,
        }),
      {
        initialProps: {
          query: "contract",
          searchTarget: CONTRACT_DECLARATION,
        },
      }
    );

    rerender({
      query: "approval",
      searchTarget: APPROVAL_DECLARATION,
    });

    await act(async () => {
      secondRequest.resolve(
        searchResponse([
          searchResult({
            id: APPROVAL_ID,
            title: "Security Approval",
            taskType: "APPROVAL_GATE",
          }),
        ])
      );
    });
    expect(result.current.results[0]?.identity.id).toBe(APPROVAL_ID);

    await act(async () => {
      firstRequest.resolve(
        searchResponse([
          searchResult({
            id: CONTRACT_ID,
            title: "Late Contract",
            taskType: "CONTRACT",
          }),
        ])
      );
    });

    expect(result.current).toMatchObject({
      status: "success",
      results: [
        {
          identity: { refType: "existing", id: APPROVAL_ID },
          workItemTypeKey: "APPROVAL_GATE",
          title: "Security Approval",
        },
      ],
    });
  });
});
