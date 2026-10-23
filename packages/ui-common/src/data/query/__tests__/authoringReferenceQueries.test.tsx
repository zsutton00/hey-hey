import type { ReactNode } from "react";
import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkStatus,
  Priority,
  InitiativeCreatorType,
  type InitiativeResponseDto,
  type ImplementationHintDto,
} from "../../../api";
import {
  useEntityPromptTemplates,
  useEffectiveEntityPromptTemplate,
  useEntityPromptTemplateProposal,
} from "../../hooks/useEntityPromptTemplates";
import { useInitiative } from "../../hooks/useInitiative";
import { useInitiatives } from "../../hooks/useInitiatives";
import { useArtifact } from "../../hooks/useArtifact";
import { useArtifacts } from "../../hooks/useArtifacts";
import { useImplementationHint } from "../../hooks/useImplementationHint";
import { useImplementationHints } from "../../hooks/useImplementationHints";
import { useFileReferenceCandidates } from "../../hooks/useFileReferenceCandidates";
import { useHelpNode } from "../../hooks/useHelpNode";
import { implementationHintKeys } from "../../collections/implementationHints";
import { initiativeKeys } from "../../collections/initiatives";
import { proposalKeys } from "../../collections/proposals";
import type { ProposalResponseDto } from "../../../api";
import { WebSocketHandler } from "../../websockets/handler";
import { createRelationshipMutationInvalidator } from "../../hooks/relationshipMutationInvalidation";
import {
  dataLayerQueryRoots,
  invalidateInitiativeChange,
} from "../dataLayerInvalidation";
import { loadConfig, resetConfig } from "../../relationships";

