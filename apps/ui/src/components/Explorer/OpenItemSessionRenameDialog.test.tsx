import {
  filterProjectedOpenItems,
  projectOpenItems,
} from "./openItemsProjection";
import {
  openItemsRows,
  openItemsGroupRows,
} from "../../../../../packages/ui-common/src/data/openItemsMapping";
import React from "react";
import axios, {
  AxiosError,
  AxiosHeaders,
  type InternalAxiosRequestConfig,
} from "axios";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createApiRuntime,
  registerApiRuntime,
} from "@hey-hey/ui-common/clients";
import {
  AgentSessionType,
  EntityType,
  type OpenItem,
  type OpenItemsPresentCollection,
} from "@hey-hey/contracts/api";
import { OpenItemSessionRenameDialog } from "./OpenItemSessionRenameDialog";
import { openItemsKeys } from "../../../../../packages/ui-common/src/data/openItemsAdapter";
import { conversationKeys } from "../../../../../packages/ui-common/src/data/collections/conversations";

vi.mock("@hey-hey/ui-common/context", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAuth: () => ({ user: { id: "user" } }),
}));
const sessionId = "550e8400-e29b-41d4-a716-446655440000";
const conversationId = "550e8400-e29b-41d4-a716-446655440001";
const groupId = "550e8400-e29b-41d4-a716-446655440002";
const scope = { organizationId: "org", projectId: "project", userId: "user" };
const now = "2026-11-13T00:00:00.000Z";
let title: string;
let version: number;
let failRead: boolean;
let failWrite: boolean;
let failRefresh: boolean;
let requests: {
  method?: string;
  path: string;
  body: Record<string, unknown>;
}[];
let collection: OpenItemsPresentCollection;
let close: ReturnType<typeof vi.fn>;
let queryClient: QueryClient;
const body = (config: InternalAxiosRequestConfig): Record<string, unknown> =>
  config.data ? JSON.parse(config.data) : {};
const conversation = () => ({
  id: conversationId,
  title,
  version,
  projectId: scope.projectId,
  organizationId: scope.organizationId,
  restricted: false,
  createdBy: null,
  initiatedBy: "USER",
  workflowName: "ENTITY_CONVERSATION",
  status: "STARTED",
  createdAt: now,
  updatedAt: now,
});

beforeEach(() => {
  title = "Original conversation";
  version = 3;
  failRead = false;
  failWrite = false;
  failRefresh = false;
  requests = [];
  close = vi.fn();
  const item: OpenItem = {
    entityType: EntityType.AgentSession,
    entityId: sessionId,
    note: "Review after the release",
    pinned: true,
    position: "V",
    groupId,
    memberPosition: "V",
    goalTrackedWorkFilter: "ALL",
    goalCollapsed: false,
    revision: 1,
    lineage: [{ entityType: EntityType.Task, entityId: groupId }],
    presentation: {
      label: title,
      agentSessionType: AgentSessionType.Coding,
      conversationId,
      routeParams: { lineageKinds: "t" },
    },
    removedAt: null,
    updatedAt: now,
  };
  collection = {
    state: "PRESENT",
    revision: 1,
    items: [item],
    groups: [
      {
        groupId,
        name: "Release reviews",
        position: "V",
        collapsed: false,
        revision: 1,
        updatedAt: now,
      },
    ],
  };
  const transport = axios.create({
    adapter: async (config) => {
      const path = config.url ?? "";
      requests.push({ method: config.method, path, body: body(config) });
      const reject = (status: number) => {
        throw new AxiosError(
          "Request failed",
          "ERR_BAD_RESPONSE",
          config,
          undefined,
          {
            data: {
              code: status === 409 ? "VERSION_CONFLICT" : "REQUEST_FAILED",
            },
            status,
            statusText: "Error",
            headers: {},
            config,
          },
        );
      };
      let data: unknown;
      if (path.endsWith(`/conversations/${conversationId}`)) {
        if (config.method === "patch") {
          if (failWrite) {
            reject(500);
          }
          const submitted = body(config);
          if (submitted.expectedVersion !== version) {
            reject(409);
          }
          title = String(submitted.title);
          version++;
        } else if (failRead) {
          reject(500);
        }
        data = conversation();
      } else if (path.endsWith("/presentation-refresh")) {
        if (failRefresh) {
          reject(500);
        }
        collection = {
          ...collection,
          revision: collection.revision + 1,
          items: collection.items.map((row) => ({
            ...row,
            revision: row.revision + 1,
            presentation: { ...row.presentation, label: title },
          })),
        };
        data = {
          collectionRevision: collection.revision,
          items: collection.items,
          groups: [],
          deletedGroupIds: [],
          replayed: false,
        };
      } else if (path.endsWith("/open-items")) {
        data = collection;
      } else {
        throw new Error(`Unexpected request: ${path}`);
      }
      return {
        data: {
          success: true,
          data,
          message: "ok",
          timestamp: now,
          statusCode: 200,
        },
        status: 200,
        statusText: "OK",
        headers: new AxiosHeaders(),
        config,
      };
    },
  });
  registerApiRuntime(
    createApiRuntime({
      baseUrl: "/api/v1",
      transport: { axios: transport, request: vi.fn(), setAuthToken: vi.fn() },
    }),
  );
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(
    openItemsKeys.collection(scope),
    structuredClone(collection),
  );
});
afterEach(() => {
  cleanup();
  queryClient.clear();
});
const show = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <OpenItemSessionRenameDialog
        {...scope}
        sessionId={sessionId}
        conversationId={conversationId}
        onClose={close}
      />
    </QueryClientProvider>,
  );
