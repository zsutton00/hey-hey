import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OAuthClient } from '../../../auth/index';
import type { Run } from '../../../run/run';
import type { AgentSkillCatalog } from '../agent-skills';
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
import {
  WorkspaceWriteOutsideRunError,
  type RunWorkspaceWriteBoundary,
} from '../../workspace-write-boundary';
import type { ExecutionRecorder } from '../execution-recorder/execution-recorder';
import { IsolatedProviderWorkingDirectory } from '../isolated-provider-working-directory';
import { RunAttachmentContentReader } from '../run-attachment-content-reader';
import type { ToolRuleStore } from '../../../session/tool-rules';
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
import type { AcpConfigOptions, AcpInboundCall, AcpPromptUsage } from './acp-schemas';
import { z } from 'zod';
import { AntigravityNotReadyError } from './antigravity-readiness';
import { listAntigravitySkills } from './antigravity-skill-catalog';
import { looksLikeHeyHeyTool, TurnToolGrant } from './turn-tool-grant';
import { AntigravityExecutionCaptureHooks } from './execution-capture-hooks';
import {
  antigravityRuleKey,
  antigravityWriteTargetSources,
  mapAntigravityPermission,
  mapAntigravityUpdate,
  normalizeAntigravityEvent,
} from './antigravity-event-mapper';

/** Enough of a rejected path to tell a real path from file contents in the log. */
const PATH_PREVIEW_CHARS = 120;

type PermissionRequest = Extract<AcpInboundCall, { method: 'session/request_permission' }>;
type PromptArgs = RunPromptArgs | ResumeArgs;

/** An Error's message; anything else is stringified without throwing. */
const describeCause = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  try {
    return typeof error === 'string' ? error : (JSON.stringify(error) ?? String(error));
  } catch {
    return String(error);
  }
};

interface Dependencies {
  runStore: RunStore;
  toolRuleStore: ToolRuleStore;
  oauthClient: OAuthClient;
  submissionToolRegistry: SubmissionToolRegistry;
  localAgentEndpoint: LocalAgentEndpoint;
  agentOutputOwner: Run;
  logger: ServerLogger;
  /** Present only for a Run started with precise file change tracking on. */
  executionRecorder?: ExecutionRecorder;
}

interface ActivePrompt {
  /** Chunks of the passage being streamed; flushed at a tool call or turn end. */
  passage: string[];
  lastWriteRefusal?: string;
  skipPermissions: boolean;
  /** Hey Hey tools this turn grants; lives and dies with the prompt, apart from remembered rules. */
  grant: TurnToolGrant;
  phase?: 'thinking' | 'writing';
}

const PROMPT_PHASE_LABELS = {
  thinking: 'Thinking...',
  writing: 'Writing response...',
};

export class AntigravityAgentSessionRunner implements AgentSessionRunner {
  private readonly attachments = new RunAttachmentContentReader();
  private readonly permissions = new Map<string, PermissionRequest>();
  /** Rule keys approved without a card: stored rules plus this session's Always Approve choices. */
  private readonly allowedRuleKeys = new Set<string>();
  private directory: IsolatedProviderWorkingDirectory | undefined;
  /** Set for repository-bound sessions: the Run roots agy is sandboxed to. */
  private boundary: RunWorkspaceWriteBoundary | undefined;
  private client: AntigravityAcpClient | undefined;
  private sessionId: string | null = null;
  private mountIdentity: string | undefined;
  private agentPrompt: string | undefined;
  private busy = false;
  private activePrompt: ActivePrompt | undefined;
  private usage: { used: number; size: number } | undefined;
  private model: string | undefined;
  /** The Run whose token totals this provider session's prompts count against. */
  private owningRunId: string | undefined;
  private expectedMode: 'default' | undefined;
  private configOptions: AcpConfigOptions = [];
  private commands = new Set<string>();
  private readonly executionCapture: AntigravityExecutionCaptureHooks | null;

