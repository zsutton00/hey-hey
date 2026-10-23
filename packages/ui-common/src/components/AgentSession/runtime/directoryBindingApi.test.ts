import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDirectoryBindingApi,
  LocalCliRequestError,
  LocalRunAttachmentOpenError,
  LocalRunAttachmentUploadError,
  LocalStagedBrowserTabOpenError,
  resolveLocalDirectoryRuntimeBaseUrl,
} from "./directoryBindingApi";

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("createDirectoryBindingApi", () => {
  const attachmentId = "f7a198de-03a6-47aa-b0bf-830cde418ddb";
  const attachmentResponse = (runId: string) => ({
    requestId: attachmentId,
    operation: "run.attachments.upload",
    status: "success",
    result: {
      runId,
      attachment: { attachmentId, fileName: "notes & plans.txt", sizeBytes: 4 },
    },
  });

  it("stages raw bytes without a Run identity", async () => {
    const file = new File(["test"], "notes & plans.txt");
    const payload = {
      ...attachmentResponse("unused"),
      operation: "run.attachments.stage",
      result: { attachment: attachmentResponse("unused").result.attachment },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createDirectoryBindingApi(
        "http://localhost:3847",
      ).uploadLocalStagedRunAttachment("machine & 1", file),
    ).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "http://localhost:3847/api/local/run-attachments/staging?machineId=machine+%26+1&fileName=notes+%26+plans.txt",
      {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/octet-stream" },
        body: file,
      },
    );
  });

  it.each(["FILE_TOO_LARGE", "INVALID_REQUEST", "MACHINE_NOT_BOUND"])(
    "preserves typed staging errors: %s",
    async (code) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              requestId: attachmentId,
              operation: "run.attachments.stage",
              status: "error",
              error: { code, message: "Rejected file" },
            }),
            { status: 400 },
          ),
        ),
      );
      await expect(
        createDirectoryBindingApi(
          "http://localhost:3847",
        ).uploadLocalStagedRunAttachment("machine", new File([], "a.txt")),
      ).rejects.toMatchObject({ code, message: "Rejected file" });
    },
  );

  it.each([
    { operation: "run.attachments.upload" },
    { requestId: "invalid" },
    {
      result: {
        attachment: {
          attachmentId: "invalid",
          fileName: "a.txt",
          sizeBytes: 1,
        },
      },
    },
    { result: { attachment: { attachmentId, fileName: "", sizeBytes: 1 } } },
  ])("rejects malformed staging envelopes", async (invalid) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          requestId: attachmentId,
          operation: "run.attachments.stage",
          status: "success",
          result: { attachment: attachmentResponse("run").result.attachment },
          ...invalid,
        }),
      ),
    );
    await expect(
      createDirectoryBindingApi(
        "http://localhost:3847",
      ).uploadLocalStagedRunAttachment("machine", new File([], "a.txt")),
    ).rejects.toBeInstanceOf(LocalRunAttachmentUploadError);
  });

  it("uploads raw file bytes with encoded Run and query values", async () => {
    const file = new File(["test"], "notes & plans.txt");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(attachmentResponse("run/1")));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createDirectoryBindingApi(
        "http://localhost:3849",
      ).uploadLocalRunAttachment("run/1", "machine & 1", file),
    ).resolves.toEqual(attachmentResponse("run/1"));
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3849/api/local/runs/run%2F1/attachments?machineId=machine+%26+1&fileName=notes+%26+plans.txt",
      {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/octet-stream" },
        body: file,
      },
    );
  });

  it.each(["FILE_TOO_LARGE", "RUN_NOT_FOUND", "INVALID_REQUEST"])(
    "preserves typed upload rejection %s",
    async (code) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              requestId: attachmentId,
              operation: "run.attachments.upload",
              status: "error",
              error: { code, message: "Rejected file" },
            }),
            { status: 413 },
          ),
        ),
      );
      await expect(
        createDirectoryBindingApi(
          "http://localhost:3847",
        ).uploadLocalRunAttachment(
          "run",
          "machine",
          new File(["data"], "file"),
        ),
      ).rejects.toMatchObject({
        name: "LocalRunAttachmentUploadError",
        code,
        message: "Rejected file",
      });
    },
  );

  it("rejects mismatched Run identity and malformed references", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(attachmentResponse("other-run"))),
    );
    await expect(
      createDirectoryBindingApi(
        "http://localhost:3847",
      ).uploadLocalRunAttachment("run", "machine", new File([], "file")),
    ).rejects.toBeInstanceOf(LocalRunAttachmentUploadError);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          ...attachmentResponse("run"),
          result: {
            runId: "run",
            attachment: {
              attachmentId: "invalid",
              fileName: "file",
              sizeBytes: 1,
            },
          },
        }),
      ),
    );
    await expect(
      createDirectoryBindingApi(
        "http://localhost:3847",
      ).uploadLocalRunAttachment("run", "machine", new File([], "file")),
    ).rejects.toBeInstanceOf(LocalRunAttachmentUploadError);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the repository-scoped picker with verified machine identity", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: "selected",
        machineId: "machine-1",
        repositoryPath: "/workspace/ui",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const api = createDirectoryBindingApi("http://localhost:3847");

    await expect(api.pickDirectory("machine-1")).resolves.toEqual({
      status: "selected",
      machineId: "machine-1",
      repositoryPath: "/workspace/ui",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3847/api/local/repos/pick-directory",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ machineId: "machine-1" }),
      }),
    );
  });

  it("returns the local CLI identity with its repository bindings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        machineId: "machine-mac",
        bindings: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const api = createDirectoryBindingApi("http://localhost:3847");

    await expect(api.listRepos()).resolves.toEqual({
      machineId: "machine-mac",
      bindings: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3847/api/local/repos",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("sends picker-proven machine identity with the exact-Service write", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        machineId: "machine-1",
        binding: {
          serviceId: "service-1",
          repositoryPath: "/workspace/ui",
          createdAt: "2026-08-25T00:00:00.000Z",
          updatedAt: "2026-08-25T00:00:00.000Z",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const api = createDirectoryBindingApi("http://localhost:3847");

    await api.setRepo("service-1", "machine-1", "/workspace/ui");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3847/api/local/repos/service-1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          machineId: "machine-1",
          repositoryPath: "/workspace/ui",
        }),
      }),
    );
  });

  it("reads one service-qualified changed file through the persisted-Run route", async () => {
    const runId = "44444444-4444-4444-8444-444444444444";
    const file = {
      serviceId: "55555555-5555-4555-8555-555555555555",
      repoPath: "/workspace/ui",
      filePath: "src/example.ts",
    };
    const detail = {
      ...file,
      status: "modify",
      diff: "@@ -1 +1 @@\n-before\n+after",
      preContent: "before",
      postContent: "after",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        requestId: "66666666-6666-4666-8666-666666666666",
        operation: "run.changed_files.detail",
        status: "success",
        result: { runId, file: detail },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const api = createDirectoryBindingApi("http://localhost:3847");

    await expect(
      api.readRunChangedFileDetail(runId, "machine-1", file),
    ).resolves.toMatchObject({ result: { runId, file: detail } });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3847/api/local/runs/${runId}/changed-files/detail`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ machineId: "machine-1", file }),
      }),
    );
  });

  it("preserves typed local detail errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            requestId: "66666666-6666-4666-8666-666666666666",
            operation: "run.changed_files.detail",
            status: "error",
            error: {
              code: "INVALID_FILE_MEMBERSHIP",
              message: "The selected file is outside canonical Run membership.",
            },
          }),
          { status: 422, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const api = createDirectoryBindingApi("http://localhost:3847");

    const error = await api
      .readRunChangedFileDetail(
        "44444444-4444-4444-8444-444444444444",
        "machine-1",
        {
          serviceId: "55555555-5555-4555-8555-555555555555",
          repoPath: "/workspace/ui",
          filePath: "src/example.ts",
        },
      )
      .catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(LocalCliRequestError);
    expect(error).toMatchObject({
      code: "INVALID_FILE_MEMBERSHIP",
      message: "The selected file is outside canonical Run membership.",
    });
  });

  it("rejects a malformed local detail response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          operation: "run.changed_files.detail",
          status: "success",
          result: { runId: "wrong-run", file: {} },
        }),
      ),
    );
    const api = createDirectoryBindingApi("http://localhost:3847");

    await expect(
      api.readRunChangedFileDetail(
        "44444444-4444-4444-8444-444444444444",
        "machine-1",
        {
          serviceId: "55555555-5555-4555-8555-555555555555",
          repoPath: "/workspace/ui",
          filePath: "src/example.ts",
        },
      ),
    ).rejects.toThrow("invalid changed-file detail");
  });

  it("reads the service-qualified inventory through the persisted-Run route", async () => {
    const runId = "44444444-4444-4444-8444-444444444444";
    const entries = [
      {
        serviceId: "55555555-5555-4555-8555-555555555555",
        repoPath: "/workspace/ui",
        filePath: "src/example.ts",
        status: "modify",
      },
      {
        serviceId: "77777777-7777-4777-8777-777777777777",
        repoPath: "/workspace/cli",
        filePath: "src/example.ts",
        status: "create",
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        requestId: "66666666-6666-4666-8666-666666666666",
        operation: "run.changed_files.inventory",
        status: "success",
        result: { runId, entries },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const api = createDirectoryBindingApi("http://localhost:3847");

    await expect(
      api.readRunChangedFilesInventory(runId, "machine-1"),
    ).resolves.toEqual({
      requestId: "66666666-6666-4666-8666-666666666666",
      operation: "run.changed_files.inventory",
      status: "success",
      result: { runId, entries },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3847/api/local/runs/${runId}/changed-files/inventory`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ machineId: "machine-1" }),
      }),
    );
  });

  it("preserves typed local inventory errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            requestId: "66666666-6666-4666-8666-666666666666",
            operation: "run.changed_files.inventory",
            status: "error",
            error: {
              code: "MACHINE_NOT_BOUND",
              message:
                "The requested machine does not match the locally paired CLI machine.",
            },
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const api = createDirectoryBindingApi("http://localhost:3847");

    const error = await api
      .readRunChangedFilesInventory(
        "44444444-4444-4444-8444-444444444444",
        "machine-1",
      )
      .catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(LocalCliRequestError);
    expect(error).toMatchObject({ code: "MACHINE_NOT_BOUND" });
  });

  it.each([
    { result: { runId: "wrong-run", entries: [] } },
    {
      result: {
        runId: "44444444-4444-4444-8444-444444444444",
        entries: [
          { repoPath: "/workspace/ui", filePath: "a.ts", status: "modify" },
        ],
      },
    },
    {
      result: {
        runId: "44444444-4444-4444-8444-444444444444",
        entries: [
          {
            serviceId: "55555555-5555-4555-8555-555555555555",
            repoPath: "/workspace/ui",
            filePath: "a.ts",
            status: "renamed",
          },
        ],
      },
    },
  ])("rejects a malformed local inventory response", async ({ result }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          requestId: "66666666-6666-4666-8666-666666666666",
          operation: "run.changed_files.inventory",
          status: "success",
          result,
        }),
      ),
    );
    const api = createDirectoryBindingApi("http://localhost:3847");

    await expect(
      api.readRunChangedFilesInventory(
        "44444444-4444-4444-8444-444444444444",
        "machine-1",
      ),
    ).rejects.toThrow("invalid changed-file inventory");
  });
});