const mocks = vi.hoisted(() => ({
  proposal: vi.fn(),
  catalog: vi.fn(),
  effective: vi.fn(),
  initiative: vi.fn(),
  initiatives: vi.fn(),
  conversation: vi.fn(),
  createInitiative: vi.fn(),
  updateInitiative: vi.fn(),
  removeInitiative: vi.fn(),
  artifact: vi.fn(),
  artifacts: vi.fn(),
  hint: vi.fn(),
  hints: vi.fn(),
  createHint: vi.fn(),
  updateHint: vi.fn(),
  removeHint: vi.fn(),
  files: vi.fn(),
  help: vi.fn(),
}));
vi.mock("../../../clients", async (original) => ({
  ...(await original<object>()),
  dataClient: { request: mocks.hints },
}));
vi.mock("../../../clients/serviceClients", async (original) => ({
  ...(await original<object>()),
  proposalsClient: { getProposal: mocks.proposal },
  entityPromptTemplatesClient: {
    getProjectEntityPromptTemplateCatalog: mocks.catalog,
    getEffectiveEntityPromptTemplate: mocks.effective,
  },
  platformClient: {
    getInitiative: mocks.initiative,
    getOrganizationInitiatives: mocks.initiatives,
    createInitiative: mocks.createInitiative,
    updateInitiative: mocks.updateInitiative,
    removeInitiative: mocks.removeInitiative,
  },
  conversationsClient: { getConversationInitiatives: mocks.conversation },
  unifiedApiClient: {
    getArtifact: mocks.artifact,
    findManyArtifacts: mocks.artifacts,
    getImplementationHint: mocks.hint,
    createImplementationHint: mocks.createHint,
    updateImplementationHint: mocks.updateHint,
    deleteImplementationHint: mocks.removeHint,
    getHelpNode: mocks.help,
  },
  reportsClient: { listReportFileTouchesByWork: mocks.files },
}));
vi.mock("../../hooks/useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));
const identity = {
  organizationId: "org",
  projectId: "project",
  templateKey: "context",
  selector: { entityType: "PROJECT" as const },
};
const fileInput = {
  organizationId: "org",
  projectId: "project",
  scope: { kind: "task" as const, taskId: "item" },
  active: true,
};
const initiative: InitiativeResponseDto = {
  id: "item",
  organizationId: "org",
  originatingProjectId: "project",
  name: "Original",
  status: WorkStatus.Backlog,
  priority: Priority.Medium,
  creatorType: InitiativeCreatorType.User,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};
const hint: ImplementationHintDto = {
  id: "hint",
  serviceId: "service",
  agentSessionId: "session",
  featureName: "Original",
  description: "Evidence",
  hint: "Evidence",
  sourceType: "USER",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};
const candidate = {
  serviceId: "service",
  serviceName: "UI Common",
  normalizedPath: "src/index.ts",
};
const help = {
  id: "help",
  parentId: null,
  slug: "guide",
  title: "Guide",
  ordering: 1,
  body: "Instructions",
  demos: [],
};
const effective = {
  templateKey: "context",
  selector: identity.selector,
  syntaxVersion: "V1",
  content: "Template",
  ownershipSource: { scope: "CANONICAL" },
  revisionId: "revision",
  revisionNumber: 1,
  lifecycleState: "PUBLISHED",
  validationStatus: "VALID",
  publishedAt: "2026-10-01T00:00:00Z",
};
const template = {
  templateKey: "context",
  canonicalDefault: {
    ...effective,
    ownershipScope: effective.ownershipSource,
    validation: { status: "VALID", issues: [] },
  },
  revisionHistory: [],
  effective,
};
const artifact = { id: "artifact", name: "Artifact" };
const envelope = (data: unknown) => ({ data: { data } });
const readers = [
  {
    name: "prompt catalog",
    mock: mocks.catalog,
    response: envelope({ templates: [template] }),
    empty: envelope({ templates: [] }),
    useRead: (enabled = true) =>
      useEntityPromptTemplates(identity, { enabled }),
  },
  {
    name: "effective template",
    mock: mocks.effective,
    response: envelope(effective),
    empty: envelope(null),
    useRead: (enabled = true) =>
      useEffectiveEntityPromptTemplate(identity, { enabled }),
  },
  {
    name: "initiative",
    mock: mocks.initiative,
    response: envelope(initiative),
    empty: envelope(null),
    useRead: (enabled = true) => useInitiative("org", "item", { enabled }),
  },
  {
    name: "initiative list",
    mock: mocks.initiatives,
    response: envelope([initiative]),
    empty: envelope([]),
    useRead: (enabled = true) =>
      useInitiatives("org", "project", undefined, { enabled }),
  },
  {
    name: "artifact",
    mock: mocks.artifact,
    response: envelope(artifact),
    empty: envelope(null),
    useRead: (enabled = true) => useArtifact("org", "artifact", { enabled }),
  },
  {
    name: "artifact list",
    mock: mocks.artifacts,
    response: envelope([artifact]),
    empty: envelope([]),
    useRead: (enabled = true) => useArtifacts("org", "project", { enabled }),
  },
  {
    name: "implementation hint",
    mock: mocks.hint,
    response: envelope(hint),
    useRead: (enabled = true) =>
      useImplementationHint("org", "service", "hint", { enabled }),
  },
  {
    name: "hint list",
    mock: mocks.hints,
    response: envelope([hint]),
    empty: envelope([]),
    useRead: (enabled = true) =>
      useImplementationHints("org", "service", { enabled }),
  },
  {
    name: "help node",
    mock: mocks.help,
    response: envelope(help),
    empty: envelope(null),
    useRead: (enabled = true) => useHelpNode("guide", { enabled }),
  },
];
let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  resetConfig();
  client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity } },
  });
  for (const reader of readers)
    reader.mock.mockReset().mockResolvedValue(reader.response);
  mocks.files
    .mockReset()
    .mockResolvedValue(envelope({ candidates: [candidate] }));
  mocks.conversation.mockReset().mockResolvedValue(envelope([initiative]));
});
afterEach(() => {
  cleanup();
  client.clear();
  resetConfig();
});

