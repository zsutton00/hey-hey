import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OAuthClient } from '../../../auth/index';
import type { Run } from '../../../run/run';
import type { RunStore } from '../../../run-store/run-store';
import type { LocalAgentEndpoint } from '../../../server/local-base-url';
import type { ServerLogger } from '../../../server/logger';
import type { LocalContextData } from '../../../shared/agent-bridge-contract/contract';
import { buildBrowserToolsMcpConfig } from '../../browser-tools/mcp-config';
import { resolveHintPromptAccess } from '../../mcp-server-config';
import { buildPlatformMcpProxyMcpConfig } from '../../platform-mcp-proxy/mcp-config';
import { buildPlatformSystemPrompt } from '../../prompts/common';
import { readSessionStartContext } from '../../prompts/session-start-context';
import { buildSubmissionToolsMcpConfig } from '../../submission-tools/mcp-config';
import type { SubmissionToolRegistry } from '../../submission-tools/registry';
import { IsolatedProviderWorkingDirectory } from '../isolated-provider-working-directory';
import { RunAttachmentContentReader } from '../run-attachment-content-reader';
import { nativeProviderSessionId, recordPermissionDecisionSubmitted } from '../runner-common';
import {
  AgentSessionRunnerError,
  type AgentRunResult,
  type AgentSessionRunner,
  type PermissionDecisionDispatchArgs,
  type PermissionDecisionDispatchResult,
  type ResumeArgs,
  type RunPromptArgs,
} from '../session-runner';
import {
  AcpRequestError,
  AntigravityAcpClient,
  type AcpHttpServer,
  type AcpPromptContent,
} from './acp-client';
import type { AcpInboundCall } from './acp-schemas';
import {
  mapAntigravityPermission,
  mapAntigravityUpdate,
  normalizeAntigravityEvent,
} from './antigravity-event-mapper';

type PermissionRequest = Extract<AcpInboundCall, { method: 'session/request_permission' }>;
type PromptArgs = RunPromptArgs | ResumeArgs;

interface Dependencies {
  runStore: RunStore;
  oauthClient: OAuthClient;
  submissionToolRegistry: SubmissionToolRegistry;
  localAgentEndpoint: LocalAgentEndpoint;
  agentOutputOwner: Run;
  logger: ServerLogger;
}

interface ActivePrompt {
  narration: string[];
  skipPermissions: boolean;
}

export class AntigravityAgentSessionRunner implements AgentSessionRunner {
  private readonly attachments = new RunAttachmentContentReader();
  private readonly permissions = new Map<string, PermissionRequest>();
  private directory: IsolatedProviderWorkingDirectory | undefined;
  private client: AntigravityAcpClient | undefined;
  private sessionId: string | null = null;
  private mountIdentity: string | undefined;
  private agentName: string | undefined;
  private busy = false;
  private activePrompt: ActivePrompt | undefined;
  private usage: { used: number; size: number } | undefined;
  private model: string | undefined;
  private expectedMode: 'default' | undefined;

  constructor(private readonly dependencies: Dependencies) {}

  runPrompt(args: RunPromptArgs): Promise<AgentRunResult> {
    return this.run(args, null, args);
  }

  resumeSession(args: ResumeArgs): Promise<AgentRunResult> {
    const resumeId = nativeProviderSessionId(
      args.providerSessionId ?? args.session.provider_session_id ?? null,
    );
    return this.run(args, resumeId ?? this.sessionId);
  }

  async getContextUsage(providerSessionId?: string): Promise<LocalContextData> {
    if (!this.sessionId || (providerSessionId && providerSessionId !== this.sessionId)) {
      throw new AgentSessionRunnerError('NO_ACTIVE_SESSION', 'No matching Antigravity session.');
    }
    if (!this.usage || !this.model) {
      throw new AgentSessionRunnerError(
        'NOT_SUPPORTED',
        'Antigravity has not reported context usage and model.',
      );
    }
    const { used, size } = this.usage;
    return {
      totalTokens: used,
      maxTokens: size,
      rawMaxTokens: size,
      percentage: (used / size) * 100,
      model: this.model,
      categories: [],
      gridRows: [],
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      isAutoCompactEnabled: false,
      apiUsage: null,
    };
  }