describe("openRunAttachment", () => {
  const runId = "44444444-4444-4444-8444-444444444444";
  const attachmentId = "f7a198de-03a6-47aa-b0bf-830cde418ddb";
  const requestId = "66666666-6666-4666-8666-666666666666";
  const success = (action: string, overrides: object = {}) => ({
    requestId,
    operation: "run.attachments.open",
    status: "success",
    result: { runId, attachmentId, action, ...overrides },
  });
  const open = () =>
    createDirectoryBindingApi("http://localhost:3847").openRunAttachment(
      runId,
      attachmentId,
      "machine & 1",
      "notes & plans.png",
    );

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the Run's attachment open route with encoded query values", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(success("opened")));
    vi.stubGlobal("fetch", fetchMock);

    await expect(open()).resolves.toEqual(success("opened"));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `http://localhost:3847/api/local/runs/${runId}/attachments/${attachmentId}/open?machineId=machine+%26+1&fileName=notes+%26+plans.png`,
      { method: "POST", cache: "no-store" },
    );
  });

  it.each(["opened", "revealed"])("returns the %s outcome", async (action) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(success(action))),
    );

    await expect(open()).resolves.toMatchObject({ result: { action } });
  });

  it.each([
    ["ATTACHMENT_NOT_FOUND", 404],
    ["OPENER_UNAVAILABLE", 503],
    ["MACHINE_NOT_BOUND", 409],
  ])("preserves the typed %s failure", async (code, status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            requestId,
            operation: "run.attachments.open",
            status: "error",
            error: { code, message: "Cannot open." },
          }),
          { status, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const error = await open().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LocalRunAttachmentOpenError);
    expect(error).toMatchObject({ code, message: "Cannot open." });
  });

  it("reports a non-JSON reply as an untyped failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>", { status: 502 })),
    );

    const error = await open().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LocalRunAttachmentOpenError);
    expect(error).toMatchObject({ code: null });
  });

  it("lets a network failure surface unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(open()).rejects.toThrow("offline");
  });

  it.each([
    ["another Run", success("opened", { runId: "wrong-run" })],
    ["another attachment", success("opened", { attachmentId: "wrong" })],
    ["an unknown action", success("launched")],
  ])("rejects a success reply for %s", async (_name, payload) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(open()).rejects.toBeInstanceOf(LocalRunAttachmentOpenError);
  });
});

