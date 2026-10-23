/** @vitest-environment node */

import { EventEmitter } from "node:events";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CodexSdkClient,
  CodexCompactTimeoutError,
  CodexNoContextSnapshotError,
  type CodexSdkEvent,
  type CodexSdkServerRequest,
} from "../CodexSdkClient";

// Allow spy-based arg verification in the "no-resume args" test below.
// All other tests go through the real spawn via mockImplementation(actual.spawn).
vi.mock("node:child_process", async (importActual) => {
  const actual = await importActual<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn().mockImplementation(actual.spawn) };
});

describe("CodexSdkClient", () => {
  const tempDirs: string[] = [];

  const createMockScript = (source: string): string => {
    const directory = mkdtempSync(join(tmpdir(), "ui-common-codex-sdk-"));
    tempDirs.push(directory);

    const scriptPath = join(directory, "mock-codex.mjs");
    // Wait for the client's initialized acknowledgement rather than racing a
    // timer against its handshake. Keep stdin open until disconnect owns exit.
    const wrapped = [
      `process.stdout.write(JSON.stringify({ id: 1, result: {} }) + "\\n");`,
      "let handshake = ''; let initialized = false;",
      "process.stdin.on('data', chunk => {",
      "handshake += chunk;",
      'if (initialized || !handshake.includes(\'"method":"initialized"\')) return;',
      "initialized = true; setImmediate(() => {",
      source,
      "}); });",
      "process.stdin.on('end', () => process.exit(0));",
    ].join("\n");
    writeFileSync(scriptPath, `#!/usr/bin/env node\n${wrapped}`, "utf8");
    chmodSync(scriptPath, 0o755);
    return scriptPath;
  };

  it.each(["start", "resume"] as const)(
    "sends attachment contents and unchanged text on %s",
    async (mode) => {
      const directory = mkdtempSync(join(tmpdir(), "codex-attachment-"));
      tempDirs.push(directory);
      const recordPath = join(directory, "request.json");
      const source = [
        "(async () => {",
        'const { createInterface } = await import("node:readline");',
        'const { writeFileSync } = await import("node:fs");',
        'createInterface({ input: process.stdin }).on("line", line => {',
        'const frame = JSON.parse(line); if (frame.method !== "turn/start") return;',
        "writeFileSync(" +
          JSON.stringify(recordPath) +
          ", JSON.stringify(frame.params));",
        'process.stdout.write(JSON.stringify({ method: "turn/started", params: { threadId: "attachment-thread", turn: { id: "attachment-turn" } } }) + "\\n");',
        'process.stdout.write(JSON.stringify({ method: "turn/completed", params: { threadId: "attachment-thread", turn: { id: "attachment-turn" } } }) + "\\n");',
        "});",
        'process.stdout.write(JSON.stringify({ method: "thread/started", params: { thread: { id: "attachment-thread" } } }) + "\\n");',
        "})();",
      ].join("\n");
      const client = new CodexSdkClient();
      client.setCommand(createMockScript(source));
      const config = {
        prompt: "  read these\n",
        cwd: process.cwd(),
        attachments: [
          {
            kind: "text" as const,
            fileName: "notes.md",
            text: "  file contents\n",
          },
          {
            kind: "image" as const,
            fileName: "image.png",
            mediaType: "image/png" as const,
            data: "aW1hZ2U=",
          },
        ],
      };
      try {
        if (mode === "start") await client.startSession(config);
        else await client.resumeSession("attachment-thread", config);
        expect(JSON.parse(readFileSync(recordPath, "utf8")).input).toEqual([
          { type: "text", text: "  read these\n", text_elements: [] },
          {
            type: "text",
            text: "File: notes.md\n  file contents\n",
            text_elements: [],
          },
          { type: "image", url: "data:image/png;base64,aW1hZ2U=" },
        ]);
      } finally {
        await client.disconnect();
      }
    }
  );

  // Push the initialize handshake Response (id:1) onto a fake process's stdout.
  const emitInitializeResponse = (fakeStdout: Readable): void => {
    fakeStdout.push(`${JSON.stringify({ id: 1, result: {} })}\n`);
  };

  // Handshake frames the client writes to stdin before the real request — not
  // interesting to the per-test stdin assertions, so they're filtered out.
  const HANDSHAKE_METHODS = new Set(["initialize", "initialized"]);
  const parseClientFrames = (chunks: string[]): Record<string, unknown>[] =>
    chunks
      .join("")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((frame) => !HANDSHAKE_METHODS.has(frame["method"] as string));

  afterEach(() => {
    vi.mocked(spawn).mockClear();

    for (const directory of tempDirs.splice(0, tempDirs.length)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("can be instantiated", () => {
    const client = new CodexSdkClient();
    expect(client.getSessionId()).toBeNull();
  });

  it("captures session_id from thread/started and resolves on turn/completed", async () => {
    const scriptPath = createMockScript(`
process.stdout.write(JSON.stringify({ method: "thread/started", params: { thread: { id: "codex-sess-1" } } }) + "\\n");
process.stdout.write(JSON.stringify({ method: "turn/started", params: { threadId: "codex-sess-1", turn: { id: "root-turn-1" } } }) + "\\n");
process.stdout.write(JSON.stringify({ method: "item/agentMessage/delta", params: { threadId: "codex-sess-1", turnId: "root-turn-1", delta: "Working" } }) + "\\n");
process.stdout.write(JSON.stringify({ method: "turn/completed", params: { threadId: "codex-sess-1", turn: { id: "root-turn-1" } } }) + "\\n");
`);

    const client = new CodexSdkClient();
    client.setCommand(scriptPath);

    const events: CodexSdkEvent[] = [];
    client.onEvent((event) => events.push(event));

    await client.startSession({
      prompt: "do something",
      cwd: process.cwd(),
      toolExecutionHooks: {
        command: "fixture-capture-hook",
        environment: {
          HEY_HEY_CAPTURE_URL: "http://127.0.0.1:12345/",
          HEY_HEY_CAPTURE_TOKEN: "fixture-token",
        },
      },
    });
    expect(vi.mocked(spawn)).toHaveBeenCalledWith(
      process.execPath,
      [scriptPath],
      expect.objectContaining({
        env: expect.objectContaining({
          HEY_HEY_CAPTURE_URL: "http://127.0.0.1:12345/",
          HEY_HEY_CAPTURE_TOKEN: "fixture-token",
        }),
      })
    );

    expect(client.getSessionId()).toBe("codex-sess-1");
    expect(events.some((e) => e.method === "thread/started")).toBe(true);
    expect(events.some((e) => e.method === "turn/started")).toBe(true);
    expect(events.some((e) => e.method === "item/agentMessage/delta")).toBe(
      true
    );
    expect(events.some((e) => e.method === "turn/completed")).toBe(true);

    await client.disconnect();
  });

  it("only captures session_id from thread/started, not from other notifications", async () => {
    const scriptPath = createMockScript(`
// turn/started also carries a thread object but identity must come strictly from thread/started
process.stdout.write(JSON.stringify({ method: "turn/started", params: { thread: { id: "wrong-id" } } }) + "\\n");
process.stdout.write(JSON.stringify({ method: "thread/started", params: { thread: { id: "correct-id" } } }) + "\\n");
process.stdout.write(JSON.stringify({ method: "turn/started", params: { threadId: "correct-id", turn: { id: "root-turn" } } }) + "\\n");
process.stdout.write(JSON.stringify({ method: "turn/completed", params: { threadId: "correct-id", turn: { id: "root-turn" } } }) + "\\n");
`);

    const client = new CodexSdkClient();
    client.setCommand(scriptPath);

    await client.startSession({ prompt: "start fresh", cwd: process.cwd() });

    expect(client.getSessionId()).toBe("correct-id");

    await client.disconnect();
  });

  it("routes ServerRequests (with id) to onServerRequest, not onEvent", async () => {
    const scriptPath = createMockScript(`
process.stdout.write(JSON.stringify({ method: "thread/started", params: { thread: { id: "codex-sess-req" } } }) + "\\n");
process.stdout.write(JSON.stringify({ method: "turn/started", params: { threadId: "codex-sess-req", turn: { id: "root-turn" } } }) + "\\n");
// ServerRequest carries an id field
process.stdout.write(JSON.stringify({ id: 1, method: "item/commandExecution/requestApproval", params: { command: ["ls"] } }) + "\\n");
process.stdout.write(JSON.stringify({ method: "turn/completed", params: { threadId: "codex-sess-req", turn: { id: "root-turn" } } }) + "\\n");
`);

    const client = new CodexSdkClient();
    client.setCommand(scriptPath);

    const events: CodexSdkEvent[] = [];
    const serverRequests: CodexSdkServerRequest[] = [];
    client.onEvent((event) => events.push(event));
    client.onServerRequest((req) => serverRequests.push(req));

    await client.startSession({ prompt: "request test", cwd: process.cwd() });

    expect(serverRequests).toHaveLength(1);
    expect(serverRequests[0]!.id).toBe(1);
    expect(serverRequests[0]!.method).toBe(
      "item/commandExecution/requestApproval"
    );
    // ServerRequest must NOT appear in the notification stream
    expect(
      events.every((e) => e.method !== "item/commandExecution/requestApproval")
    ).toBe(true);

    await client.disconnect();
  });

  it("drops Response messages (id + result, no method) without routing to serverRequestHandler", async () => {
    const scriptPath = createMockScript(`
	process.stdout.write(JSON.stringify({ method: "thread/started", params: { thread: { id: "codex-sess-resp" } } }) + "\\n");
	process.stdout.write(JSON.stringify({ method: "turn/started", params: { threadId: "codex-sess-resp", turn: { id: "root-turn" } } }) + "\\n");
	// Response from server — correlation reply to a ClientRequest
	process.stdout.write(JSON.stringify({ id: 2, result: { status: "acknowledged" } }) + "\\n");
	process.stdout.write(JSON.stringify({ method: "turn/completed", params: { threadId: "codex-sess-resp", turn: { id: "root-turn" } } }) + "\\n");
`);

    const client = new CodexSdkClient();
    client.setCommand(scriptPath);

    const events: CodexSdkEvent[] = [];
    const serverRequests: CodexSdkServerRequest[] = [];
    client.onEvent((event) => events.push(event));
    client.onServerRequest((req) => serverRequests.push(req));

    await client.startSession({ prompt: "response test", cwd: process.cwd() });

    // Response must NOT be routed to serverRequestHandler
    expect(serverRequests).toHaveLength(0);
    // Response must NOT appear in the notification stream
    expect(events.every((e) => e.method !== "result")).toBe(true);

    await client.disconnect();
  });

  it("drops uncorrelated Error messages without routing to serverRequestHandler", async () => {
    const scriptPath = createMockScript(`
	process.stdout.write(JSON.stringify({ method: "thread/started", params: { thread: { id: "codex-sess-err" } } }) + "\\n");
	process.stdout.write(JSON.stringify({ method: "turn/started", params: { threadId: "codex-sess-err", turn: { id: "root-turn" } } }) + "\\n");
	// Error from server — correlation reply to a ClientRequest
	process.stdout.write(JSON.stringify({ id: 99, error: { code: -1, message: "test error" } }) + "\\n");
	process.stdout.write(JSON.stringify({ method: "turn/completed", params: { threadId: "codex-sess-err", turn: { id: "root-turn" } } }) + "\\n");
`);

    const client = new CodexSdkClient();
    client.setCommand(scriptPath);

    const events: CodexSdkEvent[] = [];
    const serverRequests: CodexSdkServerRequest[] = [];
    client.onEvent((event) => events.push(event));
    client.onServerRequest((req) => serverRequests.push(req));

    await client.startSession({ prompt: "error test", cwd: process.cwd() });

    // Error must NOT be routed to serverRequestHandler
    expect(serverRequests).toHaveLength(0);
    // Error must NOT appear in the notification stream
    expect(events.every((e) => e.method !== "error")).toBe(true);

    await client.disconnect();
  });

  it("passes app-server args to codex (no prompt in CLI args)", () => {
    const fakeStdout = new Readable({ read() {} });
    const fakeStderr = new Readable({ read() {} });
    const fakeStdin = new Writable({
      write(_c, _e, cb) {
        cb();
      },
    });
    const fakeProc = Object.assign(new EventEmitter(), {
      stdout: fakeStdout,
      stderr: fakeStderr,
      stdin: fakeStdin,
      pid: 999,
      kill: vi.fn(),
    }) as unknown as ReturnType<typeof spawn>;

    vi.mocked(spawn).mockReturnValueOnce(fakeProc);

    try {
      const client = new CodexSdkClient();
      // No setCommand() — spawnProcess builds args for app-server
      const startPromise = client.startSession({
        prompt: "start fresh",
        cwd: "/tmp",
      });
      startPromise.catch(() => {});

      const codexCall = vi
        .mocked(spawn)
        .mock.calls.find((c) => c[0] === "codex");
      expect(codexCall).toBeDefined();
      const [, args] = codexCall!;
      expect(args).toEqual(["app-server"]);
    } finally {
      fakeProc.emit("exit", 1);
    }
  });

  it("writes thread/start, then turn/start with structured Skill and text input", async () => {
    const fakeStdout = new Readable({ read() {} });
    const fakeStderr = new Readable({ read() {} });
    const stdinChunks: string[] = [];
    const fakeStdin = new Writable({
      write(chunk: Buffer | string, _enc, cb) {
        stdinChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
        cb();
      },
    });
    const fakeProc = Object.assign(new EventEmitter(), {
      stdout: fakeStdout,
      stderr: fakeStderr,
      stdin: fakeStdin,
      pid: 998,
      kill: vi.fn(),
    }) as unknown as ReturnType<typeof spawn>;

    vi.mocked(spawn).mockReturnValueOnce(fakeProc);

    const client = new CodexSdkClient();
    const startPromise = client.startSession({
      prompt: "hello prompt",
      baseInstructions: "Hey Hey platform prompt",
      structuredInput: [
        { text: "stable prefix", cacheBreakpoint: true },
        { text: "dynamic context", cacheBreakpoint: false },
      ],
      cwd: "/work/dir",
      skill: {
        type: "skill",
        name: "my-skill",
        path: "/work/dir/.codex/skills/my-skill/SKILL.md",
      },
      serviceTier: "priority",
      extraWritableDirs: ["/work/other", "/work/other", " "],
      config: {
        mcp_servers: {
          "heyhey-submission-tools": {
            url: "http://127.0.0.1:3847/mcp/submission-tools/token-1",
          },
        },
        sandbox_workspace_write: {
          writable_roots: ["/configured/root"],
        },
      },
    });
    startPromise.catch(() => {});

    // Answer the initialize handshake first; thread/start is written once it
    // resolves, before any thread/started arrives.
    emitInitializeResponse(fakeStdout);
    await new Promise((r) => setImmediate(r));

    fakeStdout.push(
      `${JSON.stringify({
        method: "thread/started",
        params: { thread: { id: "thr-42" } },
      })}\n`
    );

    // Give the readline 'line' event a tick to fire so turn/start is written.
    await new Promise((r) => setImmediate(r));

    fakeStdout.push(
      `${JSON.stringify({
        method: "turn/started",
        params: { threadId: "thr-42", turn: { id: "root-turn" } },
      })}\n`
    );
    fakeStdout.push(
      `${JSON.stringify({
        method: "turn/completed",
        params: { threadId: "thr-42", turn: { id: "root-turn" } },
      })}\n`
    );

    await startPromise;

    const frames = parseClientFrames(stdinChunks);

    expect(frames).toHaveLength(2);

    expect(frames[0]).toMatchObject({
      method: "thread/start",
      params: {
        cwd: "/work/dir",
        baseInstructions: "Hey Hey platform prompt",
        serviceTier: "priority",
        config: {
          mcp_servers: {
            "heyhey-submission-tools": {
              url: "http://127.0.0.1:3847/mcp/submission-tools/token-1",
            },
          },
          sandbox_workspace_write: {
            writable_roots: ["/configured/root", "/work/other"],
          },
        },
      },
    });
    expect(typeof frames[0]!.id).toBe("number");

    expect(frames[1]).toMatchObject({
      method: "turn/start",
      params: {
        threadId: "thr-42",
        input: [
          {
            type: "skill",
            name: "my-skill",
            path: "/work/dir/.codex/skills/my-skill/SKILL.md",
          },
          { type: "text", text: "stable prefix", text_elements: [] },
          { type: "text", text: "dynamic context", text_elements: [] },
        ],
      },
    });
    expect(typeof frames[1]!.id).toBe("number");
    expect(frames[0]!.id).not.toBe(frames[1]!.id);

    expect(client.getSessionId()).toBe("thr-42");

    fakeProc.emit("exit", 0);
  });

  it("resumeSession writes thread/resume with threadId, then turn/start with the prompt", async () => {
    const fakeStdout = new Readable({ read() {} });
    const fakeStderr = new Readable({ read() {} });
    const stdinChunks: string[] = [];
    const fakeStdin = new Writable({
      write(chunk: Buffer | string, _enc, cb) {
        stdinChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
        cb();
      },
    });
    const fakeProc = Object.assign(new EventEmitter(), {
      stdout: fakeStdout,
      stderr: fakeStderr,
      stdin: fakeStdin,
      pid: 997,
      kill: vi.fn(),
    }) as unknown as ReturnType<typeof spawn>;

    vi.mocked(spawn).mockReturnValueOnce(fakeProc);

    const client = new CodexSdkClient();
    const resumePromise = client.resumeSession("thr-existing", {
      prompt: "next turn",
      cwd: "/work/dir",
      serviceTier: "default",
      extraWritableDirs: ["/work/resume-other"],
      config: {
        mcp_servers: {
          "heyhey-submission-tools": {
            url: "http://127.0.0.1:3847/mcp/submission-tools/token-2",
          },
        },
      },
    });
    resumePromise.catch(() => {});

    emitInitializeResponse(fakeStdout);
    await new Promise((r) => setImmediate(r));

    fakeStdout.push(
      `${JSON.stringify({
        method: "thread/started",
        params: { thread: { id: "thr-existing" } },
      })}\n`
    );

    await new Promise((r) => setImmediate(r));

    fakeStdout.push(
      `${JSON.stringify({
        method: "turn/started",
        params: { threadId: "thr-existing", turn: { id: "root-turn" } },
      })}\n`
    );
    fakeStdout.push(
      `${JSON.stringify({
        method: "turn/completed",
        params: { threadId: "thr-existing", turn: { id: "root-turn" } },
      })}\n`
    );

    await resumePromise;

    const frames = parseClientFrames(stdinChunks);

    expect(frames).toHaveLength(2);

    expect(frames[0]).toMatchObject({
      method: "thread/resume",
      params: {
        threadId: "thr-existing",
        serviceTier: "default",
        config: {
          mcp_servers: {
            "heyhey-submission-tools": {
              url: "http://127.0.0.1:3847/mcp/submission-tools/token-2",
            },
          },
          sandbox_workspace_write: {
            writable_roots: ["/work/resume-other"],
          },
        },
      },
    });
    expect(typeof frames[0]!.id).toBe("number");

    expect(frames[1]).toMatchObject({
      method: "turn/start",
      params: {
        threadId: "thr-existing",
        input: [{ type: "text", text: "next turn", text_elements: [] }],
      },
    });
    expect(typeof frames[1]!.id).toBe("number");
    expect(frames[0]!.id).not.toBe(frames[1]!.id);

    expect(client.getSessionId()).toBe("thr-existing");

    fakeProc.emit("exit", 0);
  });

  it.each(["start", "resume"] as const)(
    "keeps %s pending through child completion and child failure",
    async (mode) => {
      const fakeStdout = new Readable({ read() {} });
      const fakeStderr = new Readable({ read() {} });
      const fakeStdin = new Writable({
        write(_chunk: Buffer | string, _enc, callback) {
          callback();
        },
      });
      const fakeProc = Object.assign(new EventEmitter(), {
        stdout: fakeStdout,
        stderr: fakeStderr,
        stdin: fakeStdin,
        pid: mode === "start" ? 9961 : 9962,
        kill: vi.fn(),
      }) as unknown as ReturnType<typeof spawn>;
      vi.mocked(spawn).mockReturnValueOnce(fakeProc);

      const client = new CodexSdkClient();
      const events: CodexSdkEvent[] = [];
      client.onEvent((event) => events.push(event));
      const resultPromise =
        mode === "start"
          ? client.startSession({ prompt: "research", cwd: "/work/dir" })
          : client.resumeSession("root-thread", {
              prompt: "continue research",
              cwd: "/work/dir",
            });
      let settled = false;
      void resultPromise.finally(() => {
        settled = true;
      });

      emitInitializeResponse(fakeStdout);
      await new Promise((resolve) => setImmediate(resolve));
      fakeStdout.push(
        `${JSON.stringify({
          method: "thread/started",
          params: { thread: { id: "root-thread" } },
        })}\n`
      );
      fakeStdout.push(
        `${JSON.stringify({
          method: "turn/started",
          params: { threadId: "root-thread", turn: { id: "root-turn" } },
        })}\n`
      );
      fakeStdout.push(
        `${JSON.stringify({
          method: "item/completed",
          params: {
            threadId: "child-thread",
            turnId: "child-turn",
            item: {
              id: "child-message",
              type: "agentMessage",
              text: "Child finding",
            },
          },
        })}\n`
      );
      fakeStdout.push(
        `${JSON.stringify({
          method: "error",
          params: {
            threadId: "child-thread",
            turnId: "child-turn",
            error: { message: "Child failed" },
            willRetry: false,
          },
        })}\n`
      );
      fakeStdout.push(
        `${JSON.stringify({
          method: "turn/completed",
          params: {
            threadId: "child-thread",
            turn: { id: "child-turn", status: "failed" },
          },
        })}\n`
      );
      await new Promise((resolve) => setImmediate(resolve));

      expect(settled).toBe(false);
      expect(events.map((event) => event.method)).toContain("turn/completed");
      expect(client.getSessionId()).toBe("root-thread");

      fakeStdout.push(
        `${JSON.stringify({
          method: "turn/completed",
          params: {
            threadId: "root-thread",
            turn: { id: "root-turn", status: "completed" },
          },
        })}\n`
      );
      await resultPromise;
      expect(settled).toBe(true);

      fakeProc.emit("exit", 0);
    }
  );

  it("rejects a resumed request only when the failure matches its root identity", async () => {
    const fakeStdout = new Readable({ read() {} });
    const fakeStderr = new Readable({ read() {} });
    const fakeStdin = new Writable({
      write(_chunk: Buffer | string, _enc, callback) {
        callback();
      },
    });
    const fakeProc = Object.assign(new EventEmitter(), {
      stdout: fakeStdout,
      stderr: fakeStderr,
      stdin: fakeStdin,
      pid: 9963,
      kill: vi.fn(),
    }) as unknown as ReturnType<typeof spawn>;
    vi.mocked(spawn).mockReturnValueOnce(fakeProc);

    const client = new CodexSdkClient();
    const resultPromise = client.resumeSession("root-thread", {
      prompt: "continue research",
      cwd: "/work/dir",
    });

    emitInitializeResponse(fakeStdout);
    await new Promise((resolve) => setImmediate(resolve));
    fakeStdout.push(
      `${JSON.stringify({
        method: "turn/started",
        params: { threadId: "root-thread", turnId: "root-turn" },
      })}\n`
    );
    fakeStdout.push(
      `${JSON.stringify({
        method: "error",
        params: {
          threadId: "root-thread",
          turnId: "root-turn",
          error: { message: "Root failed" },
          willRetry: false,
        },
      })}\n`
    );

    await expect(resultPromise).rejects.toThrow("Root failed");
    fakeProc.emit("exit", 0);
  });

  it("getContextUsageByResume writes thread/resume without starting a turn", async () => {
    const fakeStdout = new Readable({ read() {} });
    const fakeStderr = new Readable({ read() {} });
    const stdinChunks: string[] = [];
    const fakeStdin = new Writable({
      write(chunk: Buffer | string, _enc, cb) {
        stdinChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
        cb();
      },
    });
    const fakeProc = Object.assign(new EventEmitter(), {
      stdout: fakeStdout,
      stderr: fakeStderr,
      stdin: fakeStdin,
      pid: 996,
      kill: vi.fn(),
    }) as unknown as ReturnType<typeof spawn>;

    vi.mocked(spawn).mockReturnValueOnce(fakeProc);

    const client = new CodexSdkClient();
    const contextPromise = client.getContextUsageByResume("thr-context", {
      prompt: "",
      cwd: "/work/dir",
      extraWritableDirs: ["/work/context-other"],
      config: {
        mcp_servers: {
          "heyhey-platform": {
            url: "http://127.0.0.1:3847/mcp/platform/token-1",
          },
        },
      },
    });

    emitInitializeResponse(fakeStdout);
    await new Promise((r) => setImmediate(r));

    fakeStdout.push(
      `${JSON.stringify({
        id: 2,
        result: { thread: { id: "thr-context" } },
      })}\n`
    );
    await new Promise((r) => setImmediate(r));

    fakeStdout.push(
      `${JSON.stringify({
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thr-context",
          turnId: "turn-1",
          tokenUsage: {
            total: {
              totalTokens: 75_000,
              inputTokens: 50_000,
              cachedInputTokens: 15_000,
              outputTokens: 8_000,
              reasoningOutputTokens: 2_000,
            },
            last: {
              totalTokens: 5_000,
              inputTokens: 3_000,
              cachedInputTokens: 1_000,
              outputTokens: 800,
              reasoningOutputTokens: 200,
            },
            modelContextWindow: 300_000,
          },
        },
      })}\n`
    );

    const contextData = await contextPromise;
    const frames = parseClientFrames(stdinChunks);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      method: "thread/resume",
      params: {
        threadId: "thr-context",
        config: {
          mcp_servers: {
            "heyhey-platform": {
              url: "http://127.0.0.1:3847/mcp/platform/token-1",
            },
          },
          sandbox_workspace_write: {
            writable_roots: ["/work/context-other"],
          },
        },
      },
    });
    expect(contextData.totalTokens).toBe(5_000);
    expect(contextData.maxTokens).toBe(300_000);
    expect(contextData.percentage).toBeCloseTo((5_000 / 300_000) * 100, 5);
    expect(client.getSessionId()).toBe("thr-context");

    fakeProc.emit("exit", 0);
  });

  it("owns the resumed root turn from the correlated turn/start response", async () => {
    const fakeStdout = new Readable({ read() {} });
    const fakeStderr = new Readable({ read() {} });
    const stdinChunks: string[] = [];
    const fakeStdin = new Writable({
      write(chunk: Buffer | string, _enc, cb) {
        stdinChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
        cb();
      },
    });
    const fakeProc = Object.assign(new EventEmitter(), {
      stdout: fakeStdout,
      stderr: fakeStderr,
      stdin: fakeStdin,
      pid: 995,
      kill: vi.fn(),
    }) as unknown as ReturnType<typeof spawn>;

    vi.mocked(spawn).mockReturnValueOnce(fakeProc);

    const client = new CodexSdkClient();
    const resumePromise = client.resumeSession("thr-existing", {
      prompt: "response-based resume",
      cwd: "/work/dir",
    });
    resumePromise.catch(() => {});

    emitInitializeResponse(fakeStdout);
    await new Promise((r) => setImmediate(r));

    fakeStdout.push(
      `${JSON.stringify({
        id: 2,
        result: { thread: { id: "thr-existing" } },
      })}\n`
    );

    await new Promise((r) => setImmediate(r));

    fakeStdout.push(
      `${JSON.stringify({
        method: "thread/status/changed",
        params: { threadId: "thr-existing", turnId: "previous-turn" },
      })}\n`
    );
    expect(client.getRootTurnIdentity()).toBeNull();

    fakeStdout.push(
      `${JSON.stringify({
        id: 3,
        result: { turn: { id: "root-turn" } },
      })}\n`
    );
    await new Promise((r) => setImmediate(r));
    expect(client.getRootTurnIdentity()).toEqual({
      threadId: "thr-existing",
      turnId: "root-turn",
    });

    fakeStdout.push(
      `${JSON.stringify({
        method: "turn/started",
        params: { threadId: "thr-existing", turn: { id: "root-turn" } },
      })}\n`
    );
    fakeStdout.push(
      `${JSON.stringify({
        method: "turn/completed",
        params: { threadId: "thr-existing", turn: { id: "root-turn" } },
      })}\n`
    );

    await resumePromise;

    const frames = parseClientFrames(stdinChunks);

    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      method: "thread/resume",
      params: { threadId: "thr-existing" },
    });
    expect(frames[1]).toMatchObject({
      method: "turn/start",
      params: {
        threadId: "thr-existing",
        input: [
          { type: "text", text: "response-based resume", text_elements: [] },
        ],
      },
    });
    expect(client.getSessionId()).toBe("thr-existing");
    expect(client.getRootTurnIdentity()).toEqual({
      threadId: "thr-existing",
      turnId: "root-turn",
    });

    fakeProc.emit("exit", 0);
  });

  it("startSession sends thread/start, resumeSession sends thread/resume (not the other way round)", async () => {
    const makeFakeProc = (chunks: string[]) => {
      const stdout = new Readable({ read() {} });
      const stderr = new Readable({ read() {} });
      const stdin = new Writable({
        write(chunk: Buffer | string, _enc, cb) {
          chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
          cb();
        },
      });
      const proc = Object.assign(new EventEmitter(), {
        stdout,
        stderr,
        stdin,
        pid: 996,
        kill: vi.fn(),
      }) as unknown as ReturnType<typeof spawn>;
      return { proc, stdout };
    };

    const driveToCompletion = async (
      stdout: Readable,
      sessionId: string,
      run: () => Promise<void>
    ) => {
      const result = run();
      result.catch(() => {});
      emitInitializeResponse(stdout);
      await new Promise((r) => setImmediate(r));
      stdout.push(
        `${JSON.stringify({
          method: "thread/started",
          params: { thread: { id: sessionId } },
        })}\n`
      );
      await new Promise((r) => setImmediate(r));
      stdout.push(
        `${JSON.stringify({
          method: "turn/started",
          params: { threadId: sessionId, turn: { id: "root-turn" } },
        })}\n`
      );
      stdout.push(
        `${JSON.stringify({
          method: "turn/completed",
          params: { threadId: sessionId, turn: { id: "root-turn" } },
        })}\n`
      );
      await result;
    };

    const freshChunks: string[] = [];
    const { proc: freshProc, stdout: freshStdout } = makeFakeProc(freshChunks);
    vi.mocked(spawn).mockReturnValueOnce(freshProc);

    const freshClient = new CodexSdkClient();
    await driveToCompletion(freshStdout, "thr-fresh", () =>
      freshClient.startSession({
        prompt: "p1",
        cwd: "/c1",
        baseInstructions: "platform",
      })
    );

    const freshFirstFrame = parseClientFrames(freshChunks)[0]!;
    expect(freshFirstFrame["method"]).toBe("thread/start");
    expect(freshFirstFrame["params"]).toEqual({
      cwd: "/c1",
      baseInstructions: "platform",
    });

    freshProc.emit("exit", 0);

    const resumeChunks: string[] = [];
    const { proc: resumeProc, stdout: resumeStdout } =
      makeFakeProc(resumeChunks);
    vi.mocked(spawn).mockReturnValueOnce(resumeProc);

    const resumeClient = new CodexSdkClient();
    await driveToCompletion(resumeStdout, "thr-resume", () =>
      resumeClient.resumeSession("thr-resume", {
        prompt: "p2",
        cwd: "/c2",
        baseInstructions: "must not be re-sent",
      })
    );

    const resumeFirstFrame = parseClientFrames(resumeChunks)[0]!;
    expect(resumeFirstFrame["method"]).toBe("thread/resume");
    expect(resumeFirstFrame["params"]).toEqual({ threadId: "thr-resume" });

    resumeProc.emit("exit", 0);
  });

  it("forwards every JSON-RPC notification to onEvent", async () => {
    const scriptPath = createMockScript(`
const notifications = [
  { method: "thread/started", params: { thread: { id: "codex-sess-2" } } },
  { method: "turn/started", params: { threadId: "codex-sess-2", turn: { id: "root-turn" } } },
  { method: "item/started", params: { threadId: "codex-sess-2", turnId: "root-turn" } },
  { method: "process/outputDelta", params: { threadId: "codex-sess-2", turnId: "root-turn", delta: "line1" } },
  { method: "item/completed", params: { threadId: "codex-sess-2", turnId: "root-turn" } },
  { method: "turn/completed", params: { threadId: "codex-sess-2", turn: { id: "root-turn" } } },
];
for (const n of notifications) {
  process.stdout.write(JSON.stringify(n) + "\\n");
}
`);

    const client = new CodexSdkClient();
    client.setCommand(scriptPath);

    const received: CodexSdkEvent[] = [];
    client.onEvent((event) => received.push(event));

    await client.startSession({
      prompt: "patch something",
      cwd: process.cwd(),
    });

    expect(received).toHaveLength(6);
    expect(received[0]!.method).toBe("thread/started");
    expect(received[5]!.method).toBe("turn/completed");

    await client.disconnect();
  });

  it("tolerates malformed (non-JSON) lines without crashing", async () => {
    const scriptPath = createMockScript(`
process.stdout.write(JSON.stringify({ method: "thread/started", params: { thread: { id: "codex-sess-3" } } }) + "\\n");
process.stdout.write("this is not json\\n");
process.stdout.write("{broken json\\n");
process.stdout.write("   \\n");
process.stdout.write(JSON.stringify({ method: "turn/started", params: { threadId: "codex-sess-3", turn: { id: "root-turn" } } }) + "\\n");
process.stdout.write(JSON.stringify({ method: "item/agentMessage/delta", params: { threadId: "codex-sess-3", turnId: "root-turn", delta: "ok" } }) + "\\n");
process.stdout.write(JSON.stringify({ method: "turn/completed", params: { threadId: "codex-sess-3", turn: { id: "root-turn" } } }) + "\\n");
`);

    const client = new CodexSdkClient();
    client.setCommand(scriptPath);

    const events: CodexSdkEvent[] = [];
    client.onEvent((event) => events.push(event));

    await client.startSession({ prompt: "noisy output", cwd: process.cwd() });

    expect(client.getSessionId()).toBe("codex-sess-3");
    // Only the 3 valid JSON lines reach onEvent (blank line is skipped before parse)
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.method)).toEqual([
      "thread/started",
      "turn/started",
      "item/agentMessage/delta",
      "turn/completed",
    ]);

    await client.disconnect();
  });

  it("disconnect tears down the process and rejects the pending startSession", async () => {
    const scriptPath = createMockScript(`
process.stdout.write(JSON.stringify({ method: "thread/started", params: { thread: { id: "codex-sess-hang" } } }) + "\\n");
// Never emits turn/completed — simulates a hanging session
setInterval(() => {}, 60_000);
`);

    const client = new CodexSdkClient();
    client.setCommand(scriptPath);

    const startPromise = client.startSession({
      prompt: "will hang",
      cwd: process.cwd(),
    });
    startPromise.catch(() => {});

    // Give the process time to start and emit thread/started
    await new Promise((r) => setTimeout(r, 200));
    expect(client.getSessionId()).toBe("codex-sess-hang");

    await client.disconnect();

    await expect(startPromise).rejects.toThrow("Disconnected");
    expect(client.getSessionId()).toBeNull();
  });

  it("rejects the pending session when the child stdin pipe errors", async () => {
    const fakeStdout = new Readable({ read() {} });
    const fakeStderr = new Readable({ read() {} });
    const fakeStdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const fakeProc = Object.assign(new EventEmitter(), {
      stdout: fakeStdout,
      stderr: fakeStderr,
      stdin: fakeStdin,
      pid: 997,
      kill: vi.fn(),
    }) as unknown as ReturnType<typeof spawn>;
    vi.mocked(spawn).mockReturnValueOnce(fakeProc);

    const client = new CodexSdkClient();
    const startPromise = client.startSession({
      prompt: "pipe failure",
      cwd: process.cwd(),
    });
    startPromise.catch(() => {});

    emitInitializeResponse(fakeStdout);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const pipeError = Object.assign(new Error("write EPIPE"), {
      code: "EPIPE",
    });
    fakeStdin.emit("error", pipeError);

    await expect(startPromise).rejects.toThrow(
      "Process stdin error (EPIPE): write EPIPE"
    );
    fakeProc.emit("exit", 1);
  });

  describe("compact()", () => {
    const makeSessionProc = () => {
      const fakeStdout = new Readable({ read() {} });
      const fakeStderr = new Readable({ read() {} });
      const stdinChunks: string[] = [];
      const fakeStdin = new Writable({
        write(chunk: Buffer | string, _enc, cb) {
          stdinChunks.push(
            typeof chunk === "string" ? chunk : chunk.toString()
          );
          cb();
        },
        writable: true,
      });
      Object.defineProperty(fakeStdin, "writable", { get: () => true });
      const fakeProc = Object.assign(new EventEmitter(), {
        stdout: fakeStdout,
        stderr: fakeStderr,
        stdin: fakeStdin,
        pid: 1000,
        kill: vi.fn(),
      }) as unknown as ReturnType<typeof spawn>;
      return { fakeProc, fakeStdout, stdinChunks };
    };

    const emitSessionReady = (
      fakeStdout: Readable,
      sessionId = "sess-compact"
    ) => {
      fakeStdout.push(
        `${JSON.stringify({
          method: "thread/started",
          params: { thread: { id: sessionId } },
        })}\n`
      );
      fakeStdout.push(
        `${JSON.stringify({
          method: "turn/started",
          params: { threadId: sessionId, turn: { id: "root-turn" } },
        })}\n`
      );
    };

    const emitTurnCompleted = (fakeStdout: Readable) => {
      fakeStdout.push(
        `${JSON.stringify({
          method: "turn/completed",
          params: { threadId: "sess-compact", turn: { id: "root-turn" } },
        })}\n`
      );
    };

    const emitThreadCompacted = (fakeStdout: Readable) => {
      fakeStdout.push(
        `${JSON.stringify({
          method: "thread/compacted",
          params: { threadId: "sess-compact" },
        })}\n`
      );
    };

    it("writes thread/compact/start ClientRequest with threadId to stdin", async () => {
      const { fakeProc, fakeStdout, stdinChunks } = makeSessionProc();
      vi.mocked(spawn).mockReturnValueOnce(fakeProc);

      const client = new CodexSdkClient();
      const startPromise = client.startSession({
        prompt: "hello",
        cwd: "/tmp",
      });

      emitInitializeResponse(fakeStdout);
      await new Promise((r) => setImmediate(r));
      emitSessionReady(fakeStdout);
      await new Promise((r) => setImmediate(r));
      emitTurnCompleted(fakeStdout);
      await startPromise;

      fakeStdout.push(
        `${JSON.stringify({
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "sess-compact",
            tokenUsage: {
              last: { totalTokens: 5000 },
              modelContextWindow: 200000,
            },
          },
        })}\n`
      );
      await new Promise((r) => setImmediate(r));
      expect(client.getContextUsage().totalTokens).toBe(5000);
      // The old count becomes unavailable immediately, before the boundary.
      const compactPromise = client.compact();
      expect(() => client.getContextUsage()).toThrow(
        CodexNoContextSnapshotError
      );
      await new Promise((r) => setImmediate(r));
      emitThreadCompacted(fakeStdout);
      await compactPromise;

      const frames = stdinChunks
        .join("")
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>);

      const compactFrame = frames.find(
        (f) => f["method"] === "thread/compact/start"
      );
      expect(compactFrame).toBeDefined();
      expect(compactFrame!["params"]).toEqual({ threadId: "sess-compact" });
      expect(typeof compactFrame!["id"]).toBe("number");

      fakeProc.emit("exit", 0);
    });

    it("resolves when thread/compacted notification arrives", async () => {
      const { fakeProc, fakeStdout } = makeSessionProc();
      vi.mocked(spawn).mockReturnValueOnce(fakeProc);

      const client = new CodexSdkClient();
      const startPromise = client.startSession({
        prompt: "hello",
        cwd: "/tmp",
      });

      emitInitializeResponse(fakeStdout);
      await new Promise((r) => setImmediate(r));
      emitSessionReady(fakeStdout);
      await new Promise((r) => setImmediate(r));
      emitTurnCompleted(fakeStdout);
      await startPromise;

      const compactPromise = client.compact();
      await new Promise((r) => setImmediate(r));
      emitThreadCompacted(fakeStdout);

      await expect(compactPromise).resolves.toBeUndefined();

      fakeProc.emit("exit", 0);
    });

    it("rejects with CodexCompactTimeoutError when no thread/compacted arrives", async () => {
      const { fakeProc, fakeStdout } = makeSessionProc();
      vi.mocked(spawn).mockReturnValueOnce(fakeProc);

      const client = new CodexSdkClient();
      const startPromise = client.startSession({
        prompt: "hello",
        cwd: "/tmp",
      });

      emitInitializeResponse(fakeStdout);
      await new Promise((r) => setImmediate(r));
      emitSessionReady(fakeStdout);
      await new Promise((r) => setImmediate(r));
      emitTurnCompleted(fakeStdout);
      await startPromise;

      await expect(client.compact({ timeoutMs: 50 })).rejects.toBeInstanceOf(
        CodexCompactTimeoutError
      );

      fakeProc.emit("exit", 0);
    });

    it("rejects with an error when disconnect() is called mid-compact", async () => {
      const scriptPath = createMockScript(`
process.stdout.write(JSON.stringify({ method: "thread/started", params: { thread: { id: "sess-dc" } } }) + "\\n");
process.stdout.write(JSON.stringify({ method: "turn/started", params: { threadId: "sess-dc", turn: { id: "root-turn" } } }) + "\\n");
process.stdout.write(JSON.stringify({ method: "turn/completed", params: { threadId: "sess-dc", turn: { id: "root-turn" } } }) + "\\n");
// Never emits thread/compacted
setInterval(() => {}, 60_000);
`);

      const client = new CodexSdkClient();
      client.setCommand(scriptPath);

      await client.startSession({ prompt: "hello", cwd: process.cwd() });

      const compactPromise = client.compact();
      compactPromise.catch(() => {});

      await client.disconnect();

      await expect(compactPromise).rejects.toThrow();
    });
  });

  describe("getContextUsage()", () => {
    const makeSessionProc = () => {
      const fakeStdout = new Readable({ read() {} });
      const fakeStderr = new Readable({ read() {} });
      const stdinChunks: string[] = [];
      const fakeStdin = new Writable({
        write(chunk: Buffer | string, _enc, cb) {
          stdinChunks.push(
            typeof chunk === "string" ? chunk : chunk.toString()
          );
          cb();
        },
      });
      Object.defineProperty(fakeStdin, "writable", { get: () => true });
      const fakeProc = Object.assign(new EventEmitter(), {
        stdout: fakeStdout,
        stderr: fakeStderr,
        stdin: fakeStdin,
        pid: 1001,
        kill: vi.fn(),
      }) as unknown as ReturnType<typeof spawn>;
      return { fakeProc, fakeStdout };
    };

    it("emits a normalized cumulative cache observation from token usage updates", async () => {
      const { fakeProc, fakeStdout } = makeSessionProc();
      vi.mocked(spawn).mockReturnValueOnce(fakeProc);

      const client = new CodexSdkClient();
      const tokenUsages: Array<{
        inputTokens: number | null;
        outputTokens: number;
        cacheCreationInputTokens: null;
        cacheReadInputTokens: number | null;
        cacheAvailability: "partial" | "unsupported";
      }> = [];
      client.onTokenUsage((usage) => tokenUsages.push(usage));
      const startPromise = client.startSession({
        prompt: "hello",
        cwd: "/tmp",
      });

      emitInitializeResponse(fakeStdout);
      await new Promise((r) => setImmediate(r));
      fakeStdout.push(
        `${JSON.stringify({
          method: "thread/started",
          params: { thread: { id: "sess-usage-1" } },
        })}\n`
      );
      await new Promise((r) => setImmediate(r));
      fakeStdout.push(
        `${JSON.stringify({
          method: "turn/started",
          params: { threadId: "sess-usage-1", turn: { id: "turn-1" } },
        })}\n`
      );
      fakeStdout.push(
        `${JSON.stringify({
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "sess-usage-1",
            tokenUsage: {
              total: {
                inputTokens: 100,
                cachedInputTokens: 25,
                outputTokens: 10,
              },
              last: { totalTokens: 5 },
              modelContextWindow: 200,
            },
          },
        })}\n`
      );
      fakeStdout.push(
        `${JSON.stringify({
          method: "turn/completed",
          params: { threadId: "sess-usage-1", turn: { id: "turn-1" } },
        })}\n`
      );
      await startPromise;

      expect(tokenUsages).toEqual([
        {
          inputTokens: 75,
          outputTokens: 10,
          cacheCreationInputTokens: null,
          cacheReadInputTokens: 25,
          cacheAvailability: "partial",
        },
      ]);

      fakeProc.emit("exit", 0);
    });

    it("does not fabricate token usage for incomplete or contradictory counters", async () => {
      const { fakeProc, fakeStdout } = makeSessionProc();
      vi.mocked(spawn).mockReturnValueOnce(fakeProc);

      const client = new CodexSdkClient();
      const tokenUsages: unknown[] = [];
      client.onTokenUsage((usage) => tokenUsages.push(usage));
      const startPromise = client.startSession({
        prompt: "hello",
        cwd: "/tmp",
      });

      emitInitializeResponse(fakeStdout);
      await new Promise((r) => setImmediate(r));
      fakeStdout.push(
        `${JSON.stringify({
          method: "thread/started",
          params: { thread: { id: "sess-usage-2" } },
        })}\n`
      );
      await new Promise((r) => setImmediate(r));
      fakeStdout.push(
        `${JSON.stringify({
          method: "turn/started",
          params: { threadId: "sess-usage-2", turn: { id: "turn-1" } },
        })}\n`
      );
      for (const total of [
        { inputTokens: 100, cachedInputTokens: 25 },
        { inputTokens: 10, cachedInputTokens: 20, outputTokens: 5 },
      ]) {
        fakeStdout.push(
          `${JSON.stringify({
            method: "thread/tokenUsage/updated",
            params: {
              threadId: "sess-usage-2",
              tokenUsage: {
                total,
                last: { totalTokens: 5 },
                modelContextWindow: 200,
              },
            },
          })}\n`
        );
      }
      fakeStdout.push(
        `${JSON.stringify({
          method: "turn/completed",
          params: { threadId: "sess-usage-2", turn: { id: "turn-1" } },
        })}\n`
      );
      await startPromise;

      expect(tokenUsages).toEqual([
        {
          inputTokens: null,
          outputTokens: 5,
          cacheCreationInputTokens: null,
          cacheReadInputTokens: null,
          cacheAvailability: "unsupported",
        },
      ]);

      fakeProc.emit("exit", 0);
    });

    it("throws CodexNoContextSnapshotError before any thread/tokenUsage/updated arrives", async () => {
      const { fakeProc, fakeStdout } = makeSessionProc();
      vi.mocked(spawn).mockReturnValueOnce(fakeProc);

      const client = new CodexSdkClient();
      const startPromise = client.startSession({
        prompt: "hello",
        cwd: "/tmp",
      });

      emitInitializeResponse(fakeStdout);
      await new Promise((r) => setImmediate(r));

      fakeStdout.push(
        `${JSON.stringify({
          method: "thread/started",
          params: { thread: { id: "sess-ctx-1" } },
        })}\n`
      );
      await new Promise((r) => setImmediate(r));
      fakeStdout.push(
        `${JSON.stringify({
          method: "turn/started",
          params: { threadId: "sess-ctx-1", turn: { id: "turn-1" } },
        })}\n`
      );
      fakeStdout.push(
        `${JSON.stringify({
          method: "turn/completed",
          params: { threadId: "sess-ctx-1", turn: { id: "turn-1" } },
        })}\n`
      );
      await startPromise;

      expect(() => client.getContextUsage()).toThrow(
        CodexNoContextSnapshotError
      );

      fakeProc.emit("exit", 0);
    });

    it("throws the no-active-session error when called before startSession", () => {
      const client = new CodexSdkClient();
      expect(() => client.getContextUsage()).toThrow(
        "No active session. Call startSession() first."
      );
    });

    it("synthesizes ContextData from cached thread/tokenUsage/updated + thread/settings/updated", async () => {
      const { fakeProc, fakeStdout } = makeSessionProc();
      vi.mocked(spawn).mockReturnValueOnce(fakeProc);

      const client = new CodexSdkClient();
      const startPromise = client.startSession({
        prompt: "hello",
        cwd: "/tmp",
      });

      emitInitializeResponse(fakeStdout);
      await new Promise((r) => setImmediate(r));

      fakeStdout.push(
        `${JSON.stringify({
          method: "thread/started",
          params: { thread: { id: "sess-ctx-2" } },
        })}\n`
      );
      await new Promise((r) => setImmediate(r));

      fakeStdout.push(
        `${JSON.stringify({
          method: "turn/started",
          params: { threadId: "sess-ctx-2", turn: { id: "turn-1" } },
        })}\n`
      );

      fakeStdout.push(
        `${JSON.stringify({
          method: "thread/settings/updated",
          params: {
            threadId: "sess-ctx-2",
            threadSettings: { model: "gpt-5-codex" },
          },
        })}\n`
      );
      fakeStdout.push(
        `${JSON.stringify({
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "sess-ctx-2",
            turnId: "turn-1",
            tokenUsage: {
              total: {
                totalTokens: 50_000,
                inputTokens: 30_000,
                cachedInputTokens: 10_000,
                outputTokens: 8_000,
                reasoningOutputTokens: 2_000,
              },
              last: {
                totalTokens: 5_000,
                inputTokens: 3_000,
                cachedInputTokens: 1_000,
                outputTokens: 800,
                reasoningOutputTokens: 200,
              },
              modelContextWindow: 200_000,
            },
          },
        })}\n`
      );
      await new Promise((r) => setImmediate(r));
      fakeStdout.push(
        `${JSON.stringify({
          method: "turn/completed",
          params: { threadId: "sess-ctx-2", turn: { id: "turn-1" } },
        })}\n`
      );
      await startPromise;

      const ctx = client.getContextUsage();
      expect(ctx.totalTokens).toBe(5_000);
      expect(ctx.maxTokens).toBe(200_000);
      expect(ctx.rawMaxTokens).toBe(200_000);
      expect(ctx.percentage).toBeCloseTo(2.5, 5);
      expect(ctx.model).toBe("gpt-5-codex");
      expect(ctx.categories).toEqual([]);
      expect(ctx.gridRows).toEqual([]);
      expect(ctx.memoryFiles).toEqual([]);
      expect(ctx.mcpTools).toEqual([]);
      expect(ctx.agents).toEqual([]);
      expect(ctx.isAutoCompactEnabled).toBe(false);
      expect(ctx.apiUsage).toBeNull();
      fakeStdout.push(
        `${JSON.stringify({
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "other-thread",
            tokenUsage: {
              last: { totalTokens: 999 },
              modelContextWindow: 1000,
            },
          },
        })}\n`
      );
      await new Promise((r) => setImmediate(r));
      expect(client.getContextUsage().totalTokens).toBe(5_000);
      fakeStdout.push(
        `${JSON.stringify({
          method: "thread/compacted",
          params: { threadId: "other-thread" },
        })}\n`
      );
      await new Promise((r) => setImmediate(r));
      expect(client.getContextUsage().totalTokens).toBe(5_000);
      fakeStdout.push(
        `${JSON.stringify({
          method: "thread/compacted",
          params: { threadId: "sess-ctx-2" },
        })}\n`
      );
      await new Promise((r) => setImmediate(r));
      expect(() => client.getContextUsage()).toThrow(
        CodexNoContextSnapshotError
      );
      fakeStdout.push(
        `${JSON.stringify({
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "sess-ctx-2",
            tokenUsage: {
              last: { totalTokens: 500 },
              modelContextWindow: 200_000,
            },
          },
        })}\n`
      );
      await new Promise((r) => setImmediate(r));
      expect(client.getContextUsage().totalTokens).toBe(500);

      fakeProc.emit("exit", 0);
    });

    it("reports context tokens when the model context window is unavailable", async () => {
      const { fakeProc, fakeStdout } = makeSessionProc();
      vi.mocked(spawn).mockReturnValueOnce(fakeProc);

      const client = new CodexSdkClient();
      const startPromise = client.startSession({
        prompt: "hello",
        cwd: "/tmp",
      });

      emitInitializeResponse(fakeStdout);
      await new Promise((r) => setImmediate(r));

      fakeStdout.push(
        `${JSON.stringify({
          method: "thread/started",
          params: { thread: { id: "sess-ctx-3" } },
        })}\n`
      );
      await new Promise((r) => setImmediate(r));
      fakeStdout.push(
        `${JSON.stringify({
          method: "turn/started",
          params: { threadId: "sess-ctx-3", turn: { id: "turn-1" } },
        })}\n`
      );
      fakeStdout.push(
        `${JSON.stringify({
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "sess-ctx-3",
            turnId: "turn-1",
            tokenUsage: {
              total: { totalTokens: 1234 },
              last: { totalTokens: 100 },
              modelContextWindow: null,
            },
          },
        })}\n`
      );
      await new Promise((r) => setImmediate(r));
      fakeStdout.push(
        `${JSON.stringify({
          method: "turn/completed",
          params: { threadId: "sess-ctx-3", turn: { id: "turn-1" } },
        })}\n`
      );
      await startPromise;

      expect(client.getContextUsage()).toMatchObject({
        totalTokens: 100,
        maxTokens: 0,
        rawMaxTokens: 0,
        percentage: 0,
      });

      fakeProc.emit("exit", 0);
    });
  });

  it.skip("abort signal rejects the pending startSession and kills the process", async () => {
    const scriptPath = createMockScript(`
process.stdout.write(JSON.stringify({ method: "thread/started", params: { thread: { id: "codex-sess-abort" } } }) + "\\n");
setInterval(() => {}, 60_000);
`);

    const client = new CodexSdkClient();
    client.setCommand(scriptPath);

    const controller = new AbortController();
    const startPromise = client.startSession(
      { prompt: "will be aborted", cwd: process.cwd() },
      { signal: controller.signal }
    );
    startPromise.catch(() => {});

    await new Promise((r) => setTimeout(r, 200));
    expect(client.getSessionId()).toBe("codex-sess-abort");

    controller.abort();

    await expect(startPromise).rejects.toThrow("Aborted");
    expect(client.getSessionId()).toBeNull();

    await client.disconnect();
  });
});
