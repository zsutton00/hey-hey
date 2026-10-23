/** @vitest-environment node */

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeCodeSdkClient,
  CompactTimeoutError,
  ControlRequestAbortedError,
  ControlRequestDisconnectedError,
  ControlRequestRemoteError,
  ControlRequestSchemaError,
  type ClaudeCodeSdkEvent,
} from '../ClaudeCodeSdkClient';

const VALID_CONTEXT_DATA = {
  categories: [],
  totalTokens: 0,
  maxTokens: 200000,
  rawMaxTokens: 200000,
  percentage: 0,
  gridRows: [],
  model: 'claude-opus-4-7',
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  isAutoCompactEnabled: true,
  apiUsage: null,
};

describe('ClaudeCodeSdkClient', () => {
  const tempDirs: string[] = [];

  const createMockScript = (source: string): string => {
    const directory = mkdtempSync(join(tmpdir(), 'ui-common-claude-sdk-'));
    tempDirs.push(directory);

    const scriptPath = join(directory, 'mock-claude.mjs');
    writeFileSync(scriptPath, `#!/usr/bin/env node\n${source}`, 'utf8');
    chmodSync(scriptPath, 0o755);
    return scriptPath;
  };

  it.each([false, true])(
    'sends attachment contents on cold resume=%s and warm continuation',
    async (coldResume) => {
      const directory = mkdtempSync(join(tmpdir(), 'claude-attachment-'));
      tempDirs.push(directory);
      const recordPath = join(directory, 'messages.jsonl');
      const source = [
        'import { appendFileSync } from "node:fs";',
        'import { createInterface } from "node:readline";',
        'createInterface({ input: process.stdin }).on("line", line => {',
        'if (JSON.parse(line).type !== "user") return;',
        'appendFileSync(' + JSON.stringify(recordPath) + ', line + "\\n");',
        'process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "attachment-session" }) + "\\n");',
        'process.stdout.write(JSON.stringify({ type: "result", subtype: "success", session_id: "attachment-session", is_error: false }) + "\\n");',
        '});',
      ].join('\n');
      const client = new ClaudeCodeSdkClient();
      client.setCommand(createMockScript(source));
      const attachments = [
        {
          kind: 'text' as const,
          fileName: 'notes.md',
          text: '  file contents\n',
        },
        {
          kind: 'image' as const,
          fileName: 'image.png',
          mediaType: 'image/png' as const,
          data: 'aW1hZ2U=',
        },
      ];
      try {
        await client.startSession({
          fastMode: false,
          prompt: '  first\n',
          attachments,
          cwd: process.cwd(),
          ...(coldResume ? { resumeSessionId: 'attachment-session' } : {}),
        });
        await client.continueSession('  follow-up\n', { attachments });
        const messages = readFileSync(recordPath, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        expect(messages).toHaveLength(2);
        for (const [index, message] of messages.entries()) {
          expect(message.message.content).toEqual([
            { type: 'text', text: index === 0 ? '  first\n' : '  follow-up\n' },
            { type: 'text', text: 'File: notes.md\n  file contents\n' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'aW1hZ2U=',
              },
            },
          ]);
        }
      } finally {
        await client.disconnect();
      }
    },
  );

  it.each(['start', 'control'] as const)(
    'uses replacement system-prompt arguments for %s launches',
    async (mode) => {
      const directory = mkdtempSync(join(tmpdir(), 'claude-system-prompt-'));
      tempDirs.push(directory);
      const recordPath = join(directory, 'args.json');
      const script = createMockScript(`
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify(process.argv.slice(2)));
const rl = createInterface({ input: process.stdin });
rl.on("line", () => {
  process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "replacement-session" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", session_id: "replacement-session", is_error: false }) + "\\n");
});
`);
      const client = new ClaudeCodeSdkClient();
      client.setCommand(script);
      const config = {
        fastMode: false,
        prompt: 'research',
        cwd: process.cwd(),
        systemPrompt: 'platform prompt only',
        appendSystemPrompt: 'must not append',
        ...(mode === 'control' ? { resumeSessionId: 'persisted-session' } : {}),
      };
      try {
        if (mode === 'control') await client.connectForControl(config);
        else await client.startSession(config);
        await vi.waitFor(() => {
          const args = JSON.parse(readFileSync(recordPath, 'utf8')) as string[];
          expect(args).toContain('--system-prompt');
          expect(args[args.indexOf('--system-prompt') + 1]).toBe('platform prompt only');
          expect(args).not.toContain('--append-system-prompt');
          expect(args).not.toContain('must not append');
          if (mode === 'control') expect(args).toContain('--resume');
        });
      } finally {
        await client.disconnect();
      }
    },
  );

  afterEach(() => {
    for (const directory of tempDirs.splice(0, tempDirs.length)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    [true, undefined],
    [false, undefined],
    [true, 'persisted-session'],
    [false, 'persisted-session'],
  ] as const)(
    'always sends fastMode=%s in settings (resume=%s)',
    async (fastMode, resumeSessionId) => {
      const directory = mkdtempSync(join(tmpdir(), 'claude-fast-mode-'));
      tempDirs.push(directory);
      const recordPath = join(directory, 'args.json');
      const script = createMockScript(`
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify(process.argv.slice(2)));
createInterface({ input: process.stdin }).on("line", () => {
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false }) + "\\n");
});
`);
      const client = new ClaudeCodeSdkClient();
      client.setCommand(script);
      try {
        await client.startSession({
          fastMode,
          prompt: 'hi',
          cwd: process.cwd(),
          ...(resumeSessionId ? { resumeSessionId } : {}),
        });
        const args = JSON.parse(readFileSync(recordPath, 'utf8')) as string[];
        expect(args.filter((arg) => arg === '--settings')).toHaveLength(1);
        expect(JSON.parse(args[args.indexOf('--settings') + 1]!)).toEqual({
          fastMode,
        });
        if (resumeSessionId) expect(args[args.indexOf('--resume') + 1]).toBe(resumeSessionId);
      } finally {
        await client.disconnect();
      }
    },
  );

  it('can be instantiated', () => {
    const client = new ClaudeCodeSdkClient();
    expect(client.getSessionId()).toBeNull();
  });

  it.each([
    ['fresh', undefined],
    ['resume', 'persisted-session-1'],
  ])(
    'spawns Claude directly with native sandbox settings for a %s session',
    async (_mode, resumeSessionId) => {
      const sandboxSettings = {
        enabled: true,
        failIfUnavailable: true,
        allowUnsandboxedCommands: false,
        filesystem: {
          allowWrite: ['/allowed/root', '/allowed/other'],
          allowRead: [],
        },
        network: { allowUnixSockets: [] },
      } as const;
      const recordDirectory = mkdtempSync(join(tmpdir(), 'ui-common-claude-launch-'));
      tempDirs.push(recordDirectory);
      const recordPath = join(recordDirectory, 'launch.json');
      const providerPath = createMockScript(`
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify({
  execPath: process.execPath,
  args: process.argv.slice(2),
  captureUrl: process.env.HEY_HEY_CAPTURE_URL,
  claudeConfigDir: process.env.CLAUDE_CONFIG_DIR ?? null,
  claudeCodeTmpdir: process.env.CLAUDE_CODE_TMPDIR ?? null,
  tmpdir: process.env.TMPDIR ?? null,
}));
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const inputLines = [];
rl.on("line", (line) => {
  inputLines.push(JSON.parse(line));
  writeFileSync(${JSON.stringify(join(recordDirectory, 'input.json'))}, JSON.stringify(inputLines));
  process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "contained-session" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, session_id: "contained-session" }) + "\\n");
});
`);
      const client = new ClaudeCodeSdkClient();
      client.setCommand(providerPath);
      client.onPermissionRequest(async () => ({
        behavior: 'allow',
        updatedInput: {},
      }));

      const turn = await client.startSession({
        fastMode: false,
        prompt: 'contained',
        toolExecutionHooks: {
          command: 'fixture-capture-hook',
          environment: {
            HEY_HEY_CAPTURE_URL: 'http://127.0.0.1:12345/',
            HEY_HEY_CAPTURE_TOKEN: 'fixture-token',
          },
        },
        cwd: process.cwd(),
        permissionMode: 'default',
        model: 'claude-opus-4-7',
        reasoningEffort: 'high',
        mcpServers: {
          'heyhey-platform': { type: 'http', url: 'https://heyhey.dev/mcp' },
        },
        allowedTools: ['Read'],
        builtinTools: ['Read'],
        appendSystemPrompt: 'platform context',
        ...(resumeSessionId ? { resumeSessionId } : {}),
        workspaceContainment: {
          additionalDirectories: ['/allowed/other'],
          settings: {
            sandbox: sandboxSettings,
          },
          settingSources: [],
        },
      });

      expect(turn).toEqual({
        ok: true,
        subtype: 'success',
        numTurns: 1,
        sessionId: 'contained-session',
      });
      const launch = JSON.parse(readFileSync(recordPath, 'utf8')) as {
        execPath: string;
        args: string[];
        captureUrl: string;
        claudeConfigDir: string | null;
        claudeCodeTmpdir: string | null;
        tmpdir: string | null;
      };
      // The provider is the spawned process itself — no launcher in between.
      expect(launch.execPath).toBe(process.execPath);
      expect(launch.args[0]).toBe('-p');
      expect(launch.captureUrl).toBe('http://127.0.0.1:12345/');
      expect(launch.claudeConfigDir).toBe(process.env['CLAUDE_CONFIG_DIR'] ?? null);
      expect(launch.claudeCodeTmpdir).toBe(process.env['CLAUDE_CODE_TMPDIR'] ?? null);
      expect(launch.tmpdir).toBe(process.env['TMPDIR'] ?? null);
      const settings = JSON.parse(launch.args[launch.args.indexOf('--settings') + 1]!);
      expect(settings.fastMode).toBe(false);
      expect(settings.sandbox).toEqual(sandboxSettings);
      expect(Object.keys(settings.hooks).sort()).toEqual([
        'PostToolUse',
        'PostToolUseFailure',
        'PreToolUse',
      ]);
      expect(settings.hooks.PreToolUse[0].hooks[0]).toEqual({
        type: 'command',
        command: 'fixture-capture-hook',
        timeout: 120,
      });
      expect(launch.args.filter((arg) => arg === '--settings')).toHaveLength(1);
      expect(launch.args).toContain('--add-dir');
      expect(launch.args).toContain('/allowed/other');
      expect(launch.args).toContain('--settings');
      expect(launch.args).toContain('--setting-sources');
      expect(launch.args).toContain('');
      expect(launch.args).toContain('-p');
      expect(launch.args).toContain('--output-format');
      expect(launch.args).toContain('stream-json');
      expect(launch.args).toContain('--input-format');
      expect(launch.args).toContain('--verbose');
      expect(launch.args).toContain('--include-partial-messages');
      expect(launch.args).toContain('--permission-prompt-tool');
      expect(launch.args).toContain('stdio');
      expect(launch.args).toContain('--permission-mode');
      expect(launch.args).toContain('default');
      expect(launch.args).toContain('--model');
      expect(launch.args).toContain('claude-opus-4-7');
      expect(launch.args).toContain('--effort');
      expect(launch.args).toContain('high');
      expect(launch.args).toContain('--mcp-config');
      expect(launch.args).toContain('--allowedTools');
      expect(launch.args).toContain('Read');
      expect(launch.args).toContain('--tools');
      expect(launch.args).toContain('--append-system-prompt');
      expect(launch.args).toContain('platform context');
      if (resumeSessionId) {
        expect(launch.args).toContain('--resume');
        expect(launch.args).toContain(resumeSessionId);
      }
      expect(JSON.parse(readFileSync(join(recordDirectory, 'input.json'), 'utf8'))).toEqual([
        { type: 'user', message: { role: 'user', content: 'contained' } },
      ]);
      await client.disconnect();
    },
  );

  describe('turn result classification', () => {
    const resultScript = (resultEvent: Record<string, unknown>, exitCode?: number) =>
      createMockScript(`
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", () => {
  process.stdout.write(JSON.stringify(${JSON.stringify(resultEvent)}) + "\\n");
  ${exitCode === undefined ? '' : `process.exit(${String(exitCode)});`}
});
`);

    it('resolves ok for a success result', async () => {
      const client = new ClaudeCodeSdkClient();
      client.setCommand(
        resultScript({
          type: 'result',
          subtype: 'success',
          is_error: false,
          num_turns: 2,
          result: 'done',
          session_id: 'sess-ok',
        }),
      );
      await expect(
        client.startSession({
          fastMode: false,
          prompt: 'hi',
          cwd: process.cwd(),
        }),
      ).resolves.toEqual({
        ok: true,
        subtype: 'success',
        numTurns: 2,
        sessionId: 'sess-ok',
      });
      await client.disconnect();
    });

    it('resolves a failed turn for an error_during_execution result', async () => {
      const client = new ClaudeCodeSdkClient();
      client.setCommand(
        resultScript({
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          num_turns: 0,
          errors: ['No conversation found with session ID: stale-id'],
          session_id: 'sess-new',
        }),
      );
      await expect(
        client.startSession({
          fastMode: false,
          prompt: 'hi',
          cwd: process.cwd(),
          resumeSessionId: 'stale-id',
        }),
      ).resolves.toEqual({
        ok: false,
        subtype: 'error_during_execution',
        numTurns: 0,
        sessionId: 'sess-new',
        errors: ['No conversation found with session ID: stale-id'],
        errorText: 'No conversation found with session ID: stale-id',
      });
      await client.disconnect();
    });

    it('treats is_error on a success subtype as a failed turn', async () => {
      const client = new ClaudeCodeSdkClient();
      client.setCommand(
        resultScript({
          type: 'result',
          subtype: 'success',
          is_error: true,
          result: 'API Error: overloaded',
        }),
      );
      await expect(
        client.startSession({
          fastMode: false,
          prompt: 'hi',
          cwd: process.cwd(),
        }),
      ).resolves.toMatchObject({
        ok: false,
        errorText: 'API Error: overloaded',
      });
      await client.disconnect();
    });

    it('classifies a final error result written immediately before exit(1)', async () => {
      const client = new ClaudeCodeSdkClient();
      client.setCommand(
        resultScript(
          {
            type: 'result',
            subtype: 'error_during_execution',
            is_error: true,
            num_turns: 0,
            errors: ['No conversation found with session ID: stale-id'],
          },
          1,
        ),
      );
      await expect(
        client.startSession({
          fastMode: false,
          prompt: 'hi',
          cwd: process.cwd(),
          resumeSessionId: 'stale-id',
        }),
      ).resolves.toMatchObject({
        ok: false,
        subtype: 'error_during_execution',
        errorText: 'No conversation found with session ID: stale-id',
      });
      await client.disconnect();
    });
  });

  it('starts a session and captures session id', async () => {
    const scriptPath = createMockScript(`
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.type === "user") {
    process.stdout.write(JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess-123"
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "Hello!" }] },
      session_id: "sess-123"
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      type: "result",
      result: { success: true },
      session_id: "sess-123"
    }) + "\\n");
  }
});
`);

    const client = new ClaudeCodeSdkClient();
    client.setCommand(scriptPath);

    const events: ClaudeCodeSdkEvent[] = [];
    client.onEvent((event) => events.push(event));

    await client.startSession({
      fastMode: false,
      prompt: 'hello',
      cwd: process.cwd(),
    });

    expect(client.getSessionId()).toBe('sess-123');
    expect(events.some((e) => e.type === 'system' && e.subtype === 'init')).toBe(true);
    expect(events.some((e) => e.type === 'assistant')).toBe(true);
    expect(events.some((e) => e.type === 'result')).toBe(true);

    await client.disconnect();
  });

  it('continues an active session with a follow-up prompt', async () => {
    const scriptPath = createMockScript(`
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let turnCount = 0;

rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.type === "user") {
    turnCount++;

    if (turnCount === 1) {
      process.stdout.write(JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "sess-multi"
      }) + "\\n");
    }

    process.stdout.write(JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "Turn " + turnCount }] },
      session_id: "sess-multi"
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      type: "result",
      result: { turn: turnCount },
      session_id: "sess-multi"
    }) + "\\n");
  }
});
`);

    const client = new ClaudeCodeSdkClient();
    client.setCommand(scriptPath);

    const events: ClaudeCodeSdkEvent[] = [];
    client.onEvent((event) => events.push(event));

    await client.startSession({
      fastMode: false,
      prompt: 'first',
      cwd: process.cwd(),
    });
    await client.continueSession('second');

    const assistantEvents = events.filter((e) => e.type === 'assistant');
    expect(assistantEvents).toHaveLength(2);

    await client.disconnect();
  });

  it('disconnect kills the process', async () => {
    const scriptPath = createMockScript(`
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.type === "user") {
    process.stdout.write(JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess-hang"
    }) + "\\n");
    // Intentionally never send a result — simulate a hanging session
  }
});

// Keep process alive
setInterval(() => {}, 60_000);
`);

    const client = new ClaudeCodeSdkClient();
    client.setCommand(scriptPath);

    const startPromise = client.startSession({
      fastMode: false,
      prompt: 'will hang',
      cwd: process.cwd(),
    });

    // Attach a no-op catch so the rejection doesn't surface as unhandled
    // before we get to the assertion below.
    startPromise.catch(() => {});

    // Give the process time to start and send the init event
    await new Promise((r) => setTimeout(r, 200));
    expect(client.getSessionId()).toBe('sess-hang');

    await client.disconnect();

    await expect(startPromise).rejects.toThrow('Disconnected');
    // A deliberate disconnect clears the session id: the client no longer
    // holds a resumable provider session.
    expect(client.getSessionId()).toBeNull();
  });

  it('handles permission control requests', async () => {
    const scriptPath = createMockScript(`
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let gotUser = false;

rl.on("line", (line) => {
  const msg = JSON.parse(line);

  if (msg.type === "user" && !gotUser) {
    gotUser = true;
    process.stdout.write(JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess-perm"
    }) + "\\n");

    // Send a permission control request
    process.stdout.write(JSON.stringify({
      type: "control_request",
      request: {
        subtype: "can_use_tool",
        request_id: "req-1",
        tool_name: "Write",
        input: { file_path: "/tmp/test.txt", content: "hello" }
      }
    }) + "\\n");
  }

  if (msg.type === "control_response") {
    // Got permission response, send result
    process.stdout.write(JSON.stringify({
      type: "result",
      result: { permissionGranted: true },
      session_id: "sess-perm"
    }) + "\\n");
  }
});
`);

    const client = new ClaudeCodeSdkClient();
    client.setCommand(scriptPath);

    const permissionCalls: Array<{ tool: string; input: unknown }> = [];

    client.onPermissionRequest(async (toolName, input) => {
      permissionCalls.push({ tool: toolName, input });
      return { behavior: 'allow', updatedInput: {} };
    });

    const events: ClaudeCodeSdkEvent[] = [];
    client.onEvent((event) => events.push(event));

    await client.startSession({
      fastMode: false,
      prompt: 'do something',
      cwd: process.cwd(),
    });

    expect(permissionCalls).toHaveLength(1);
    expect(permissionCalls[0]!.tool).toBe('Write');
    expect(client.getSessionId()).toBe('sess-perm');

    await client.disconnect();
  });

  // -- Outbound control_request: getContextUsage ----------------------------

  const buildContextUsageMockScript = (responsePayload: string): string => `
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let gotUser = false;

rl.on("line", (line) => {
  const msg = JSON.parse(line);

  if (msg.type === "user" && !gotUser) {
    gotUser = true;
    process.stdout.write(JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess-ctx"
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      type: "result",
      result: { ok: true },
      session_id: "sess-ctx"
    }) + "\\n");
    return;
  }

  if (msg.type === "control_request" && msg.request?.subtype === "get_context_usage") {
    process.stdout.write(${responsePayload} + "\\n");
  }
});

setInterval(() => {}, 60_000);
`;

  it('resolves getContextUsage with a valid ContextData payload', async () => {
    const validPayload = JSON.stringify(VALID_CONTEXT_DATA);
    const scriptPath = createMockScript(
      buildContextUsageMockScript(`JSON.stringify({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: msg.request_id,
          response: ${validPayload}
        }
      })`),
    );

    const client = new ClaudeCodeSdkClient();
    client.setCommand(scriptPath);

    await client.startSession({
      fastMode: false,
      prompt: 'hi',
      cwd: process.cwd(),
    });

    const result = await client.getContextUsage();
    expect(result.model).toBe('claude-opus-4-7');
    expect(result.maxTokens).toBe(200000);
    expect(result.apiUsage).toBeNull();

    await client.disconnect();
  });

  it('rejects getContextUsage with ControlRequestRemoteError on subtype=error', async () => {
    const scriptPath = createMockScript(
      buildContextUsageMockScript(`JSON.stringify({
        type: "control_response",
        response: {
          subtype: "error",
          request_id: msg.request_id,
          error: "context analysis unavailable"
        }
      })`),
    );

    const client = new ClaudeCodeSdkClient();
    client.setCommand(scriptPath);

    await client.startSession({
      fastMode: false,
      prompt: 'hi',
      cwd: process.cwd(),
    });

    await expect(client.getContextUsage()).rejects.toBeInstanceOf(ControlRequestRemoteError);
    await expect(client.getContextUsage()).rejects.toMatchObject({
      subtype: 'get_context_usage',
      message: expect.stringContaining('context analysis unavailable'),
    });

    await client.disconnect();
  });

  it('rejects getContextUsage with ControlRequestSchemaError on missing required fields', async () => {
    const invalidPayload = JSON.stringify({
      // Missing most required fields
      categories: [],
      model: 'claude-opus-4-7',
    });
    const scriptPath = createMockScript(
      buildContextUsageMockScript(`JSON.stringify({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: msg.request_id,
          response: ${invalidPayload}
        }
      })`),
    );

    const client = new ClaudeCodeSdkClient();
    client.setCommand(scriptPath);

    await client.startSession({
      fastMode: false,
      prompt: 'hi',
      cwd: process.cwd(),
    });

    await expect(client.getContextUsage()).rejects.toBeInstanceOf(ControlRequestSchemaError);

    await client.disconnect();
  });

  it('rejects pending getContextUsage when disconnect() is called mid-flight', async () => {
    // Mock script that never responds to control_request
    const scriptPath = createMockScript(`
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let gotUser = false;

rl.on("line", (line) => {
  const msg = JSON.parse(line);

  if (msg.type === "user" && !gotUser) {
    gotUser = true;
    process.stdout.write(JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess-ctx-disc"
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      type: "result",
      result: { ok: true },
      session_id: "sess-ctx-disc"
    }) + "\\n");
  }
  // Intentionally never respond to control_request
});

setInterval(() => {}, 60_000);
`);

    const client = new ClaudeCodeSdkClient();
    client.setCommand(scriptPath);

    await client.startSession({
      fastMode: false,
      prompt: 'hi',
      cwd: process.cwd(),
    });

    const pending = client.getContextUsage();
    pending.catch(() => {});

    // Give the request a moment to be written to stdin
    await new Promise((r) => setTimeout(r, 50));

    await client.disconnect();

    await expect(pending).rejects.toBeInstanceOf(ControlRequestDisconnectedError);
  });

  // -- Outbound control_request: getUsage -----------------------------------

  const readUsageFixture = (name: string): string =>
    readFileSync(join(__dirname, 'fixtures', name), 'utf8');

  // Answers get_usage without needing a user message, mirroring the real CLI
  // after connectForControl. Records the request so the test can assert on it.
  const buildUsageMockScript = (responseExpression: string, recordPath: string): string => `
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.type === "control_request" && msg.request?.subtype === "get_usage") {
    writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify(msg.request));
    process.stdout.write(${responseExpression} + "\\n");
  }
});

setInterval(() => {}, 60_000);
`;

  const connectUsageClient = async (responseExpression: string) => {
    const directory = mkdtempSync(join(tmpdir(), 'claude-get-usage-'));
    tempDirs.push(directory);
    const recordPath = join(directory, 'request.json');
    const client = new ClaudeCodeSdkClient();
    client.setCommand(createMockScript(buildUsageMockScript(responseExpression, recordPath)));
    await client.connectForControl({
      fastMode: false,
      prompt: '',
      cwd: process.cwd(),
    });
    return { client, recordPath };
  };

  const successReply = (payload: string) => `JSON.stringify({
    type: "control_response",
    response: { subtype: "success", request_id: msg.request_id, response: ${payload} }
  })`;

  it('resolves getUsage with the plan windows and skips the behaviors scan', async () => {
    const { client, recordPath } = await connectUsageClient(
      successReply(readUsageFixture('get-usage-subscriber.json')),
    );

    const usage = await client.getUsage();
    expect(usage).toEqual({
      subscription_type: 'max',
      rate_limits_available: true,
      rate_limits: {
        five_hour: {
          utilization: 23,
          resets_at: '2026-10-14T03:00:00.000000+00:00',
        },
        seven_day: {
          utilization: 41,
          resets_at: '2026-10-19T14:00:00.000000+00:00',
        },
      },
    });
    expect(JSON.parse(readFileSync(recordPath, 'utf8'))).toEqual({
      subtype: 'get_usage',
      skip_behaviors: true,
    });

    await client.disconnect();
  });

  it('accepts the recorded reply for a session without plan limits', async () => {
    const { client } = await connectUsageClient(
      successReply(readUsageFixture('get-usage-unavailable.json')),
    );

    await expect(client.getUsage()).resolves.toEqual({
      subscription_type: null,
      rate_limits_available: false,
      rate_limits: null,
    });

    await client.disconnect();
  });

  it('rejects getUsage with ControlRequestRemoteError when the CLI refuses', async () => {
    const { client } = await connectUsageClient(`JSON.stringify({
      type: "control_response",
      response: {
        subtype: "error",
        request_id: msg.request_id,
        error: "get_usage is not supported in this context"
      }
    })`);

    await expect(client.getUsage()).rejects.toBeInstanceOf(ControlRequestRemoteError);

    await client.disconnect();
  });

  it('rejects getUsage with ControlRequestSchemaError when the reply shape drifts', async () => {
    const { client } = await connectUsageClient(
      successReply(
        JSON.stringify({
          subscription_type: 'max',
          rate_limits_available: true,
          rate_limits: { five_hour: { utilization: '23%', resets_at: null } },
        }),
      ),
    );

    await expect(client.getUsage()).rejects.toBeInstanceOf(ControlRequestSchemaError);

    await client.disconnect();
  });

  // -- Outbound user-message slash command: compact ------------------------

  // Script that boots a session (emits init + result on the first user
  // message) and, for the next user message, emits `compact_boundary` only if
  // that message's content matched the override. This lets the happy-path
  // test verify the `/compact` frame *and* the resolve path in one round trip.
  const buildCompactMockScript = (
    options: { respond: boolean; expectedContent?: string | undefined } = { respond: true },
  ): string => `
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let gotInitialUser = false;

rl.on("line", (line) => {
  const msg = JSON.parse(line);

  if (msg.type === "user" && !gotInitialUser) {
    gotInitialUser = true;
    process.stdout.write(JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess-compact"
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      type: "result",
      result: { ok: true },
      session_id: "sess-compact"
    }) + "\\n");
    return;
  }

  if (msg.type === "user" && gotInitialUser) {
    if (${options.respond ? 'true' : 'false'}) {
      process.stdout.write(JSON.stringify({
        type: "compact_boundary",
        session_id: "sess-compact",
        echoed_content: msg.message?.content,
        echoed_role: msg.message?.role
      }) + "\\n");
    }
  }
});

setInterval(() => {}, 60_000);
`;

  it('resolves compact() when compact_boundary arrives and writes the /compact user frame', async () => {
    const scriptPath = createMockScript(buildCompactMockScript({ respond: true }));

    const client = new ClaudeCodeSdkClient();
    client.setCommand(scriptPath);

    const events: ClaudeCodeSdkEvent[] = [];
    client.onEvent((event) => events.push(event));

    await client.startSession({
      fastMode: false,
      prompt: 'hi',
      cwd: process.cwd(),
    });

    await expect(client.compact()).resolves.toBeUndefined();

    const boundary = events.find((event) => event.type === 'compact_boundary');
    expect(boundary).toMatchObject({
      echoed_content: '/compact',
      echoed_role: 'user',
    });

    await client.disconnect();
  });

  it('rejects compact() with CompactTimeoutError when no compact_boundary arrives in time', async () => {
    const scriptPath = createMockScript(buildCompactMockScript({ respond: false }));

    const client = new ClaudeCodeSdkClient();
    client.setCommand(scriptPath);

    await client.startSession({
      fastMode: false,
      prompt: 'hi',
      cwd: process.cwd(),
    });

    // Switch to fake timers AFTER the child process has booted so its real I/O
    // (init/result on stdout) lands before timer time is virtualized.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const pending = client.compact({ timeoutMs: 5_000 });
      pending.catch(() => {});

      vi.advanceTimersByTime(5_000);

      await expect(pending).rejects.toBeInstanceOf(CompactTimeoutError);
    } finally {
      vi.useRealTimers();
      await client.disconnect();
    }
  });

  it('rejects pending compact() with ControlRequestDisconnectedError when disconnect() is called mid-flight', async () => {
    const scriptPath = createMockScript(buildCompactMockScript({ respond: false }));

    const client = new ClaudeCodeSdkClient();
    client.setCommand(scriptPath);

    await client.startSession({
      fastMode: false,
      prompt: 'hi',
      cwd: process.cwd(),
    });

    const pending = client.compact();
    pending.catch(() => {});

    // Give the request a moment to be written to stdin.
    await new Promise((r) => setTimeout(r, 50));

    await client.disconnect();

    await expect(pending).rejects.toBeInstanceOf(ControlRequestDisconnectedError);
    await expect(pending).rejects.toMatchObject({ subtype: 'compact' });
  });

  it('rejects pending getContextUsage when the abort signal fires', async () => {
    // Mock sends init but never result, so the session stays in-flight and
    // its abort listener stays attached when controller.abort() fires.
    const scriptPath = createMockScript(`
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let gotUser = false;

rl.on("line", (line) => {
  const msg = JSON.parse(line);

  if (msg.type === "user" && !gotUser) {
    gotUser = true;
    process.stdout.write(JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess-ctx-abort"
    }) + "\\n");
    // Intentionally never send result — keep the session in-flight.
  }
  // Intentionally never respond to control_request either.
});

setInterval(() => {}, 60_000);
`);

    const client = new ClaudeCodeSdkClient();
    client.setCommand(scriptPath);

    const controller = new AbortController();
    const startPromise = client.startSession(
      { fastMode: false, prompt: 'hi', cwd: process.cwd() },
      { signal: controller.signal },
    );
    startPromise.catch(() => {});

    // Wait for the child to spawn and emit init.
    await new Promise((r) => setTimeout(r, 200));

    const pending = client.getContextUsage();
    pending.catch(() => {});

    await new Promise((r) => setTimeout(r, 50));
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(ControlRequestAbortedError);
    await expect(startPromise).rejects.toThrow('Aborted');

    await client.disconnect();
  });

  it('abort signal kills the process, not just the pending promise', async () => {
    // Mock sends init but never result, so the session hangs. A broken abort
    // path would reject startSession yet leave this subprocess running; the
    // fix must tear it down. getSessionId() going null is the observable
    // proof the client ran its disconnect/kill teardown — a plain promise
    // rejection leaves the session id intact.
    const scriptPath = createMockScript(`
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.type === "user") {
    process.stdout.write(JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess-abort-kill"
    }) + "\\n");
    // Intentionally never send a result — simulate a hanging session.
  }
});

setInterval(() => {}, 60_000);
`);

    const client = new ClaudeCodeSdkClient();
    client.setCommand(scriptPath);

    const controller = new AbortController();
    const startPromise = client.startSession(
      { fastMode: false, prompt: 'will hang', cwd: process.cwd() },
      { signal: controller.signal },
    );
    startPromise.catch(() => {});

    // Give the process time to start and send the init event.
    await new Promise((r) => setTimeout(r, 200));
    expect(client.getSessionId()).toBe('sess-abort-kill');

    controller.abort();

    await expect(startPromise).rejects.toThrow('Aborted');
    // The teardown ran: the subprocess was killed and the session id cleared.
    expect(client.getSessionId()).toBeNull();

    await client.disconnect();
  });
});
