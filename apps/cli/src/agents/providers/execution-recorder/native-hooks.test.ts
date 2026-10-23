import { describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ClaudeCodeSdkClient,
  CodexSdkClient,
  toolExecutionHookSettings,
} from '../../../agent-runtime/index';
import { ExecutionRecorder } from './execution-recorder';
import { CodexExecutionCaptureHooks } from '../codex/execution-capture-hooks';
import { ClaudeExecutionCaptureHooks } from '../claude/execution-capture-hooks';
import { NOOP_LOGGER } from '../../../server/logger';

const exec = promisify(execFile);

// Native runtimes, deterministic local model responses, no credentials or external model calls.
// The Codex trust bypass is confined to this freshly created home containing ONLY this test's hook.
describe.each(['codex', 'claude'] as const)('installed %s native hook smoke', (provider) => {
  it.each([false, true])(
    'retains a failed native shell write (delayed=%s)',
    async (delayed) => {
      const installed = (await exec(provider, ['--version'])).stdout.trim();
      expect(installed).toMatch(
        provider === 'codex' ? /^codex-cli \d+\.\d+\.\d+$/ : /^\d+\.\d+\.\d+ \(Claude Code\)$/,
      );
      const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hh-native-')));
      const root = path.join(directory, 'repo');
      const home = path.join(directory, 'home');
      await fs.mkdir(root);
      await fs.mkdir(home);
      await exec('git', ['init', '-q', root]);
      await fs.writeFile(path.join(root, 'dirty.txt'), 'before native hook');
      const diagnostics: object[] = [];
      const logger = {
        trace: NOOP_LOGGER.trace.bind(NOOP_LOGGER),
        info: NOOP_LOGGER.info.bind(NOOP_LOGGER),
        warn: NOOP_LOGGER.warn.bind(NOOP_LOGGER),
        error: NOOP_LOGGER.error.bind(NOOP_LOGGER),
        child: NOOP_LOGGER.child.bind(NOOP_LOGGER),
        debug: (event: string, fields?: object) => {
          diagnostics.push({ event, fields });
        },
      };
      const recorder = new ExecutionRecorder(path.join(directory, 'evidence'), logger);
      const adapter =
        provider === 'codex'
          ? new CodexExecutionCaptureHooks(recorder, logger)
          : new ClaudeExecutionCaptureHooks(recorder, logger);
      const capture = await adapter.session.start({
        sessionId: 'native-agent-session',
        runId: 'native-run',
        turnId: 'native-turn',
        provider,
        roots: [{ serviceId: 'native-service', root }],
        harnessVersion: installed,
      });
      expect(capture).toBeDefined();
      const command = `${delayed ? 'sleep 2; ' : ''}printf 'after native hook' > dirty.txt; exit 7`;
      let requests = 0;
      const server = http.createServer((request, response) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
          body += chunk;
        });
        request.on('end', () => {
          if (request.url === '/' || request.url === '/api/hello') {
            response.writeHead(200).end('{}');
            return;
          }
          if (request.url?.includes('count_tokens')) {
            response.setHeader('content-type', 'application/json');
            response.end('{"input_tokens":10}');
            return;
          }
          const data = JSON.parse(body || '{}');
          diagnostics.push({
            modelRequest: request.url,
            tools: data.tools?.map((tool: { name?: string }) => tool.name),
            model: data.model,
          });
          const first = requests++ === 0;
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          const emit = (event: string, value: object) =>
            response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
          if (provider === 'codex') {
            const tool = data.tools?.find((tool: { name?: string }) =>
              ['exec_command', 'shell_command', 'shell'].includes(tool.name ?? ''),
            );
            const name = tool?.name ?? 'exec_command';
            const args =
              name === 'exec_command'
                ? { cmd: command, yield_time_ms: 1000 }
                : name === 'shell_command'
                  ? { command }
                  : { command: ['/bin/sh', '-c', command] };
            const lastOutput = data.input
              ?.filter((item: { type: string }) => item.type === 'function_call_output')
              .at(-1);
            const processSession = JSON.stringify(lastOutput ?? '').match(
              /Process running with session ID (\d+)/,
            )?.[1];
            const item = first
              ? {
                  type: 'function_call',
                  id: 'fc_native',
                  call_id: 'call_native',
                  name,
                  arguments: JSON.stringify(args),
                  status: 'completed',
                }
              : processSession
                ? {
                    type: 'function_call',
                    id: `fc_poll_${requests}`,
                    call_id: `poll_${requests}`,
                    name: 'write_stdin',
                    arguments: JSON.stringify({
                      session_id: Number(processSession),
                      chars: '',
                      yield_time_ms: 1000,
                    }),
                    status: 'completed',
                  }
                : {
                    type: 'message',
                    id: 'msg_native',
                    role: 'assistant',
                    status: 'completed',
                    content: [{ type: 'output_text', text: 'Done.', annotations: [] }],
                  };
            emit('response.created', {
              type: 'response.created',
              response: { id: `response_${requests}`, status: 'in_progress', output: [] },
            });
            emit('response.output_item.added', {
              type: 'response.output_item.added',
              output_index: 0,
              item,
            });
            emit('response.output_item.done', {
              type: 'response.output_item.done',
              output_index: 0,
              item,
            });
            emit('response.completed', {
              type: 'response.completed',
              response: {
                id: `response_${requests}`,
                status: 'completed',
                output: [item],
                usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
              },
            });
          } else {
            emit('message_start', {
              type: 'message_start',
              message: {
                id: `msg_${requests}`,
                type: 'message',
                role: 'assistant',
                model: 'claude-sonnet-4-6',
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 10, output_tokens: 0 },
              },
            });
            emit('content_block_start', {
              type: 'content_block_start',
              index: 0,
              content_block: first
                ? { type: 'tool_use', id: 'call_native', name: 'Bash', input: {} }
                : { type: 'text', text: '' },
            });
            emit('content_block_delta', {
              type: 'content_block_delta',
              index: 0,
              delta: first
                ? {
                    type: 'input_json_delta',
                    partial_json: JSON.stringify({ command, timeout: 10000 }),
                  }
                : { type: 'text_delta', text: 'Done.' },
            });
            emit('content_block_stop', { type: 'content_block_stop', index: 0 });
            emit('message_delta', {
              type: 'message_delta',
              delta: { stop_reason: first ? 'tool_use' : 'end_turn', stop_sequence: null },
              usage: { output_tokens: 10 },
            });
            emit('message_stop', { type: 'message_stop' });
          }
          response.end();
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No fixture port');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const wrapper = path.join(directory, 'native.cjs');
      const client = provider === 'codex' ? new CodexSdkClient() : new ClaudeCodeSdkClient();
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 30000);
      try {
        if (provider === 'codex') {
          await fs.writeFile(
            path.join(home, 'hooks.json'),
            JSON.stringify({ hooks: toolExecutionHookSettings('codex', capture!.command) }),
          );
          await fs.writeFile(
            wrapper,
            `const {spawn}=require('node:child_process');const child=spawn('codex',['--dangerously-bypass-hook-trust','app-server'],{stdio:'inherit',env:{...process.env,CODEX_HOME:${JSON.stringify(home)}}});process.on('SIGTERM',()=>child.kill('SIGTERM'));child.on('exit',code=>process.exit(code??1));`,
          );
          if (
            !(client instanceof CodexSdkClient) ||
            !(adapter instanceof CodexExecutionCaptureHooks)
          )
            throw new Error('Fixture provider mismatch');
          client.setCommand(wrapper);
          client.onEvent((event) => {
            diagnostics.push({
              native: event.method,
              ...(event.method.includes('hook') ||
              event.method === 'error' ||
              event.method === 'warning'
                ? { params: event.params }
                : {}),
            });
            adapter.observe(event, client.getRootTurnIdentity());
          });
          client.onServerRequest((request) =>
            client.submitClientResponse(request.id, { decision: 'decline' }),
          );
          await client.startSession(
            {
              prompt: 'Execute the fixture command.',
              cwd: root,
              model: 'fixture',
              sandbox: 'workspace-write',
              toolExecutionHooks: capture!,
              config: {
                model_provider: 'fixture',
                model_providers: {
                  fixture: {
                    name: 'fixture',
                    base_url: `${baseUrl}/v1`,
                    wire_api: 'responses',
                    requires_openai_auth: false,
                  },
                },
                approval_policy: 'never',
                web_search: 'disabled',
                bypass_hook_trust: true,
              },
            },
            { signal: abort.signal },
          );
        } else {
          await fs.writeFile(
            wrapper,
            `const {spawn}=require('node:child_process');const child=spawn('claude',process.argv.slice(2),{stdio:'inherit',env:{...process.env,CLAUDE_CONFIG_DIR:${JSON.stringify(home)},ANTHROPIC_API_KEY:'fixture-key',ANTHROPIC_BASE_URL:${JSON.stringify(baseUrl)},CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'}});process.on('SIGTERM',()=>child.kill('SIGTERM'));child.on('exit',code=>process.exit(code??1));`,
          );
          if (
            !(client instanceof ClaudeCodeSdkClient) ||
            !(adapter instanceof ClaudeExecutionCaptureHooks)
          )
            throw new Error('Fixture provider mismatch');
          client.setCommand(wrapper);
          client.onEvent((event) => {
            diagnostics.push({
              native: event.type,
              subtype: event.subtype,
              ...(event.type === 'result' || event.type === 'user' ? { fixtureEvent: event } : {}),
            });
            adapter.observe(event);
          });
          client.onPermissionRequest(async (_name, input) => ({
            behavior: 'allow',
            updatedInput: input as Record<string, unknown>,
          }));
          await client.startSession(
            {
              prompt: 'Execute the fixture command.',
              cwd: root,
              model: 'claude-sonnet-4-6',
              fastMode: false,
              permissionMode: 'bypassPermissions',
              builtinTools: ['Bash'],
              allowedTools: ['Bash'],
              toolExecutionHooks: capture!,
            },
            { signal: abort.signal },
          );
        }
        await adapter.session.end();
        expect(
          await fs.readFile(path.join(root, 'dirty.txt'), 'utf8'),
          JSON.stringify(diagnostics),
        ).toBe('after native hook');
        const observations = await recorder.store.read();
        expect(observations).toHaveLength(1);
        const observation = observations[0]!;
        expect(observation.before, JSON.stringify(diagnostics)).not.toBeNull();
        expect(observation.after).not.toBeNull();
        const before = observation.before!.entries.find((entry) => entry.path === 'dirty.txt')!;
        const after = observation.after!.entries.find((entry) => entry.path === 'dirty.txt')!;
        expect((await recorder.store.readBlob(before.hash!)).toString()).toBe('before native hook');
        expect((await recorder.store.readBlob(after.hash!)).toString()).toBe('after native hook');
        expect(observation.outcome).toBe('failure');
        expect(observation.gaps).toContain('writer_lifetime_unresolved');
      } finally {
        clearTimeout(timeout);
        await client.disconnect();
        await adapter.session.close();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        // Native shutdown can still be closing background cache writers after
        // the SDK disconnects; retry removal of this disposable home only.
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    },
    45000,
  );
});
