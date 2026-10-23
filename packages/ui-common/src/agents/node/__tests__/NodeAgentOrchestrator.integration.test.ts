/** @vitest-environment node */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  InMemoryAgentSessionStore,
  toAgentSessionId,
  type AgentMessage,
  type MessageStream,
} from "../../core";
import { NodeAgentOrchestrator } from "../NodeAgentOrchestrator";

const collectMessages = async (
  stream: MessageStream
): Promise<AgentMessage[]> => {
  const messages: AgentMessage[] = [];
  for await (const message of stream) {
    messages.push(message);
  }
  return messages;
};

describe("NodeAgentOrchestrator integration", () => {
  const tempDirs: string[] = [];

  const createTempScript = (source: string): string => {
    const directory = mkdtempSync(join(tmpdir(), "ui-common-orch-int-"));
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

  it("runs and resumes through the real Claude adapter with session persistence", async () => {
    const scriptPath = createTempScript(`
      const args = process.argv.slice(2);
      const promptIndex = args.indexOf("--prompt");
      const prompt = promptIndex >= 0 ? args[promptIndex + 1] : "";
      const resumeIndex = args.indexOf("--resume");
      const resumeSessionId = resumeIndex >= 0 ? args[resumeIndex + 1] : null;
      const sessionId = resumeSessionId ?? "sess-claude-1";

      process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: sessionId }) + "\\n");
      process.stdout.write(JSON.stringify({
        type: "assistant",
        session_id: sessionId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Echo:" + prompt }]
        }
      }) + "\\n");
      process.stdout.write(JSON.stringify({
        type: "result",
        session_id: sessionId,
        result: { prompt, resumeSessionId }
      }) + "\\n");
    `);

    const store = new InMemoryAgentSessionStore();
    const orchestrator = new NodeAgentOrchestrator({
      sessionStore: store,
    });

    const runMessages = await collectMessages(
      await orchestrator.run({
        adapterId: "claude",
        prompt: "hello",
        initOptions: {
          cwd: process.cwd(),
          startupTimeoutMs: 2_000,
          defaultTimeoutMs: 2_000,
        },
        adapterFactoryOptions: {
          claude: {
            command: process.execPath,
            baseArgs: [scriptPath],
            promptFlag: "--prompt",
            resumeFlag: "--resume",
            timeoutMs: 2_000,
          },
        },
      })
    );

    const sessionId = toAgentSessionId("sess-claude-1");
    const runMetadata = await store.retrieve(sessionId);

    expect(runMessages.some((message) => message.type === "system")).toBe(true);
    expect(runMessages.some((message) => message.type === "assistant")).toBe(
      true
    );
    expect(runMessages.some((message) => message.type === "result")).toBe(true);
    expect(runMetadata).not.toBeNull();
    expect(runMetadata?.adapter).toBe("claude");
    expect(runMetadata?.updatedAt).toBeUndefined();

    const resumeMessages = await collectMessages(
      await orchestrator.resume({
        adapterId: "claude",
        sessionId,
        prompt: "follow-up",
        initOptions: {
          cwd: process.cwd(),
          startupTimeoutMs: 2_000,
          defaultTimeoutMs: 2_000,
        },
        adapterFactoryOptions: {
          claude: {
            command: process.execPath,
            baseArgs: [scriptPath],
            promptFlag: "--prompt",
            resumeFlag: "--resume",
            timeoutMs: 2_000,
          },
        },
      })
    );

    const resumeResultMessage = resumeMessages.find(
      (message) => message.type === "result"
    );
    expect(resumeResultMessage).toBeDefined();
    expect(resumeResultMessage?.content[0]?.payload).toEqual({
      prompt: "follow-up",
      resumeSessionId: "sess-claude-1",
    });

    const resumeMetadata = await store.retrieve(sessionId);
    expect(resumeMetadata?.adapter).toBe("claude");
    expect(typeof resumeMetadata?.updatedAt).toBe("number");
  });

  it("runs through the real Codex adapter and persists fallback session ids", async () => {
    const scriptPath = createTempScript(`
      const sessionId = "sess-codex-1";
      process.stdout.write(JSON.stringify({ type: "task_started", session_id: sessionId }) + "\\n");
      process.stdout.write(JSON.stringify({ type: "agent_message", message: "Working", session_id: sessionId }) + "\\n");
      process.stdout.write(JSON.stringify({
        type: "exec_approval_request",
        call_id: "call-1",
        codex_command: ["ls", "-la"],
        codex_cwd: "/tmp",
        session_id: sessionId
      }) + "\\n");
      process.stdout.write(JSON.stringify({
        type: "exec_command_end",
        call_id: "call-1",
        output: "done",
        session_id: sessionId
      }) + "\\n");
      process.stdout.write(JSON.stringify({ type: "task_complete", session_id: sessionId }) + "\\n");
    `);

    const store = new InMemoryAgentSessionStore();
    const orchestrator = new NodeAgentOrchestrator({
      sessionStore: store,
    });

    const messages = await collectMessages(
      await orchestrator.run({
        adapterId: "codex",
        prompt: "run",
        initOptions: {
          cwd: process.cwd(),
          startupTimeoutMs: 2_000,
          defaultTimeoutMs: 2_000,
        },
        adapterFactoryOptions: {
          codex: {
            command: process.execPath,
            baseArgs: [scriptPath],
            promptFlag: "--prompt",
            resumeFlag: "--resume",
            timeoutMs: 2_000,
          },
        },
      })
    );

    expect(
      messages.some(
        (message) =>
          message.type === "tool" && message.subtype === "exec_approval_request"
      )
    ).toBe(true);
    expect(
      messages.some(
        (message) =>
          message.type === "result" && message.subtype === "exec_command_end"
      )
    ).toBe(true);
    expect(
      messages.some(
        (message) =>
          message.type === "system" && message.subtype === "task_complete"
      )
    ).toBe(true);

    const sessionId = toAgentSessionId("sess-codex-1");
    const metadata = await store.retrieve(sessionId);
    expect(metadata).not.toBeNull();
    expect(metadata?.adapter).toBe("codex");
  });
});