  async submitPermissionDecision({
    dispatch,
    session,
  }: PermissionDecisionDispatchArgs): Promise<PermissionDecisionDispatchResult> {
    const request = this.permissions.get(dispatch.routing.requestId);
    if (!request || !this.client || dispatch.agentType !== 'antigravity') {
      return { delivered: false, outcome: 'stale', reason: 'request_not_found' };
    }
    this.permissions.delete(dispatch.routing.requestId);
    const kind = dispatch.callbackPayload.kind;
    const option = request.params.options.find((entry) => entry.kind === kind);
    if (!option) {
      this.dependencies.logger.warn('antigravity.permission.option_missing', {
        requestId: dispatch.routing.requestId,
        kind,
      });
    }
    this.client.respondToPermission(request.id, option);
    await recordPermissionDecisionSubmitted({
      dispatch,
      agenticSessionId: session.agentic_session_id,
      runStore: this.dependencies.runStore,
      emitRawEvent: (event) => this.dependencies.agentOutputOwner.onAgentOutput({ event }),
    });
    return { delivered: true, callbackType: dispatch.callbackType };
  }

  async discardSession(): Promise<void> {
    this.client?.dispose();
    this.client = undefined;
    this.sessionId = null;
    this.usage = undefined;
    this.model = undefined;
    this.expectedMode = undefined;
    this.mountIdentity = undefined;
    this.agentName = undefined;
    const directory = this.directory;
    this.directory = undefined;
    await directory?.cleanup();
  }

  dispose(): Promise<void> {
    return this.discardSession();
  }

