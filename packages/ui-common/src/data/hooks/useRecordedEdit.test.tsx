import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiRuntime, registerApiRuntime } from "../../clients";
import { useRecordedEdit } from "./useRecordedEdit";

const scope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  agentSessionId: "33333333-3333-4333-8333-333333333333",
};
const serviceId = "55555555-5555-4555-8555-555555555555";
const edit = {
  path: "src/page.ts",
  turnId: "turn-1",
  occurredAt: "2026-11-13T12:00:00Z",
  beforeObjectId: "a".repeat(40),
  afterObjectId: "b".repeat(40),
  beforeRanges: [{ startLine: 2, endLine: 4 }],
  afterRanges: [{ startLine: 2, endLine: 5 }],
  approximate: false,
  versionsRecorded: true,
};
const params = {
  ...scope,
  runId: scope.agentSessionId,
  serviceId,
  edit,
  open: true,
};

const serveSession = (machineId: string) => [
  http.post("*/agent-sessions/current-state:batch", () =>
    HttpResponse.json({ data: { items: [] } }),
  ),
  http.get("*/agent-sessions/:agentSessionId", () =>
    HttpResponse.json({
      success: true,
      message: "ok",
      timestamp: "2026-11-13T12:00:00.000Z",
      statusCode: 200,
      data: {
        id: scope.agentSessionId,
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        machineId,
        title: "History session",
      },
    }),
  ),
];

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

describe("useRecordedEdit", () => {
  beforeEach(() => {
    // A real HTTP transport, so MSW is the only stand-in.
    const http = axios.create({ baseURL: "http://localhost/api/v1" });
    registerApiRuntime(
      createApiRuntime({
        baseUrl: "http://localhost/api/v1",
        transport: {
          axios: http,
          request: (config) => http.request(config),
          setAuthToken: vi.fn(),
        },
      }),
    );
  });

  it("reads the stored versions from the CLI on this computer when it ran the session", async () => {
    let requestBody: unknown = null;
    globalThis.mswServer.use(
      ...serveSession("machine-1"),
      http.get("http://localhost:3847/api/local/repos", () =>
        HttpResponse.json({ machineId: "machine-1", bindings: [] }),
      ),
      http.post(
        "http://localhost:3847/api/local/runs/:runId/recorded-edits/read",
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json({
            requestId: "66666666-6666-4666-8666-666666666666",
            operation: "run.recorded_edit.read",
            status: "success",
            result: {
              runId: params.runId,
              file: {
                serviceId,
                repoPath: "/workspace/service",
                filePath: edit.path,
                status: "modify",
                diff: "",
                preContent: "stored before\n",
                postContent: "stored after\n",
              },
            },
          });
        },
      ),
    );

    const { result } = renderHook(() => useRecordedEdit(params), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.file).toMatchObject({
      preContent: "stored before\n",
      postContent: "stored after\n",
    });
    expect(requestBody).toEqual({ machineId: "machine-1", serviceId, edit });
  });

  it("shows the edit as unavailable when the machine that ran the session is unreachable", async () => {
    globalThis.mswServer.use(
      ...serveSession("machine-offline"),
      http.get("http://localhost:3847/api/local/repos", () =>
        HttpResponse.error(),
      ),
    );

    const { result } = renderHook(() => useRecordedEdit(params), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.file).toBeNull();
  });
});
