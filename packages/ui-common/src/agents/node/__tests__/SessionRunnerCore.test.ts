/** @vitest-environment node */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentMessage } from "../../core";
import { createCodexExecClient } from "../CodexExecClient";
import { createSessionRunnerCore } from "../SessionRunnerCore";

describe("SessionRunnerCore", () => {
  const tempDirs: string[] = [];

  const createTempCodexBinary = (source: string): string => {
    const directory = mkdtempSync(join(tmpdir(), "ui-common-runner-core-"));
    tempDirs.push(directory);

    const scriptPath = join(directory, "mock-codex.mjs");
    writeFileSync(scriptPath, `#!/usr/bin/env node\n${source}`, "utf8");
    chmodSync(scriptPath, 0o755);
    return scriptPath;
  };

  afterEach(() => {
    for (const directory of tempDirs.splice(0, tempDirs.length)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("runs prompt flow, captures session id, and counts error messages", async () => {
    const commandPath = createTempCodexBinary(`
const args = process.argv.slice(2);
process.stdout.write(JSON.stringify({ type: "task_started", session_id: "sess-core-1" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "error", error: { message: "warning" }, session_id: "sess-core-1" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_message", message: "assistant output", session_id: "sess-core-1" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", result: { args }, session_id: "sess-core-1" }) + "\\n");
`);

    const observedMessages: AgentMessage[] = [];
    const runner = createSessionRunnerCore({
      createClient: (init) =>
        createCodexExecClient({
          initOptions: {
            cwd: init.cwd,
            startupTimeoutMs: init.startupTimeoutMs,
            defaultTimeoutMs: init.defaultTimeoutMs,
            gracefulShutdownMs: init.gracefulShutdownMs,
          },
          codex: {
            command: commandPath,
            timeoutMs: 2_000,
          },
        }),
    });

    const result = await runner.runPrompt({
      cwd: process.cwd(),
      prompt: "hello world",
      startupTimeoutMs: 2_000,
      defaultTimeoutMs: 2_000,
      onMessage: (message) => {
        observedMessages.push(message);
      },
    });

    expect(result.providerSessionId).toBe("sess-core-1");
    expect(result.errorCount).toBe(1);

    const resultMessage = observedMessages.find(
      (message) => message.type === "result"
    );
    expect(resultMessage?.content[0]?.payload).toEqual({
      args: ["exec", "--full-auto", "--json", "hello world"],
    });
  });

  it("uses resume semantics when provider session id is supplied", async () => {
    const commandPath = createTempCodexBinary(`
const args = process.argv.slice(2);
process.stdout.write(JSON.stringify({ type: "result", result: { args }, session_id: "sess-existing-1" }) + "\\n");
`);

    const observedMessages: AgentMessage[] = [];
    const runner = createSessionRunnerCore({
      createClient: (init) =>
        createCodexExecClient({
          initOptions: {
            cwd: init.cwd,
            startupTimeoutMs: init.startupTimeoutMs,
            defaultTimeoutMs: init.defaultTimeoutMs,
            gracefulShutdownMs: init.gracefulShutdownMs,
          },
          codex: {
            command: commandPath,
            timeoutMs: 2_000,
          },
        }),
    });

    const result = await runner.runPrompt({
      cwd: process.cwd(),
      prompt: "continue",
      providerSessionId: "sess-existing-1",
      startupTimeoutMs: 2_000,
      defaultTimeoutMs: 2_000,
      onMessage: (message) => {
        observedMessages.push(message);
      },
    });

    expect(result.providerSessionId).toBe("sess-existing-1");
    expect(result.errorCount).toBe(0);

    const resultMessage = observedMessages.find(
      (message) => message.type === "result"
    );
    expect(resultMessage?.content[0]?.payload).toEqual({
      args: [
        "exec",
        "resume",
        "--full-auto",
        "--json",
        "sess-existing-1",
        "continue",
      ],
    });
  });
});
