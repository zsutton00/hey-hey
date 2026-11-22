import { describe, expect, it, vi } from 'vitest';
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
import { OAuthClient } from '../../../auth';
import { createTestRun, createTestRunStore } from '../../../run/run.test-support';
import type { Turn } from '../../../turn/turn';
import { LocalAgentEndpoint } from '../../../server/local-base-url';
import { ProjectMaturity } from '../../../shared/api/index';
import { SubmissionToolRegistry } from '../../submission-tools/registry';
import { RunWorkspaceWriteBoundary } from '../../workspace-write-boundary';
import { IsolatedProviderWorkingDirectory } from '../isolated-provider-working-directory';
import { AntigravityAgentSessionRunner } from '../antigravity/session-runner-antigravity';

// The platform prompt context is the only network read the Antigravity runner makes besides agy.
vi.mock('../../prompts/session-start-context', () => ({
  readSessionStartContext: async () => ({
    workItemTypeDefinitions: [],
    maturity: ProjectMaturity.Established,
    intentFirst: false,
    hintsEnabled: false,
    productDevelopment: false,
  }),
}));

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
          // Make the fixture the app-server's own provider, not only a per-thread override.
          await fs.writeFile(
            path.join(home, 'config.toml'),
            [
              'model_provider = "fixture"',
              '[model_providers.fixture]',
              'name = "fixture"',
              `base_url = "${baseUrl}/v1"`,
              'wire_api = "responses"',
              'requires_openai_auth = false',
              '',
            ].join('\n'),
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

/**
 * agy has no local model endpoint, so this case spends the signed-in account's real model quota
 * and runs only when HEY_HEY_NATIVE_AGY=1. It drives the shipped runner: the hook file in the
 * isolated launch directory, `--include-default-customizations=false`, the anchored matcher, and
 * the Run sandbox with its private HOME.
 */
describe.skipIf(process.env['HEY_HEY_NATIVE_AGY'] !== '1')(
  'installed antigravity native hook',
  () => {
    const launch = async (directory: string, recorder: ExecutionRecorder | undefined) => {
      const service = path.join(directory, 'repo');
      await fs.mkdir(service, { recursive: true });
      await exec('git', ['init', '-q', service]);
      const workspace = {
        ok: true as const,
        runMode: 'default' as const,
        repositoryPathForRunStarted: service,
        cwd: service,
        allowedRepositoryRoots: [service],
        bindingRepositoryPath: service,
        workspaceRoot: null,
      };
      const boundary = await RunWorkspaceWriteBoundary.create(workspace, {
        runScopeId: `agy-native-${path.basename(directory)}`,
        providerStateRoot: path.join(directory, 'state'),
      });
      const base = createTestRun({ provider: 'antigravity' });
      const run = createTestRun({
        provider: 'antigravity',
        session: {
          ...base.session,
          provider: 'antigravity',
          services: [{ id: 'native-service', path: service }],
        },
      });
      run.activeTurn = { turnId: 'native-turn' } as Turn;
      vi.spyOn(run, 'onAgentOutput').mockImplementation(() => {});
      const diagnostics: object[] = [];
      const record = (event: string, fields?: object) => {
        diagnostics.push({ event, fields });
      };
      const logger = {
        trace: NOOP_LOGGER.trace.bind(NOOP_LOGGER),
        info: NOOP_LOGGER.info.bind(NOOP_LOGGER),
        error: record,
        warn: record,
        debug: record,
        child: () => logger,
      };
      const runner = new AntigravityAgentSessionRunner({
        agentOutputOwner: run,
        runStore: createTestRunStore(),
        submissionToolRegistry: new SubmissionToolRegistry(),
        oauthClient: new OAuthClient(),
        localAgentEndpoint: new LocalAgentEndpoint(),
        logger,
        ...(recorder ? { executionRecorder: recorder } : {}),
      });
      const created = vi.spyOn(IsolatedProviderWorkingDirectory, 'create');
      const { launchServiceId: _launch, ...session } = run.session;
      const target = path.join(service, 'native-probe.txt');
      const writeProbe = () =>
        prompt(
          `Use your file writing tool once to create ${target} containing exactly: probe. Do nothing else.`,
        );
      const prompt = (text: string) =>
        runner.runPrompt({
          session: { ...session, workspaceBound: true },
          prompt: text,
          skipPermissions: true,
          workspace,
          workspaceWriteBoundary: boundary,
        });
      const launchDirectory = async () => (await created.mock.results[0]!.value).path as string;
      const dispose = async () => {
        created.mockRestore();
        await runner.dispose();
        await boundary.dispose();
      };
      return { target, writeProbe, launchDirectory, dispose, diagnostics };
    };

    it('captures a real write before and after, and gives agy no hook while tracking is off', async () => {
      const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hh-agy-')));
      try {
        // Tracking on: one real prompt that writes one file.
        const recorder = new ExecutionRecorder(path.join(directory, 'evidence'), NOOP_LOGGER);
        const tracked = await launch(path.join(directory, 'tracked'), recorder);
        const { target } = tracked;
        try {
          await tracked.writeProbe();
          const hookFile = path.join(await tracked.launchDirectory(), '.agents', 'hooks.json');
          expect(JSON.parse(await fs.readFile(hookFile, 'utf8'))).toHaveProperty('hey-hey-capture');
        } finally {
          await tracked.dispose();
        }
        const evidence = JSON.stringify(tracked.diagnostics);
        expect(await fs.readFile(target, 'utf8'), evidence).toBe('probe');
        const observations = await recorder.store.read();
        const write = observations.find(({ identity }) => identity.toolName === 'Write');
        expect(write, evidence).toBeDefined();
        expect(write!.identity.provider).toBe('antigravity');
        expect(write!.outcome).toBe('success');
        const before = write!.before!.entries.find((entry) => entry.path === 'native-probe.txt');
        const after = write!.after!.entries.find((entry) => entry.path === 'native-probe.txt')!;
        expect(before?.hash ?? null).toBeNull();
        expect((await recorder.store.readBlob(after.hash!)).toString()).toBe('probe');
        const coverage = await fs
          .readdir(path.join(directory, 'evidence', 'coverage'))
          .catch(() => []);
        const reasons = await Promise.all(
          coverage.map(async (name) => {
            const text = await fs.readFile(
              path.join(directory, 'evidence', 'coverage', name),
              'utf8',
            );
            return (JSON.parse(text) as { payload: { reason: string } }).payload.reason;
          }),
        );
        expect(reasons, evidence).not.toContain('hook_not_observed');
        expect(reasons, evidence).not.toContain('identity_unresolved');

        // Tracking off: the same write runs, but agy is given no hook and nothing is recorded.
        const untracked = await launch(path.join(directory, 'untracked'), undefined);
        try {
          await untracked.writeProbe();
          await expect(
            fs.access(path.join(await untracked.launchDirectory(), '.agents', 'hooks.json')),
          ).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
          await untracked.dispose();
        }
        expect(
          await fs.readFile(untracked.target, 'utf8'),
          JSON.stringify(untracked.diagnostics),
        ).toBe('probe');
        expect(await recorder.store.read()).toHaveLength(observations.length);
      } finally {
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }, 180000);
  },
);
