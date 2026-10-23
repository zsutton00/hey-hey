/** @vitest-environment node */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MessageStream } from "../../core";
import { toAgentSessionId } from "../../core";
import { ClaudeCodeAdapter } from "../ClaudeCodeAdapter";
import { CodexAdapter } from "../CodexAdapter";

const collectMessages = async (stream: MessageStream) => {
  const messages = [];
  for await (const message of stream) {
    messages.push(message);
  }
  return messages;
};

describe("node agent adapters", () => {
  const tempDirs: string[] = [];

  const createTempScript = (source: string): string => {
    const directory = mkdtempSync(join(tmpdir(), "ui-common-agent-test-"));
    tempDirs.push(directory);
    const scriptPath = join(directory, "mock-agent.mjs");
    writeFileSync(scriptPath, source, "utf8");
    return scriptPath;
  };

  afterEach(() => {
    for (const directory of tempDirs.splice(0, tempDirs.length)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("parses and normalizes NDJSON events from a spawned agent", async () => {
    const scriptPath = createTempScript(`
      const args = process.argv.slice(2);
      const promptIndex = args.indexOf("--prompt");
      const prompt = promptIndex >= 0 ? args[promptIndex + 1] : "";
      process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "sess-123" }) + "\\n");
      process.stdout.write('{"type":"assistant","text":"partial');
      process.stdout.write(' message"}\\n');
      process.stdout.write('{"type":"assistant","text":"broken"\\n');
      process.stdout.write(JSON.stringify({ type: "result", result: { prompt } }) + "\\n");
    `);

    const adapter = new ClaudeCodeAdapter({
      command: process.execPath,
      baseArgs: [scriptPath],
      promptFlag: "--prompt",
      resumeFlag: "--resume",
      timeoutMs: 2_000,
    });

    await adapter.init({
      cwd: process.cwd(),
      startupTimeoutMs: 2_000,
      defaultTimeoutMs: 2_000,
    });

    const messages = await collectMessages(await adapter.submitPrompt("hello"));
    await adapter.close();

    expect(messages.some((message) => message.type === "system")).toBe(true);
    expect(messages.some((message) => message.sessionId === "sess-123")).toBe(
      true
    );
    expect(messages.some((message) => message.subtype === "parse_error")).toBe(
      true
    );
    expect(messages[messages.length - 1]?.type).toBe("result");
    expect(messages[messages.length - 1]?.content[0]?.payload).toEqual({
      prompt: "hello",
    });
  });

  it("passes resume arguments through concrete adapters", async () => {
    const scriptPath = createTempScript(`
      const args = process.argv.slice(2);
      process.stdout.write(JSON.stringify({ type: "result", result: { args } }) + "\\n");
    `);

    const adapter = new CodexAdapter({
      command: process.execPath,
      baseArgs: [scriptPath],
      promptFlag: "--prompt",
      resumeFlag: "--resume",
      timeoutMs: 2_000,
    });

    await adapter.init({
      cwd: process.cwd(),
      startupTimeoutMs: 2_000,
      defaultTimeoutMs: 2_000,
    });

    const messages = await collectMessages(
      await adapter.resume(toAgentSessionId("sess-abc"), "continue here")
    );
    await adapter.close();

    const resultMessage = messages.find((message) => message.type === "result");
    expect(resultMessage).toBeDefined();
    expect(resultMessage?.content[0]?.payload).toEqual({
      args: ["--resume", "sess-abc", "--prompt", "continue here"],
    });
  });

  it("normalizes spawn failures as error messages", async () => {
    const adapter = new ClaudeCodeAdapter({
      command: "this-command-does-not-exist",
      baseArgs: [],
      promptFlag: "--prompt",
      resumeFlag: "--resume",
      timeoutMs: 500,
    });

    await adapter.init({
      cwd: process.cwd(),
      startupTimeoutMs: 500,
      defaultTimeoutMs: 500,
    });

    const messages = await collectMessages(await adapter.submitPrompt("hello"));
    await adapter.close();

    expect(messages.some((message) => message.subtype === "spawn_error")).toBe(
      true
    );
  });

  it("emits timeout errors when prompt execution exceeds timeout", async () => {
    const scriptPath = createTempScript(`
      setTimeout(() => {
        process.stdout.write(JSON.stringify({ type: "assistant", text: "late" }) + "\\n");
      }, 2000);
    `);

    const adapter = new ClaudeCodeAdapter({
      command: process.execPath,
      baseArgs: [scriptPath],
      promptFlag: "--prompt",
      resumeFlag: "--resume",
      timeoutMs: 25,
    });

    await adapter.init({
      cwd: process.cwd(),
      startupTimeoutMs: 1_000,
      defaultTimeoutMs: 25,
    });

    const messages = await collectMessages(await adapter.submitPrompt("hello"));
    await adapter.close();

    expect(messages.some((message) => message.subtype === "timeout")).toBe(
      true
    );
  });

  it("returns immediately for already-aborted signals without spawning", async () => {
    const scriptPath = createTempScript(`
      process.stdout.write(JSON.stringify({ type: "result", result: { shouldNotRun: true } }) + "\\n");
    `);

    const adapter = new ClaudeCodeAdapter({
      command: process.execPath,
      baseArgs: [scriptPath],
      promptFlag: "--prompt",
      resumeFlag: "--resume",
      timeoutMs: 500,
    });

    await adapter.init({
      cwd: process.cwd(),
      startupTimeoutMs: 500,
      defaultTimeoutMs: 500,
      gracefulShutdownMs: 50,
    });

    const controller = new AbortController();
    controller.abort();

    const messages = await collectMessages(
      await adapter.submitPrompt("hello", { signal: controller.signal })
    );
    await adapter.close();

    expect(messages).toHaveLength(1);
    expect(messages[0]?.subtype).toBe("aborted");
    expect(messages.some((message) => message.type === "result")).toBe(false);
    expect(messages.some((message) => message.subtype === "spawn_error")).toBe(
      false
    );
  });

  it("force-kills processes that ignore SIGTERM after timeout", async () => {
    const scriptPath = createTempScript(`
      process.on("SIGTERM", () => {
        // Intentionally ignore SIGTERM so the adapter must escalate to SIGKILL.
      });
      setInterval(() => {}, 1000);
    `);

    const adapter = new ClaudeCodeAdapter({
      command: process.execPath,
      baseArgs: [scriptPath],
      promptFlag: "--prompt",
      resumeFlag: "--resume",
      timeoutMs: 25,
    });

    await adapter.init({
      cwd: process.cwd(),
      startupTimeoutMs: 1_000,
      defaultTimeoutMs: 25,
      gracefulShutdownMs: 50,
    });

    const startTime = Date.now();
    const messages = await collectMessages(await adapter.submitPrompt("hello"));
    const elapsedMs = Date.now() - startTime;
    await adapter.close();

    expect(messages.some((message) => message.subtype === "timeout")).toBe(
      true
    );
    expect(messages.some((message) => message.subtype === "process_exit")).toBe(
      false
    );
    expect(elapsedMs).toBeLessThan(2_000);
  });
});