  private async run(args: PromptArgs, resumeId: string | null, fresh?: RunPromptArgs) {
    const { logger } = this.dependencies;
    if (
      args.workspace ||
      args.workspaceWriteBoundary ||
      args.session.services?.length ||
      args.session.launchServiceId ||
      args.session.workspaceBound ||
      args.session.scope
    ) {
      const error = new AgentSessionRunnerError(
        'ANTIGRAVITY_CONTAINMENT_REQUIRED',
        'Antigravity requires workspace write containment before it can run against a repository.',
      );
      logger.warn('antigravity.run.refused', {
        runId: args.session.agentic_session_id,
        code: error.code,
      });
      throw error;
    }
    if (this.busy) {
      throw new AgentSessionRunnerError('RUN_BUSY', 'Antigravity already has an active prompt.');
    }
    if (!fresh && !resumeId) {
      throw new AgentSessionRunnerError(
        'PROVIDER_SESSION_ID_MISSING',
        'Antigravity resume requires a provider session ID.',
      );
    }
    this.busy = true;
    try {
      args.signal?.throwIfAborted();
      if (fresh || (this.sessionId && this.sessionId !== resumeId)) {
        await this.discardSession();
      }
      const mcpServers = this.serversFor(args);
      const mountIdentity = JSON.stringify(mcpServers);
      if (!this.client || this.mountIdentity !== mountIdentity) {
        // Platform and browser mounts expire with the Turn. Attach their current
        // URLs by resuming the same native session in a new ACP process.
        this.client?.dispose();
        this.client = undefined;
        this.expectedMode = undefined;
        this.directory ??= await IsolatedProviderWorkingDirectory.create();
        const cwd = this.directory.path;
        if (!this.agentName) {
          await this.writeAgent(cwd, fresh);
        }
        const config = { cwd, mcpServers };
        const client = new AntigravityAcpClient(
          cwd,
          logger,
          (update) => this.onUpdate(update),
          (request) => this.onPermission(request),
          ['--agent', 'heyhey-run', '--include-default-customizations=false'],
        );
        this.client = client;
        await client.initialize();
        if (resumeId) {
          const resumed = await client.resumeSession(resumeId, config);
          if (resumed.sessionId && resumed.sessionId !== resumeId) {
            throw new AgentSessionRunnerError(
              'RUN_FAILED',
              'Antigravity returned a different session ID on resume.',
            );
          }
          this.sessionId = resumeId;
          this.model = resumed.models?.currentModelId;
        } else {
          const created = await client.createSession(config);
          this.sessionId = created.sessionId;
          this.model = created.models?.currentModelId;
        }
        this.mountIdentity = mountIdentity;
        this.emit(this.sessionId, 'session_started', { messageType: 'provider_event' });
      }

      const client = this.client;
      const sessionId = this.sessionId;
      if (!sessionId) {
        throw new AgentSessionRunnerError(
          'PROVIDER_SESSION_ID_MISSING',
          'Antigravity did not return a session ID.',
        );
      }
      const mode = 'default';
      if (this.expectedMode !== mode) {
        this.expectedMode = mode;
        await client.setMode(sessionId, mode);
      }

      if (args.prompt !== undefined) {
        const attachments = await this.attachments.read(
          args.attachmentRunId,
          args.attachments ?? [],
          logger,
        );
        const content: AcpPromptContent[] = [{ type: 'text', text: args.prompt }];
        for (const attachment of attachments) {
          content.push(
            attachment.kind === 'image'
              ? { type: 'image', data: attachment.data, mimeType: attachment.mediaType }
              : { type: 'text', text: `Attachment (${attachment.fileName}):\n${attachment.text}` },
          );
        }
        args.signal?.throwIfAborted();
        const prompt: ActivePrompt = {
          narration: [],
          skipPermissions: args.skipPermissions === true,
        };
        this.activePrompt = prompt;
        const cancel = () => {
          try {
            client.cancel(sessionId);
          } catch (error) {
            logger.warn('antigravity.cancel.failed', { sessionId, error: String(error) });
          }
        };
        args.signal?.addEventListener('abort', cancel, { once: true });
        try {
          const result = await client.prompt(sessionId, content);
          args.signal?.removeEventListener('abort', cancel);
          if (result.stopReason === 'cancelled') {
            this.dependencies.agentOutputOwner.activeTurn?.abort();
          }
          if (result.stopReason === 'cancelled' || args.signal?.aborted) {
            throw new DOMException('Antigravity prompt cancelled.', 'AbortError');
          }
          if (result.stopReason !== 'end_turn') {
            throw new AgentSessionRunnerError(
              'RUN_FAILED',
              `Antigravity stopped with reason ${result.stopReason}.`,
            );
          }
          const text = prompt.narration.join('');
          if (text) {
            this.emit(
              sessionId,
              'agent_output',
              { messageType: 'assistant', summary: text, taskComplete: true },
              {
                narration: { delivery: 'message', text, isFinal: true },
              },
            );
          }
        } finally {
          args.signal?.removeEventListener('abort', cancel);
        }
      }
      return { providerSessionId: sessionId, providerConversationId: null, errorCount: 0 };
    } catch (error) {
      if (args.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        throw error;
      }
      this.client?.dispose();
      this.client = undefined;
      const runnerError =
        error instanceof AgentSessionRunnerError
          ? error
          : error instanceof AcpRequestError
            ? new AgentSessionRunnerError(
                /quota|resource.exhausted|rate.limit/i.test(error.message)
                  ? 'MODEL_CAPACITY'
                  : 'RUN_FAILED',
                `Antigravity ACP ${error.method} failed (${error.code}): ${error.message}`,
                error,
              )
            : new AgentSessionRunnerError(
                'RUN_FAILED',
                `Antigravity could not run: ${String(error)}`,
                error,
              );
      logger.warn('antigravity.run.failed', {
        providerSessionId: this.sessionId,
        code: runnerError.code,
        message: runnerError.message,
      });
      throw runnerError;
    } finally {
      this.activePrompt = undefined;
      this.permissions.clear();
      this.busy = false;
    }
  }

  private serversFor(args: PromptArgs): AcpHttpServer[] {
    const { localAgentEndpoint, submissionToolRegistry } = this.dependencies;
    const cliBaseUrl = localAgentEndpoint.get();
    const registration = submissionToolRegistry.getByRunId(args.session.agentic_session_id);
    const submissionTools = registration?.tools ?? [];
    if (!cliBaseUrl) {
      if (args.platformMcpProxyMount || args.browserMcpMount || submissionTools.length > 0) {
        throw new AgentSessionRunnerError(
          'RUN_FAILED',
          'Antigravity MCP mounts require the CLI HTTP endpoint.',
        );
      }
      return [];
    }
    const servers = [];
    if (args.platformMcpProxyMount) {
      servers.push(
        buildPlatformMcpProxyMcpConfig({ mount: args.platformMcpProxyMount, cliBaseUrl }),
      );
    }
    if (registration && submissionTools.length > 0) {
      servers.push(
        buildSubmissionToolsMcpConfig({
          token: registration.token,
          cliBaseUrl,
          tools: submissionTools,
        }),
      );
    }
    if (args.browserMcpMount) {
      servers.push(buildBrowserToolsMcpConfig(args.browserMcpMount, cliBaseUrl));
    }
    return servers.map(({ serverName, serverEntry }) => ({
      type: 'http',
      name: serverName,
      url: serverEntry.url,
      headers: [],
    }));
  }