describe.each(readers)("$name query", (reader) => {
  it("shares a first read with a mid-flight mount and fresh remount", async () => {
    const pending = deferred<unknown>();
    reader.mock.mockReturnValueOnce(pending.promise);
    const first = renderHook(() => reader.useRead(), { wrapper });
    expect(first.result.current.error).toBeNull();
    expect(first.result.current.isFetched).toBe(false);
    const second = renderHook(() => reader.useRead(), { wrapper });
    expect(reader.mock).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(reader.response));
    await waitFor(() =>
      expect(
        first.result.current.isFetched && second.result.current.isFetched
      ).toBe(true)
    );
    second.unmount();
    const remount = renderHook(() => reader.useRead(), { wrapper });
    await waitFor(() => expect(remount.result.current.isFetched).toBe(true));
    expect(reader.mock).toHaveBeenCalledTimes(1);
    expect(reader.mock.mock.calls[0].at(-1)).toEqual(
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
  it("keeps a disabled read unstarted and non-error", () => {
    const { result } = renderHook(() => reader.useRead(false), { wrapper });
    expect(reader.mock).not.toHaveBeenCalled();
    expect(result.current.isFetched).toBe(false);
    expect(result.current.error).toBeNull();
  });
  it("reports a settled failure and caches a 404 across new observers", async () => {
    reader.mock.mockRejectedValue(
      Object.assign(new Error("Missing"), { status: 404 })
    );
    const first = renderHook(() => reader.useRead(), { wrapper });
    await waitFor(() => expect(first.result.current.error).toBeTruthy());
    expect(first.result.current.isFetched).toBe(true);
    const second = renderHook(() => reader.useRead(), { wrapper });
    await waitFor(() => expect(second.result.current.error).toBeTruthy());
    expect(reader.mock).toHaveBeenCalledTimes(1);
  });
  if (reader.empty)
    it("treats empty as a successful fetched answer", async () => {
      reader.mock.mockResolvedValue(reader.empty);
      const { result } = renderHook(() => reader.useRead(), { wrapper });
      await waitFor(() => expect(result.current.isFetched).toBe(true));
      expect(result.current.error).toBeNull();
      if ("isReady" in result.current)
        expect(result.current.isReady).toBe(true);
    });
});

describe("composer file references", () => {
  it("shares candidates between composers mounting during the first read and after it", async () => {
    const pending = deferred<unknown>();
    mocks.files.mockReturnValueOnce(pending.promise);
    const first = renderHook(() => useFileReferenceCandidates(fileInput), {
      wrapper,
    });
    expect(first.result.current.status).toBe("loading");
    const second = renderHook(() => useFileReferenceCandidates(fileInput), {
      wrapper,
    });
    await act(async () =>
      pending.resolve(envelope({ candidates: [candidate] }))
    );
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(first.result.current).toEqual(second.result.current);
    renderHook(() => useFileReferenceCandidates(fileInput), { wrapper });
    expect(mocks.files).toHaveBeenCalledTimes(1);
  });
  it("has defined disabled, empty, updating and failed states", async () => {
    const { result, rerender } = renderHook(
      ({ active }) => useFileReferenceCandidates({ ...fileInput, active }),
      { wrapper, initialProps: { active: false } }
    );
    expect(result.current.status).toBe("disabled");
    expect(mocks.files).not.toHaveBeenCalled();
    mocks.files.mockResolvedValueOnce(envelope({ candidates: [] }));
    rerender({ active: true });
    await waitFor(() => expect(result.current.status).toBe("empty"));
    await act(async () =>
      client.invalidateQueries({ queryKey: ["fileReferenceCandidates"] })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const pending = deferred<unknown>();
    mocks.files.mockReturnValueOnce(pending.promise);
    act(() => {
      void client.invalidateQueries({ queryKey: ["fileReferenceCandidates"] });
    });
    await waitFor(() => expect(result.current.status).toBe("updating"));
    expect(result.current.candidates).toEqual([candidate]);
    await act(async () =>
      pending.resolve(envelope({ candidates: [candidate] }))
    );
    mocks.files.mockRejectedValueOnce(
      Object.assign(new Error("Missing"), { status: 404 })
    );
    await act(async () =>
      client.invalidateQueries({ queryKey: ["fileReferenceCandidates"] })
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
  });
  it("separates organization, project, kind and focal identity", async () => {
    renderHook(
      () => [
        useFileReferenceCandidates(fileInput),
        useFileReferenceCandidates({ ...fileInput, organizationId: "other" }),
        useFileReferenceCandidates({ ...fileInput, projectId: "other" }),
        useFileReferenceCandidates({
          ...fileInput,
          scope: { kind: "feature", featureId: "item" },
        }),
        useFileReferenceCandidates({
          ...fileInput,
          scope: { kind: "task", taskId: "other" },
        }),
      ],
      { wrapper }
    );
    await waitFor(() => expect(mocks.files).toHaveBeenCalledTimes(5));
  });
});
describe("initiative invalidation", () => {
  function mountInitiatives() {
    return renderHook(
      () => ({
        detail: useInitiative("org", "item"),
        same: useInitiative("org", "item", { includeDesignDocCounts: true }),
        unrelated: useInitiative("org", "other"),
        list: useInitiatives("org", "project"),
        org: useInitiatives("org", ""),
        conversation: useInitiatives("org", "project", "conversation"),
        sections: useInitiatives("org", "project", undefined, {
          includeSectionKeys: ["description"],
        }),
        otherProject: useInitiatives("org", "other"),
      }),
      { wrapper }
    );
  }
  const event = {
    type: "initiative.updated" as const,
    organizationId: "org",
    projectId: "project",
    initiativeId: "item",
    changedFields: ["assigneeId"],
    changedBy: {
      userId: "other-user",
      name: "Other",
      email: "other@example.com",
    },
    timestamp: "2026-10-01T00:00:00Z",
  };
  it.each(["realtime", "mutation"] as const)(
    "refreshes each affected mounted key once after a %s change",
    async (source) => {
      const mounted = mountInitiatives();
      await waitFor(() =>
        expect(
          mounted.result.current.sections.isReady &&
            mounted.result.current.conversation.isReady &&
            mounted.result.current.detail.isFetched &&
            mounted.result.current.unrelated.isFetched
        ).toBe(true)
      );
      const beforeLists = mocks.initiatives.mock.calls.length;
      if (source === "realtime") {
        loadConfig({
          version: "test",
          generatedAt: "2026-10-01T00:00:00Z",
          rules: [
            {
              sourceEntity: "Initiative",
              sourceFields: ["originatingProjectId"],
              targetCollections: ["Initiative"],
              relationshipPath: "initiatives",
              cardinality: "1:1",
              lookupField: "projectId",
              invalidationMode: "invalidate",
            },
          ],
        });
        const handler = new WebSocketHandler(createStore(), undefined, client);
        act(() => handler.handleEvent(event));
      } else {
        const invalidate = createRelationshipMutationInvalidator({
          invalidateInitiativeChange: (org, project, id) => {
            void invalidateInitiativeChange(client, org, project, id);
          },
          invalidateQueryKey: (key) => {
            void client.invalidateQueries({ queryKey: key });
          },
          invalidateQueries: (filters) => {
            void client.invalidateQueries(filters);
          },
        });
        act(() =>
          invalidate({
            entityType: "Initiative",
            operation: "update",
            sourceEntity: initiative,
          })
        );
      }
      await waitFor(() =>
        expect(mocks.initiatives).toHaveBeenCalledTimes(beforeLists + 3)
      );
      await waitFor(() => expect(mocks.conversation).toHaveBeenCalledTimes(2));
      expect(mocks.initiative).toHaveBeenCalledTimes(3); // 2 distinct initial reads, one refreshed
      expect(
        client.getQueryState(initiativeKeys.detail("org", "other"))
          ?.isInvalidated
      ).toBe(false);
    }
  );
  it("starts a causal follow-up when the first read is still pending", async () => {
    const pending = deferred<unknown>();
    mocks.initiative.mockReturnValueOnce(pending.promise);
    const mounted = renderHook(() => useInitiative("org", "item"), { wrapper });
    const handler = new WebSocketHandler(createStore(), undefined, client);
    await act(async () => handler.handleEvent(event));
    await waitFor(() => expect(mocks.initiative).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(mounted.result.current.data?.name).toBe("Original")
    );
    await act(async () =>
      pending.resolve(envelope({ ...initiative, name: "Obsolete" }))
    );
    expect(mounted.result.current.data?.name).toBe("Original");
  });
  it("invalidates mounted lists on creation and deletion and drops deleted details", async () => {
    const mounted = mountInitiatives();
    await waitFor(() =>
      expect(
        mounted.result.current.sections.isReady &&
          mounted.result.current.conversation.isReady
      ).toBe(true)
    );
    const handler = new WebSocketHandler(createStore(), undefined, client);
    const before = mocks.initiatives.mock.calls.length;
    act(() =>
      handler.handleEvent({
        type: "initiative.created",
        organizationId: "org",
        projectId: "project",
        initiativeId: "created",
        timestamp: event.timestamp,
      })
    );
    await waitFor(() =>
      expect(mocks.initiatives).toHaveBeenCalledTimes(before + 3)
    );
    mocks.initiative.mockResolvedValue(envelope(null));
    mocks.initiatives.mockResolvedValue(envelope([]));
    act(() =>
      handler.handleEvent({
        type: "initiative.deleted",
        organizationId: "org",
        projectId: "project",
        id: "item",
        timestamp: event.timestamp,
      })
    );
    await waitFor(() => expect(mounted.result.current.detail.data).toBeNull());
    await waitFor(() =>
      expect(mounted.result.current.list.initiatives).toEqual([])
    );
  });
  it("keeps real section projections distinct but shares unused count and order options", async () => {
    renderHook(
      () => ({
        first: useInitiatives("org", "project", undefined, {
          includeDesignDocCounts: true,
          status: [WorkStatus.Backlog, WorkStatus.Completed],
        }),
        second: useInitiatives("org", "project", undefined, {
          status: [WorkStatus.Completed, WorkStatus.Backlog],
        }),
      }),
      { wrapper }
    );
    await waitFor(() => expect(mocks.initiatives).toHaveBeenCalledTimes(1));
  });
});
describe("mutation cache continuity", () => {
  function mount() {
    return renderHook(
      () => ({
        detail: useInitiative("org", "item"),
        list: useInitiatives("org", "project"),
      }),
      { wrapper }
    );
  }
  it.each(["success", "failure"] as const)(
    "updates initiative assignee across list/detail and handles %s",
    async (outcome) => {
      const mounted = mount();
      await waitFor(() =>
        expect(
          mounted.result.current.detail.isFetched &&
            mounted.result.current.list.isReady
        ).toBe(true)
      );
      const pending = deferred<unknown>();
      mocks.updateInitiative.mockReturnValueOnce(pending.promise);
      const success = vi.fn(),
        failure = vi.fn(),
        settled = vi.fn();
      let operation!: Promise<unknown>;
      act(() => {
        operation = mounted.result.current.list.update(
          "item",
          { assigneeId: "person" },
          { onSuccess: success, onError: failure, onSettled: settled }
        );
        void operation.catch(() => {});
      });
      await waitFor(() =>
        expect(mounted.result.current.detail.data?.assigneeId).toBe("person")
      );
      expect(mounted.result.current.list.initiatives[0].assigneeId).toBe(
        "person"
      );
      if (outcome === "success") {
        const updated = { ...initiative, assigneeId: "person", name: "Server" };
        mocks.initiative.mockResolvedValue(envelope(updated));
        mocks.initiatives.mockResolvedValue(envelope([updated]));
        await act(async () => {
          pending.resolve(envelope(updated));
          await operation;
        });
        await waitFor(() =>
          expect(mounted.result.current.detail.data?.name).toBe("Server")
        );
        expect(success).toHaveBeenCalledWith(updated);
      } else {
        await act(async () => {
          pending.reject(new Error("Denied"));
          await operation.catch(() => {});
        });
        await waitFor(() =>
          expect(mounted.result.current.detail.data?.assigneeId).toBeUndefined()
        );
        expect(
          mounted.result.current.list.initiatives[0].assigneeId
        ).toBeUndefined();
        expect(failure).toHaveBeenCalledWith(expect.any(Error));
      }
      expect(settled).toHaveBeenCalledTimes(1);
      expect(mocks.updateInitiative).toHaveBeenCalledWith(
        expect.objectContaining({
          initiativeId: "item",
          updateInitiativeDto: { assigneeId: "person" },
        })
      );
    }
  );
  it.each(["success", "failure"] as const)(
    "creates an initiative optimistically with %s cleanup",
    async (outcome) => {
      const mounted = mount();
      await waitFor(() =>
        expect(mounted.result.current.list.isReady).toBe(true)
      );
      const pending = deferred<unknown>();
      mocks.createInitiative.mockReturnValueOnce(pending.promise);
      let operation!: Promise<unknown>;
      act(() => {
        operation = mounted.result.current.list.create({
          name: "New",
          projectId: "project",
        });
        void operation.catch(() => {});
      });
      await waitFor(() =>
        expect(mounted.result.current.list.initiatives).toHaveLength(2)
      );
      if (outcome === "success") {
        const created = { ...initiative, id: "created", name: "New" };
        mocks.initiatives.mockResolvedValue(envelope([initiative, created]));
        await act(async () => {
          pending.resolve(envelope(created));
          await operation;
        });
        await waitFor(() =>
          expect(
            mounted.result.current.list.initiatives.map((item) => item.id)
          ).toEqual(["item", "created"])
        );
      } else {
        await act(async () => {
          pending.reject(new Error("Denied"));
          await operation.catch(() => {});
        });
        await waitFor(() =>
          expect(mounted.result.current.list.initiatives).toEqual([initiative])
        );
      }
    }
  );
  it.each(["success", "failure"] as const)(
    "removes an initiative from list/detail with %s cleanup",
    async (outcome) => {
      const mounted = mount();
      await waitFor(() =>
        expect(
          mounted.result.current.list.isReady &&
            mounted.result.current.detail.isFetched
        ).toBe(true)
      );
      const pending = deferred<unknown>();
      mocks.removeInitiative.mockReturnValueOnce(pending.promise);
      let operation!: Promise<unknown>;
      act(() => {
        operation = mounted.result.current.list.remove("item");
        void operation.catch(() => {});
      });
      await waitFor(() =>
        expect(mounted.result.current.list.initiatives).toEqual([])
      );
      expect(mounted.result.current.detail.data).toBeNull();
      if (outcome === "success") {
        mocks.initiative.mockResolvedValue(envelope(null));
        mocks.initiatives.mockResolvedValue(envelope([]));
        await act(async () => {
          pending.resolve(undefined);
          await operation;
        });
      } else {
        await act(async () => {
          pending.reject(new Error("Denied"));
          await operation.catch(() => {});
        });
        await waitFor(() =>
          expect(mounted.result.current.detail.data).toEqual(initiative)
        );
        await waitFor(() =>
          expect(mounted.result.current.list.initiatives).toEqual([initiative])
        );
      }
    }
  );
  it.each(["success", "failure"] as const)(
    "updates hint list/detail with %s cleanup",
    async (outcome) => {
      const mounted = renderHook(
        () => ({
          detail: useImplementationHint("org", "service", "hint"),
          list: useImplementationHints("org", "service"),
        }),
        { wrapper }
      );
      await waitFor(() =>
        expect(
          mounted.result.current.list.isReady &&
            mounted.result.current.detail.isReady
        ).toBe(true)
      );
      const pending = deferred<unknown>();
      mocks.updateHint.mockReturnValueOnce(pending.promise);
      let operation!: Promise<unknown>;
      act(() => {
        operation = mounted.result.current.list.update("hint", {
          featureName: "New",
          serviceId: "service",
        });
        void operation.catch(() => {});
      });
      await waitFor(() =>
        expect(mounted.result.current.detail.data?.featureName).toBe("New")
      );
      if (outcome === "success") {
        const updated = { ...hint, featureName: "Server" };
        mocks.hints.mockResolvedValue(envelope([updated]));
        await act(async () => {
          pending.resolve(envelope(updated));
          await operation;
        });
        await waitFor(() =>
          expect(mounted.result.current.list.hints[0].featureName).toBe(
            "Server"
          )
        );
        expect(mounted.result.current.detail.data?.featureName).toBe("Server");
      } else {
        await act(async () => {
          pending.reject(new Error("Denied"));
          await operation.catch(() => {});
        });
        await waitFor(() =>
          expect(mounted.result.current.detail.data).toEqual(hint)
        );
        expect(mounted.result.current.list.hints).toEqual([hint]);
      }
    }
  );
});
describe("lifecycle refresh and reconnect", () => {
  it("keeps expired help visible and fetching during its one shared refresh", async () => {
    client.setQueryData(["help", "guide"], help, {
      updatedAt: Date.now() - 10000,
    });
    const pending = deferred<unknown>();
    mocks.help.mockReturnValueOnce(pending.promise);
    const mounted = renderHook(
      () => ({
        first: useHelpNode("guide", { maxCacheAgeMs: 5000 }),
        second: useHelpNode("guide", { maxCacheAgeMs: 5000 }),
      }),
      { wrapper }
    );
    expect(mounted.result.current.first.data).toEqual(help);
    expect(mounted.result.current.first.isFetching).toBe(true);
    await waitFor(() => expect(mocks.help).toHaveBeenCalledTimes(1));
    await act(async () => pending.resolve(envelope(help)));
    await waitFor(() =>
      expect(mounted.result.current.first.isFetching).toBe(false)
    );
  });
  it("refreshes every mounted dataset once on reconnect while leaving inactive keys unread", async () => {
    const mounted = renderHook(
      () => {
        const catalog = useEntityPromptTemplates(identity);
        const effective = useEffectiveEntityPromptTemplate(identity);
        const initiatives = useInitiatives("org", "project");
        const artifacts = useArtifacts("org", "project");
        const hints = useImplementationHints("org", "service");
        const help = useHelpNode("guide");
        const files = useFileReferenceCandidates(fileInput);
        return [
          catalog.isReady,
          effective.isReady,
          initiatives.isReady,
          artifacts.isReady,
          hints.isReady,
          help.isReady,
          files.status === "ready",
        ];
      },
      { wrapper }
    );
    await waitFor(() =>
      expect(mounted.result.current.every(Boolean)).toBe(true)
    );
    client.setQueryData(initiativeKeys.detail("org", "inactive"), initiative);
    const handler = new WebSocketHandler(createStore(), undefined, client);
    act(() => handler.markAllStale());
    for (const mock of [
      mocks.catalog,
      mocks.effective,
      mocks.initiatives,
      mocks.artifacts,
      mocks.hints,
      mocks.help,
      mocks.files,
    ]) {
      await waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
    }
    expect(mocks.initiative).not.toHaveBeenCalled();
    for (const root of [
      "entityPromptTemplates",
      "initiatives",
      "artifacts",
      "implementationHints",
      "fileReferenceCandidates",
      "help",
    ])
      expect(dataLayerQueryRoots()).toContainEqual([root]);
    expect(
      client.getQueryState(initiativeKeys.detail("org", "inactive"))
        ?.isInvalidated
    ).toBe(true);
  });
});

describe("hint create and remove continuity", () => {
  it.each(["success", "failure"] as const)(
    "creates a hint optimistically with %s cleanup",
    async (outcome) => {
      const mounted = renderHook(
        () => useImplementationHints("org", "service"),
        { wrapper }
      );
      await waitFor(() => expect(mounted.result.current.isReady).toBe(true));
      const pending = deferred<unknown>();
      mocks.createHint.mockReturnValueOnce(pending.promise);
      let operation!: Promise<boolean>;
      const onSettled = vi.fn();
      act(() => {
        operation = mounted.result.current.create(
          {
            featureName: "New",
            description: "Text",
            serviceId: "service",
            agentSessionId: "session",
            sourceType: "USER",
          },
          { onSettled }
        );
        void operation.catch(() => {});
      });
      await waitFor(() => expect(mounted.result.current.hints).toHaveLength(2));
      if (outcome === "success") {
        const created = { ...hint, id: "new", featureName: "New" };
        mocks.hints.mockResolvedValue(envelope([hint, created]));
        await act(async () => {
          pending.resolve(envelope(created));
          expect(await operation).toBe(true);
        });
        await waitFor(() =>
          expect(
            mounted.result.current.hints.map((item) => item.id).sort()
          ).toEqual(["hint", "new"])
        );
        expect(
          client.getQueryData(
            implementationHintKeys.detail("org", "service", "new")
          )
        ).toEqual(created);
      } else {
        await act(async () => {
          pending.reject(new Error("Denied"));
          await operation.catch(() => {});
        });
        await waitFor(() =>
          expect(mounted.result.current.hints).toEqual([hint])
        );
      }
      expect(onSettled).toHaveBeenCalledTimes(1);
    }
  );
  it.each(["success", "failure"] as const)(
    "removes a hint from list/detail with %s cleanup",
    async (outcome) => {
      const mounted = renderHook(
        () => ({
          list: useImplementationHints("org", "service"),
          detail: useImplementationHint("org", "service", "hint"),
        }),
        { wrapper }
      );
      await waitFor(() =>
        expect(
          mounted.result.current.list.isReady &&
            mounted.result.current.detail.isReady
        ).toBe(true)
      );
      const pending = deferred<unknown>();
      mocks.removeHint.mockReturnValueOnce(pending.promise);
      let operation!: Promise<void>;
      act(() => {
        operation = mounted.result.current.list.remove("hint");
        void operation.catch(() => {});
      });
      await waitFor(() =>
        expect(mounted.result.current.list.hints).toEqual([])
      );
      expect(mounted.result.current.detail.data).toBeNull();
      if (outcome === "success") {
        mocks.hints.mockResolvedValue(envelope([]));
        await act(async () => {
          pending.resolve(undefined);
          await operation;
        });
        expect(
          client.getQueryData(
            implementationHintKeys.detail("org", "service", "hint")
          )
        ).toBeNull();
      } else {
        await act(async () => {
          pending.reject(new Error("Denied"));
          await operation.catch(() => {});
        });
        await waitFor(() =>
          expect(mounted.result.current.detail.data).toEqual(hint)
        );
        expect(mounted.result.current.list.hints).toEqual([hint]);
      }
    }
  );
});
describe("authoring read wiring", () => {
  it("refreshes catalog/effective once when a matching proposal becomes approved", async () => {
    const proposal: ProposalResponseDto = {
      id: "proposal",
      organizationId: "org",
      projectId: "project",
      type: "SINGLE",
      action: "UPDATE",
      status: "DRAFT",
      targetEntityId: "context",
      targetEntityType: "ENTITY_PROMPT_TEMPLATE",
      requestorId: "user",
      requiredApprovals: 1,
      approvals: [],
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
      updates: {
        operation: "UPSERT",
        projectId: "project",
        selector: identity.selector,
        syntaxVersion: "V1",
        content: "New",
        expectedEffectiveRevision: {
          revisionId: "revision",
          revisionNumber: 1,
        },
      },
    };
    mocks.proposal.mockResolvedValue(envelope(proposal));
    const mounted = renderHook(
      () => ({
        catalog: useEntityPromptTemplates(identity),
        effective: useEffectiveEntityPromptTemplate(identity),
        proposal: useEntityPromptTemplateProposal(proposal, identity),
      }),
      { wrapper }
    );
    await waitFor(() =>
      expect(
        mounted.result.current.catalog.isReady &&
          mounted.result.current.effective.isReady &&
          mounted.result.current.proposal.isReady
      ).toBe(true)
    );
    mocks.effective.mockResolvedValue(
      envelope({ ...effective, content: "New" })
    );
    act(() =>
      client.setQueryData(proposalKeys.detail("org", "project", "proposal"), {
        ...proposal,
        status: "APPROVED",
        updatedAt: "2026-10-01T00:01:00Z",
      })
    );
    await waitFor(() =>
      expect(mounted.result.current.effective.effective?.content).toBe("New")
    );
    expect(mocks.catalog).toHaveBeenCalledTimes(2);
    expect(mocks.effective).toHaveBeenCalledTimes(2);
  });
  it("passes artifact server filters and initiative statuses through to their owners", async () => {
    const mounted = renderHook(
      () => ({
        artifacts: useArtifacts("org", "project", {
          sourceType: "report",
          sourceId: "source",
          tags: "tag",
          category: "category",
          parentId: "parent",
          publicOnly: false,
        }),
        initiatives: useInitiatives("org", "project", undefined, {
          status: WorkStatus.Backlog,
          includeSectionKeys: ["description"],
        }),
      }),
      { wrapper }
    );
    await waitFor(() =>
      expect(
        mounted.result.current.artifacts.isReady &&
          mounted.result.current.initiatives.isReady
      ).toBe(true)
    );
    expect(mocks.artifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org",
        projectId: "project",
        sourceType: "report",
        sourceId: "source",
        tags: "tag",
        category: "category",
        parentId: "parent",
        publicOnly: false,
        page: 1,
        limit: 100,
      }),
      expect.any(Object)
    );
    expect(mocks.initiatives).toHaveBeenCalledWith(
      expect.objectContaining({
        status: [WorkStatus.Backlog],
        includeSectionKeys: ["description"],
      }),
      expect.any(Object)
    );
  });
  it("shares a conversation read despite non-server status and section options", async () => {
    const mounted = renderHook(
      () => ({
        first: useInitiatives("org", "project", "conversation", {
          status: WorkStatus.Backlog,
        }),
        second: useInitiatives("org", "project", "conversation", {
          includeSectionKeys: ["description"],
        }),
      }),
      { wrapper }
    );
    await waitFor(() =>
      expect(
        mounted.result.current.first.isReady &&
          mounted.result.current.second.isReady
      ).toBe(true)
    );
    expect(mocks.conversation).toHaveBeenCalledTimes(1);
  });
  it("preserves artifact refetch failure's null result and reports the failed read", async () => {
    const mounted = renderHook(() => useArtifact("org", "artifact"), {
      wrapper,
    });
    await waitFor(() => expect(mounted.result.current.isReady).toBe(true));
    mocks.artifact.mockRejectedValueOnce(
      Object.assign(new Error("Denied"), { status: 403 })
    );
    await act(async () =>
      expect(await mounted.result.current.refetch()).toBeNull()
    );
    await waitFor(() => expect(mounted.result.current.error).toBeTruthy());
  });
  it("explicit markStale refreshes help without waking another key", async () => {
    const mounted = renderHook(
      () => ({ first: useHelpNode("guide"), second: useHelpNode("other") }),
      { wrapper }
    );
    await waitFor(() =>
      expect(
        mounted.result.current.first.isReady &&
          mounted.result.current.second.isReady
      ).toBe(true)
    );
    act(() => mounted.result.current.first.markStale());
    await waitFor(() => expect(mocks.help).toHaveBeenCalledTimes(3));
    expect(
      mocks.help.mock.calls.filter(([input]) => input.idOrSlugPath === "other")
    ).toHaveLength(1);
  });
});

describe("hint error dismissal", () => {
  it("clears a failed refresh while preserving the cached hints and their age", async () => {
    const mounted = renderHook(() => useImplementationHints("org", "service"), {
      wrapper,
    });
    await waitFor(() => expect(mounted.result.current.isReady).toBe(true));
    const key = implementationHintKeys.list("org", { serviceId: "service" });
    const fetchedAt = client.getQueryState(key)?.dataUpdatedAt;
    mocks.hints.mockRejectedValueOnce(
      Object.assign(new Error("Denied"), { status: 403 })
    );
    await act(async () => {
      await mounted.result.current.refetch().catch(() => {});
    });
    await waitFor(() => expect(mounted.result.current.error).toBe("Denied"));
    act(() => mounted.result.current.clearError());
    await waitFor(() => expect(mounted.result.current.error).toBeNull());
    expect(mounted.result.current.hints).toEqual([hint]);
    expect(client.getQueryState(key)?.dataUpdatedAt).toBe(fetchedAt);
    expect(mocks.hints).toHaveBeenCalledTimes(2);
  });
});