const input = () => screen.getByTestId("session-rename-title");
const save = () => fireEvent.click(screen.getByTestId("session-rename-save"));
const edit = (value: string) =>
  fireEvent.change(input(), { target: { value } });
const loaded = () =>
  waitFor(() => expect(input()).toHaveValue("Original conversation"));

describe("session rename editor through generated clients and canonical collections", () => {
  it("reads only on editor open, validates limits, saves a versioned conversation and replaces the canonical row/search label while preserving organization", async () => {
    expect(requests).toEqual([]);
    show();
    await loaded();
    expect(requests.map((request) => request.method)).toEqual(["get"]);
    edit("Hi");
    expect(screen.getByTestId("session-rename-save")).toBeDisabled();
    edit("x".repeat(81));
    expect(screen.getByTestId("session-rename-save")).toBeDisabled();
    edit("Hey");
    expect(screen.getByTestId("session-rename-save")).toBeEnabled();
    edit("x".repeat(80));
    expect(screen.getByTestId("session-rename-save")).toBeEnabled();
    edit("New release review");
    const original = structuredClone(collection);
    save();
    save();
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(requests.filter((request) => request.method === "patch")).toEqual([
      expect.objectContaining({
        body: { expectedVersion: 3, title: "New release review" },
      }),
    ]);
    expect(
      queryClient.getQueryData(openItemsKeys.collection(scope)),
    ).toMatchObject({
      items: [
        {
          ...original.items[0],
          revision: 2,
          presentation: {
            ...original.items[0].presentation,
            label: "New release review",
          },
        },
      ],
      groups: original.groups,
    });
    expect(
      queryClient.getQueryData(
        conversationKeys.envelope("org", "project", conversationId),
      ),
    ).toMatchObject({ title: "New release review", version: 4 });
    const canonical = queryClient.getQueryData<OpenItemsPresentCollection>(
      openItemsKeys.collection(scope),
    );
    if (!canonical) {
      throw new Error("Canonical collection missing");
    }
    const projected = projectOpenItems(
      openItemsRows(canonical.items),
      "oldest",
      undefined,
      openItemsGroupRows(canonical.groups),
    );
    expect(
      filterProjectedOpenItems(projected, " release REVIEW "),
    ).toHaveLength(1);
    expect(
      filterProjectedOpenItems(projected, "Original conversation"),
    ).toHaveLength(0);

    expect(
      requests.some((request) => request.path.includes("agent-sessions")),
    ).toBe(false);
  });

  it("cancels without a write", async () => {
    show();
    await loaded();
    edit("Cancelled name");
    fireEvent.click(screen.getByTestId("session-rename-cancel"));
    expect(close).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
  });

  it("keeps the draft and old label after write failure, then retries", async () => {
    show();
    await loaded();
    failWrite = true;
    edit("My retained draft");
    save();
    await waitFor(() =>
      expect(screen.getByTestId("session-rename-error")).toBeInTheDocument(),
    );
    expect(input()).toHaveValue("My retained draft");
    expect(collection.items[0].presentation.label).toBe(
      "Original conversation",
    );
    failWrite = false;
    save();
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it("shows a concurrent title and requires explicit review before another versioned save", async () => {
    show();
    await loaded();
    edit("My deliberate title");
    title = "Someone else's title";
    version = 4;
    save();
    await waitFor(() =>
      expect(screen.getByTestId("session-rename-latest")).toBeInTheDocument(),
    );
    expect(input()).toHaveValue("My deliberate title");
    expect(title).toBe("Someone else's title");
    expect(
      requests.filter((request) => request.method === "patch"),
    ).toHaveLength(1);
    fireEvent.click(screen.getByTestId("session-rename-review"));
    await waitFor(() =>
      expect(screen.getByTestId("session-rename-save")).toBeEnabled(),
    );
    save();
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(
      requests
        .filter((request) => request.method === "patch")
        .map((request) => request.body.expectedVersion),
    ).toEqual([3, 4]);
  });

  it("retries only presentation refresh after the title saved", async () => {
    show();
    await loaded();
    failRefresh = true;
    edit("Saved conversation name");
    save();
    await waitFor(() =>
      expect(screen.getByTestId("session-rename-error")).toBeInTheDocument(),
    );
    expect(title).toBe("Saved conversation name");
    expect(collection.items[0].presentation.label).toBe(
      "Original conversation",
    );
    const key = requests.find((request) =>
      request.path.endsWith("presentation-refresh"),
    )!.body.idempotencyKey;
    failRefresh = false;
    save();
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(
      requests.filter((request) => request.method === "patch"),
    ).toHaveLength(1);
    expect(
      requests
        .filter((request) => request.path.endsWith("presentation-refresh"))
        .map((request) => request.body.idempotencyKey),
    ).toEqual([key, key]);
  });

  it("offers a fresh read after an editor read failure", async () => {
    failRead = true;
    show();
    await waitFor(() =>
      expect(screen.getByTestId("session-rename-retry-read")).toBeEnabled(),
    );
    failRead = false;
    fireEvent.click(screen.getByTestId("session-rename-retry-read"));
    await loaded();
    expect(requests).toHaveLength(2);
  });
});