  private async writeAgent(cwd: string, args?: RunPromptArgs): Promise<void> {
    const prompt = args ? await this.platformPrompt(args) : '';
    const agentDirectory = path.join(cwd, '.agents', 'agents');
    await mkdir(agentDirectory, { recursive: true });
    const agentName = 'heyhey-run';
    await writeFile(
      path.join(agentDirectory, `${agentName}.md`),
      [
        '---',
        `name: ${agentName}`,
        'description: Hey Hey Run agent',
        'subagent: false',
        'inheritMcp: false',
        'inheritCustomizations: false',
        '---',
        prompt,
      ].join('\n'),
      { mode: 0o600 },
    );
    this.agentName = agentName;
  }

  private async platformPrompt(args: RunPromptArgs): Promise<string> {
    const context = await readSessionStartContext({
      oauthClient: this.dependencies.oauthClient,
      projectId: args.session.contextMetadata.projectId,
    });
    return buildPlatformSystemPrompt(
      context.workItemTypeDefinitions,
      {
        provider: 'antigravity',
        model: args.model ?? args.session.model ?? null,
        ...args.promptDeclarations,
      },
      {
        provider: 'antigravity',
        intentFirst: context.intentFirst,
        maturity: context.maturity,
        hints: resolveHintPromptAccess(context.hintsEnabled, args.additionalAllowedTools ?? []),
        hintsProductDevelopment: context.hintsProductDevelopment,
      },
    );
  }

  private eventContext(sessionId: string) {
    return {
      runId: this.dependencies.agentOutputOwner.runId,
      sessionId,
      timestamp: new Date().toISOString(),
    };
  }

  private emit(
    sessionId: string,
    type: string,
    payload: Record<string, unknown>,
    activity?: Parameters<typeof normalizeAntigravityEvent>[3],
  ) {
    this.dependencies.agentOutputOwner.onAgentOutput({
      event: normalizeAntigravityEvent(this.eventContext(sessionId), type, payload, activity),
    });
  }

  private onUpdate({
    sessionId,
    update,
  }: Extract<AcpInboundCall, { method: 'session/update' }>['params']): void {
    if (sessionId !== this.sessionId) {
      return;
    }
    if (
      update.sessionUpdate === 'current_mode_update' &&
      this.expectedMode &&
      update.currentModeId !== this.expectedMode
    ) {
      this.dependencies.logger.warn('antigravity.mode.mismatch', {
        sessionId,
        expected: this.expectedMode,
        reported: update.currentModeId,
      });
    }
    if (update.sessionUpdate === 'usage_update') {
      this.usage = update;
    }
    if (!this.activePrompt) {
      return;
    }
    if (update.sessionUpdate === 'agent_message_chunk') {
      this.activePrompt.narration.push(update.content.text);
    }
    const event = mapAntigravityUpdate(
      this.eventContext(sessionId),
      update,
      this.dependencies.logger,
    );
    if (event) {
      this.dependencies.agentOutputOwner.onAgentOutput({ event });
    }
  }

  private onPermission(request: PermissionRequest): void {
    const { id, params } = request;
    const prompt = this.activePrompt;
    if (!prompt || params.sessionId !== this.sessionId) {
      this.client?.respondToPermission(id, undefined);
      return;
    }
    if (prompt.skipPermissions) {
      const kind = 'allow_once';
      this.dependencies.logger.debug('antigravity.permission.automatic', {
        id,
        kind,
        sessionId: params.sessionId,
      });
      this.client?.respondToPermission(
        id,
        params.options.find((option) => option.kind === kind),
      );
      return;
    }
    const requestId = randomUUID();
    this.permissions.set(requestId, request);
    this.dependencies.agentOutputOwner.onAgentOutput({
      event: mapAntigravityPermission(this.eventContext(params.sessionId), requestId, params),
    });
  }
}