  constructor(private readonly dependencies: Dependencies) {
    this.executionCapture = dependencies.executionRecorder
      ? new AntigravityExecutionCaptureHooks(dependencies.executionRecorder, dependencies.logger)
      : null;
  }

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

  /**
   * Compacts through Antigravity's own `/compact` command, which ACP advertises
   * in its available commands. The summary is a normal prompt turn, so it is
   * refused while another prompt is active and unsupported when `agy` does not
   * advertise the command.
   */
  async compact(providerSessionId?: string): Promise<void> {
    const { logger } = this.dependencies;
    const client = this.client;
    const sessionId = this.sessionId;
    if (!client || !sessionId || (providerSessionId && providerSessionId !== sessionId)) {
      throw new AgentSessionRunnerError(
        'NO_ACTIVE_SESSION',
        'No active Antigravity session is available to compact.',
      );
    }
    if (!this.commands.has('compact')) {
      logger.warn('antigravity.compact.unsupported', { sessionId });
      throw new AgentSessionRunnerError(
        'NOT_SUPPORTED',
        'This Antigravity session does not advertise a compact command.',
      );
    }
    if (this.busy) {
      throw new AgentSessionRunnerError('RUN_BUSY', 'Antigravity already has an active prompt.');
    }

    this.busy = true;
    logger.debug('antigravity.compact.started', { sessionId });
    try {
      const result = await client.prompt(sessionId, [{ type: 'text', text: '/compact' }]);
      if (this.owningRunId) {
        await this.recordTokenUsage(this.owningRunId, result.usage);
      }
      if (result.stopReason !== 'end_turn') {
        throw new AgentSessionRunnerError(
          'RUN_FAILED',
          `Antigravity compaction stopped with reason ${result.stopReason}.`,
        );
      }
      logger.debug('antigravity.compact.succeeded', { sessionId });
    } catch (error) {
      logger.warn('antigravity.compact.failed', { sessionId, error: String(error) });
      throw error;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Makes the session run the model and thinking level the launch selected.
   * The catalog offers model families and levels as separate choices, which are
   * the `model` and `thought_level` config options. Each is applied only when it
   * differs from what the session reports, and the provider's reply must confirm
   * it: a session that would run a different model fails the launch instead.
   * A level Antigravity does not list for the model keeps the provider default.
   */
  private async applySelection(
    client: AntigravityAcpClient,
    sessionId: string,
    args: PromptArgs,
  ): Promise<void> {
    const { logger } = this.dependencies;
    const model = args.model ?? args.session.model ?? undefined;
    const effort = args.reasoningEffort ?? args.session.reasoningEffort ?? undefined;
    if (model) {
      await this.selectModel(client, sessionId, model);
    }
    if (effort && effort !== 'default') {
      const applied = await this.setOption(client, sessionId, 'thought_level', effort, {
        required: false,
      });
      if (!applied) {
        logger.warn('antigravity.thought_level.not_applied', { sessionId, effort });
      }
    }
    const family = this.currentOption('model');
    const level = this.currentOption('thought_level');
    if (family) {
      this.model = level ? `${family}-${level}` : family;
    }
  }

  /**
   * Without a `model` config option the session can only run the model it
   * reported as current, which is the one model the catalog then lists.
   */
  private async selectModel(
    client: AntigravityAcpClient,
    sessionId: string,
    model: string,
  ): Promise<void> {
    const hasModelOption = this.configOptions.some((option) => option.id === 'model');
    if (hasModelOption) {
      await this.setOption(client, sessionId, 'model', model, { required: true });
      return;
    }
    if (model !== this.model) {
      throw new AgentSessionRunnerError(
        'RUN_FAILED',
        `Antigravity offers no model choice for this session and is running "${this.model ?? 'unknown'}", not "${model}".`,
      );
    }
  }

  private currentOption(id: string): string | undefined {
    return this.configOptions.find((option) => option.id === id)?.currentValue;
  }

  private async setOption(
    client: AntigravityAcpClient,
    sessionId: string,
    id: string,
    value: string,
    { required }: { required: boolean },
  ): Promise<boolean> {
    const option = this.configOptions.find((entry) => entry.id === id);
    if (option?.currentValue === value) {
      return true;
    }
    if (!option?.options?.some((entry) => entry.value === value)) {
      if (!required) {
        return false;
      }
      throw new AgentSessionRunnerError(
        'RUN_FAILED',
        `Antigravity does not list ${id} "${value}" for this session.`,
      );
    }

    const reply = await client.setConfigOption(sessionId, id, value);
    this.configOptions = reply.configOptions ?? this.configOptions;
    const effective = this.currentOption(id);
    this.dependencies.logger.debug('antigravity.config_option.applied', {
      sessionId,
      id,
      requested: value,
      effective,
    });
    if (effective !== value) {
      throw new AgentSessionRunnerError(
        'RUN_FAILED',
        `Antigravity kept ${id} "${effective ?? 'unknown'}" instead of "${value}".`,
      );
    }
    return true;
  }

  listSkills(): Promise<AgentSkillCatalog> {
    return listAntigravitySkills(this.commands.size > 0 ? this.commands : undefined);
  }

  /**
   * Adds the turn's tokens the way ACP reports them. A turn with no `usage`
   * adds nothing, so a Run that never got any stays unavailable instead of zero.
   * Cache counts are kept only when ACP reports both read and write.
   */
  private async recordTokenUsage(runId: string, usage: AcpPromptUsage | undefined): Promise<void> {
    const { logger, runStore } = this.dependencies;
    if (!usage) {
      logger.debug('antigravity.token_usage.unavailable', { runId });
      return;
    }
    const { cachedReadTokens, cachedWriteTokens } = usage;
    const cache =
      cachedReadTokens !== undefined && cachedWriteTokens !== undefined
        ? {
            cacheReadInputTokens: cachedReadTokens,
            cacheCreationInputTokens: cachedWriteTokens,
            cacheAvailability: 'reported' as const,
          }
        : {};
    try {
      await runStore.updateRunTokenUsage(runId, {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        ...cache,
      });
    } catch (error) {
      logger.warn('antigravity.token_usage.persist_failed', { runId, error: String(error) });
    }
  }

  async submitPermissionDecision({
    dispatch,
    session,
  }: PermissionDecisionDispatchArgs): Promise<PermissionDecisionDispatchResult> {
    const request = this.permissions.get(dispatch.routing.requestId);
    if (!request || !this.client || dispatch.agentType !== 'antigravity') {
      return { delivered: false, outcome: 'stale', reason: 'request_not_found' };
    }
    const kind = dispatch.callbackPayload.kind;
    const ruleKey = antigravityRuleKey(request.params.toolCall.name);
    const remembers = dispatch.decision === 'always_approve' || dispatch.decision === 'whitelist';
    if (remembers && !ruleKey) {
      return {
        delivered: false,
        outcome: 'refused',
        reason:
          'Antigravity did not name this tool, so it cannot be remembered. Approve it once or deny it.',
      };
    }
    const option = request.params.options.find((entry) => entry.kind === kind);
    if (!option) {
      this.dependencies.logger.warn('antigravity.permission.option_missing', {
        requestId: dispatch.routing.requestId,
        decision: dispatch.decision,
        kind,
        offeredKinds: request.params.options.map((entry) => entry.kind),
      });
      return {
        delivered: false,
        outcome: 'refused',
        reason: `Antigravity does not offer "${dispatch.decision.replaceAll('_', ' ')}" for this request. Choose an available decision on the permission card.`,
      };
    }
    if (dispatch.decision === 'whitelist' && ruleKey) {
      try {
        await this.dependencies.toolRuleStore.save(ruleKey);
      } catch (error) {
        this.dependencies.logger.warn('antigravity.permission.rule_save_failed', {
          requestId: dispatch.routing.requestId,
          ruleKey,
          error: describeCause(error),
        });
        return {
          delivered: false,
          outcome: 'refused',
          reason: `Couldn't save the whitelist rule for ${request.params.toolCall.name}: ${describeCause(error)}. The request is still waiting; choose again.`,
        };
      }
    }
    try {
      await this.client.respondToPermission(request.id, option);
    } catch (error) {
      this.dependencies.logger.warn('antigravity.permission.reply_failed', {
        requestId: dispatch.routing.requestId,
        kind,
        error: String(error),
      });
      return {
        delivered: false,
        outcome: 'refused',
        reason: `The connection to Antigravity closed before this decision could be sent. Resend your prompt to request approval again.${dispatch.decision === 'whitelist' ? ' The whitelist rule was already saved.' : ''}`,
      };
    }
    if (remembers && ruleKey) {
      this.allowedRuleKeys.add(ruleKey);
    }
    this.permissions.delete(dispatch.routing.requestId);
    if (option.kind === 'reject_once') {
      this.executionCapture?.denied(request.params.sessionId, request.params.toolCall.toolCallId);
    }
    await recordPermissionDecisionSubmitted({
      dispatch,
      agenticSessionId: session.agentic_session_id,
      runStore: this.dependencies.runStore,
      emitRawEvent: (event) => this.dependencies.agentOutputOwner.onAgentOutput({ event }),
    }).catch((error: unknown) => {
      this.dependencies.logger.error('antigravity.permission.decision_record_failed', {
        requestId: dispatch.routing.requestId,
        decision: dispatch.decision,
        error: String(error),
      });
    });
    return { delivered: true, callbackType: dispatch.callbackType };
  }

  async discardSession(): Promise<void> {
    this.client?.dispose();
    this.client = undefined;
    this.sessionId = null;
    this.usage = undefined;
    this.model = undefined;
    this.owningRunId = undefined;
    this.expectedMode = undefined;
    this.configOptions = [];
    this.commands = new Set();
    this.mountIdentity = undefined;
    this.agentPrompt = undefined;
    this.boundary = undefined;
    this.allowedRuleKeys.clear();
    await this.executionCapture?.close();
    const directory = this.directory;
    this.directory = undefined;
    await directory?.cleanup();
  }

  dispose(): Promise<void> {
    return this.discardSession();
  }

  private async run(args: PromptArgs, resumeId: string | null, fresh?: RunPromptArgs) {
    const { logger } = this.dependencies;
    const boundary = args.workspaceWriteBoundary;
    const repositoryBound =
      args.workspace ||
      boundary ||
      args.session.services?.length ||
      args.session.launchServiceId ||
      args.session.workspaceBound ||
      args.session.scope;
    if (repositoryBound && !boundary) {
      const error = new AgentSessionRunnerError(
        'ANTIGRAVITY_CONTAINMENT_REQUIRED',
        'Antigravity could not be contained to the Run roots for this repository session, so it was not started.',
      );
      logger.warn('antigravity.run.refused', {
        runId: args.session.agentic_session_id,
        code: error.code,
        hasWorkspace: Boolean(args.workspace),
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
      this.owningRunId = args.session.agentic_session_id;
      const mcpServers = this.serversFor(args);
      const readOnlyFilesystem = args.readOnlyFilesystem === true;
      const hookLaunch = args.workspace?.ok
        ? await this.executionCapture?.session.open(
            this.dependencies.agentOutputOwner,
            args.workspace,
          )
        : undefined;
      // agy reads its hooks at launch, so a different capture channel needs a new process.
      const mountIdentity = JSON.stringify({
        mcpServers,
        roots: boundary?.allowedRepositoryRoots,
        cwd: boundary?.cwd,
        readOnlyFilesystem,
        captureChannel: hookLaunch?.environment.HEY_HEY_CAPTURE_URL,
      });
      if (!this.client || this.mountIdentity !== mountIdentity) {
        // Platform and browser mounts expire with the Turn. Attach their current
        // URLs by resuming the same native session in a new ACP process.
        this.client?.dispose();
        this.client = undefined;
        this.expectedMode = undefined;
        this.directory ??= await IsolatedProviderWorkingDirectory.create();
        // The Run agent file lives in the isolated launch directory, never in a repository.
        const launchDirectory = this.directory.path;
        this.agentPrompt ??= fresh ? await this.platformPrompt(fresh) : '';
        await this.writeAgent(
          launchDirectory,
          this.agentPrompt,
          Boolean(boundary) && !readOnlyFilesystem,
        );
        await this.executionCapture?.install(launchDirectory, hookLaunch);
        this.boundary = boundary;
        for (const rule of this.dependencies.toolRuleStore.load()) {
          this.allowedRuleKeys.add(rule);
        }
        const config = { cwd: boundary?.cwd ?? launchDirectory, mcpServers };
        const containment = boundary?.antigravityContainment(readOnlyFilesystem);
        logger.debug('antigravity.run.launching', {
          runId: args.session.agentic_session_id,
          contained: Boolean(containment),
          resume: Boolean(resumeId),
          roots: boundary?.allowedRepositoryRoots,
          readOnlyFilesystem,
          executionCapture: Boolean(hookLaunch),
        });
        const client = new AntigravityAcpClient(
          launchDirectory,
          logger,
          (update) => this.onUpdate(update),
          (request) => this.onPermission(request),
          [
            '--agent',
            'heyhey-run',
            '--include-default-customizations=false',
            ...(containment ? ['--gemini-dir', containment.geminiDirectory] : []),
          ],
          undefined,
          containment,
        );
        this.client = client;
        await this.initialize(client, Boolean(containment));
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
          this.configOptions = resumed.configOptions ?? [];
        } else {
          const created = await client.createSession(config);
          this.sessionId = created.sessionId;
          this.model = created.models?.currentModelId;
          this.configOptions = created.configOptions ?? [];
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

      await this.applySelection(client, sessionId, args);

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
          passage: [],
          skipPermissions: args.skipPermissions === true,
          grant: this.buildGrant(args),
        };
        this.activePrompt = prompt;
        const cancel = () => {
          void client.cancel(sessionId).catch((error: unknown) => {
            logger.warn('antigravity.cancel.failed', { sessionId, error: String(error) });
          });
        };
        args.signal?.addEventListener('abort', cancel, { once: true });
        try {
          const result = await client.prompt(sessionId, content);
          args.signal?.removeEventListener('abort', cancel);
          await this.recordTokenUsage(args.session.agentic_session_id, result.usage);
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
          if (prompt.lastWriteRefusal && !prompt.passage.join('').trim()) {
            throw new AgentSessionRunnerError('RUN_FAILED', prompt.lastWriteRefusal);
          }
          this.flushPassage(sessionId, prompt, true);
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
      await this.executionCapture?.session.end();
      this.busy = false;
    }
  }

  /** A contained session whose sandbox cannot start is refused with that cause, not a generic failure. */
  private async initialize(client: AntigravityAcpClient, contained: boolean): Promise<void> {
    try {
      await client.initialize();
    } catch (error) {
      if (!contained || error instanceof AntigravityNotReadyError) {
        throw error;
      }
      throw new AgentSessionRunnerError(
        'ANTIGRAVITY_CONTAINMENT_REQUIRED',
        `Antigravity could not start inside the Run sandbox: ${describeCause(error)}`,
        error,
      );
    }
  }

  private buildGrant(args: PromptArgs): TurnToolGrant {
    const registration = this.dependencies.submissionToolRegistry.getByRunId(
      args.session.agentic_session_id,
    );
    const mounted = registration?.tools.map((tool) => tool.name) ?? [];
    return new TurnToolGrant({
      platformAllowedTools: args.platformMcpProxyMount?.allowedTools,
      activeSubmissionToolNames: registration?.activeToolNames ?? mounted,
    });
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
      url:
        serverName === 'heyhey-platform' ? serverEntry.url + '?catalog=compact' : serverEntry.url,
      headers: [],
    }));
  }

  private async writeAgent(cwd: string, prompt: string, writable: boolean): Promise<void> {
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
        ...(writable
          ? [
              'tools: [read_file, edit_file, write_file, run_command, manage_task, search_web, generate_image, schedule, send_message]',
            ]
          : []),
        'inheritMcp: false',
        'inheritCustomizations: false',
        '---',
        prompt,
      ].join('\n'),
      { mode: 0o600 },
    );
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
        productDevelopment: context.productDevelopment,
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

  private observePromptActivity(
    sessionId: string,
    prompt: ActivePrompt,
    hasAssistantText = false,
  ): void {
    if (prompt.phase === undefined) {
      this.publishPromptPhase(sessionId, prompt, 'thinking');
    }
    if (hasAssistantText && prompt.phase !== 'writing') {
      this.publishPromptPhase(sessionId, prompt, 'writing');
    }
  }

  private publishPromptPhase(
    sessionId: string,
    prompt: ActivePrompt,
    phase: keyof typeof PROMPT_PHASE_LABELS,
  ): void {
    prompt.phase = phase;
    this.dependencies.agentOutputOwner.onAgentOutput({
      event: {
        source: 'local',
        eventType: 'processing_status',
        timestamp: new Date().toISOString(),
        sessionId,
        agentId: this.dependencies.agentOutputOwner.runId,
        payload: { kind: 'loading.update', loadingText: PROMPT_PHASE_LABELS[phase], phase },
      },
    });
  }

  /**
   * Emits the buffered passage as one assistant message. A tool call ends a
   * passage, which stays an interstitial entry; the passage left when the
   * prompt returns is the final reply, emitted once.
   */
  private flushPassage(sessionId: string, prompt: ActivePrompt, isFinal: boolean): void {
    const text = prompt.passage.join('');
    prompt.passage = [];
    if (!text) {
      return;
    }

    this.emit(
      sessionId,
      'agent_output',
      { messageType: 'assistant', summary: text, ...(isFinal ? { taskComplete: true } : {}) },
      // Each passage is a complete entry; closing it keeps the next passage
      // from overwriting it in the activity feed.
      { narration: { delivery: 'message', text, isFinal: true } },
    );
  }

  private onUpdate({
    sessionId,
    update,
  }: Extract<AcpInboundCall, { method: 'session/update' }>['params']): void {
    // agy advertises its commands right behind the session/new reply, before the
    // runner has bound the session id, so that one update is accepted unbound.
    if (update.sessionUpdate === 'available_commands_update' && this.sessionId === null) {
      this.commands = new Set(update.availableCommands.map((command) => command.name));
      return;
    }
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
    if (update.sessionUpdate === 'available_commands_update') {
      this.commands = new Set(update.availableCommands.map((command) => command.name));
    }
    this.executionCapture?.observe({ sessionId, update });
    const prompt = this.activePrompt;
    if (!prompt) {
      return;
    }
    if (update.sessionUpdate === 'agent_message_chunk') {
      this.observePromptActivity(sessionId, prompt, update.content.text.length > 0);
      prompt.passage.push(update.content.text);
      return;
    }
    if (update.sessionUpdate === 'tool_call') {
      this.flushPassage(sessionId, prompt, false);
    }
    const event = mapAntigravityUpdate(
      this.eventContext(sessionId),
      update,
      this.dependencies.logger,
    );
    if (event) {
      // A mode report can come from session setup. Context usage can be the
      // first update agy sends in response to a prompt.
      if (update.sessionUpdate !== 'current_mode_update') {
        this.observePromptActivity(sessionId, prompt);
      }
      this.dependencies.agentOutputOwner.onAgentOutput({ event });
    }
  }

  private onPermission(request: PermissionRequest): void {
    void this.handlePermission(request).catch(async (error: unknown) => {
      this.dependencies.logger.warn('antigravity.permission.failed', {
        id: request.id,
        error: String(error),
      });
      try {
        await this.client?.respondToPermission(request.id, undefined);
      } catch (replyError) {
        this.dependencies.logger.warn('antigravity.permission.cancel_failed', {
          id: request.id,
          error: String(replyError),
        });
      }
    });
  }

  /**
   * The sandbox is the boundary; this only keeps the user from being asked about,
   * or auto-approving, a write the sandbox would refuse. Approval never widens it.
   */
  private async writeRefusal(request: PermissionRequest): Promise<string | undefined> {
    const boundary = this.boundary;
    if (!boundary) {
      return undefined;
    }
    const tool = request.params.toolCall;
    const targets = antigravityWriteTargetSources(tool);
    for (const target of targets) {
      try {
        await boundary.resolveWriteTarget(target.path);
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? String(error.code) : undefined;
        const cause =
          error instanceof WorkspaceWriteOutsideRunError
            ? error.message
            : `Could not verify the requested file path (${code ?? 'path resolution failed'}).`;
        this.dependencies.logger.warn('antigravity.permission.outside_run_roots', {
          id: request.id,
          sessionId: request.params.sessionId,
          error: cause,
          errorCode: code,
          toolCallId: tool.toolCallId,
          toolName: tool.name,
          toolKind: tool.kind,
          toolTitle: tool.title,
          inputKeys: Object.keys(
            z.record(z.unknown()).safeParse(tool.rawInput ?? tool.args).data ?? {},
          ),
          contentTypes: (tool.content ?? []).map((entry) => entry.type),
          targetSources: targets.map((candidate) => ({
            source: candidate.source,
            length: candidate.path.length,
          })),
          failedTarget: {
            source: target.source,
            length: target.path.length,
            preview: target.path.slice(0, PATH_PREVIEW_CHARS),
          },
        });
        return cause;
      }
    }
    return undefined;
  }

  private async handlePermission(request: PermissionRequest): Promise<void> {
    const { id, params } = request;
    const prompt = this.activePrompt;
    if (!prompt || params.sessionId !== this.sessionId) {
      await this.client?.respondToPermission(id, undefined);
      return;
    }
    this.observePromptActivity(params.sessionId, prompt);
    const refusal = await this.writeRefusal(request);
    if (refusal) {
      prompt.lastWriteRefusal = `Hey Hey rejected the file operation. ${refusal} Antigravity ended the turn without a final response.`;
      this.executionCapture?.denied(params.sessionId, params.toolCall.toolCallId);
      await this.client?.respondToPermission(
        id,
        params.options.find((option) => option.kind === 'reject_once'),
      );
      return;
    }
    delete prompt.lastWriteRefusal;
    if (prompt.skipPermissions) {
      const kind = 'allow_once';
      this.dependencies.logger.debug('antigravity.permission.automatic', {
        id,
        kind,
        sessionId: params.sessionId,
      });
      await this.client?.respondToPermission(
        id,
        params.options.find((option) => option.kind === kind),
      );
      return;
    }
    const allowOnce = params.options.find((option) => option.kind === 'allow_once');
    const granted = prompt.grant.match(params.toolCall.name);
    if (granted && allowOnce) {
      this.dependencies.logger.debug('antigravity.permission.turn_granted', {
        id,
        tool: granted.tool,
        server: granted.server,
        sessionId: params.sessionId,
      });
      await this.client?.respondToPermission(id, allowOnce);
      return;
    }
    if (looksLikeHeyHeyTool(params.toolCall.name)) {
      this.dependencies.logger.debug('antigravity.permission.hey_hey_tool_not_granted', {
        id,
        tool: params.toolCall.name,
        reason: granted ? 'no allow_once option offered' : 'not in the turn grant',
        sessionId: params.sessionId,
      });
    }
    const ruleKey = antigravityRuleKey(params.toolCall.name);
    if (ruleKey && allowOnce && this.allowedRuleKeys.has(ruleKey)) {
      this.dependencies.logger.debug('antigravity.permission.remembered', {
        id,
        ruleKey,
        sessionId: params.sessionId,
      });
      await this.client?.respondToPermission(id, allowOnce);
      return;
    }
    const requestId = randomUUID();
    this.permissions.set(requestId, request);
    this.dependencies.agentOutputOwner.onAgentOutput({
      event: mapAntigravityPermission(this.eventContext(params.sessionId), requestId, params),
    });
  }
}