describe("openStagedBrowserTab", () => {
  const projectId = "55555555-5555-4555-8555-555555555555";
  const stagedTabId = "66666666-6666-4666-8666-666666666666";
  const open = () =>
    createDirectoryBindingApi("http://localhost:3847").openStagedBrowserTab({
      machineId: "machine-1",
      projectId,
    });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens a tab with no Run and returns its staged reference", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        stagedBrowserTab: { stagedTabId },
        url: "http://127.0.0.1:3847/browser/start",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(open()).resolves.toEqual({
      stagedBrowserTab: { stagedTabId },
      url: "http://127.0.0.1:3847/browser/start",
    });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "http://localhost:3847/api/local/browser/staged-tabs",
      {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ machineId: "machine-1", projectId }),
      },
    );
  });

  it.each([
    ["SHARED_BROWSER_DISABLED", 422],
    ["MACHINE_MISMATCH", 409],
    ["ORIGIN_NOT_ALLOWED", 403],
  ])("preserves the typed %s rejection", async (code, status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code, message: "Cannot open." }), {
          status,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const error = await open().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LocalStagedBrowserTabOpenError);
    expect(error).toMatchObject({ code, message: "Cannot open." });
  });

  it("rejects a success reply without a staged reference", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ url: "about:blank" })),
    );

    await expect(open()).rejects.toThrow("invalid Open browser result");
  });
});

describe("resolveLocalDirectoryRuntimeBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    ["http://migration-one.localhost:5173", 45321],
    ["http://migration-one.localhost:5173?server=45322", 45322],
  ])("routes runtime-configured CLI requests from %s", async (url, port) => {
    vi.stubGlobal("window", {
      location: new URL(url),
      __HEY_HEY_RUNTIME_CONFIG__: { localAgentPort: "45321" },
    });
    vi.stubEnv("VITE_LOCAL_AGENT_PORT", "3847");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ machineId: "machine-1", bindings: [] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await createDirectoryBindingApi(
      resolveLocalDirectoryRuntimeBaseUrl(),
    ).listRepos();

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:${port}/api/local/repos`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it.each([
    ["https://staging.heyhey.dev", "", 3849],
    ["https://heyhey.dev", "", 3847],
    ["http://localhost:5173", "3848", 3848],
    ["https://staging.heyhey.dev", "3850", 3850],
    ["https://staging.heyhey.dev?server=3851", "3850", 3851],
    ["https://staging.heyhey.dev?server=invalid", "invalid", 3849],
  ])(
    "routes %s with configured port %s to %s",
    async (url, configuredPort, port) => {
      vi.stubGlobal("window", { location: new URL(url) });
      vi.stubEnv("VITE_LOCAL_AGENT_PORT", configuredPort);
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ machineId: "machine-1", bindings: [] }),
        );
      vi.stubGlobal("fetch", fetchMock);

      await createDirectoryBindingApi(
        resolveLocalDirectoryRuntimeBaseUrl(),
      ).listRepos();

      expect(fetchMock).toHaveBeenCalledWith(
        `http://localhost:${port}/api/local/repos`,
        expect.objectContaining({ cache: "no-store" }),
      );
    },
  );
});
