import { SessionRoleGuidance } from '../agents/session-role-guidance/session-role-guidance';
import { SubmissionToolAuth } from '../agents/submission-tools/submission-tool-auth';
import {
  composeFreshPlatformPromptDelivery,
  resolveProviderPlatformPromptDeliveryMode,
  PLATFORM_PROMPT_DELIVERY_MODE,
  type PlatformPromptFreshDelivery,
} from '../agents/providers/platform-prompt-delivery';
import { applyCodexSessionReviewerPolicy } from '../agents/providers/codex/codex-session-policy';
/**
 * SubAgent — the unified isolated provider-helper-session executor for every
 * handler that declares `runnerKind: 'subagent'`.
 *
 * Replaces the per-handler `spawnXSubagent` helpers (commit, implement,
 * review, coding-plan, final-assessment) with one class that consumes the
 * handler's declarative `SubagentConfig` plus the per-Turn `RunnerContext`.
 * The class owns the entire session lifetime: build prompt, construct the
 * MCP server, wire the permission handler, pipe normalized events, fire
 * `run_started`/`run_completed`, and disconnect the SDK client.
 *
 * Invariants:
 *   - The provider helper session is created and disconnected inside
 *     `execute`. No external code observes its ephemeral session id.
 *   - The prompt is `prependPriorReports(buildPrompt(payload) +
 *     buildServiceContextNote(serviceId) + handler.addUserMessage(payload))`.
 *     The runtime always invokes `buildPrompt` + `addUserMessage` on the
 *     subagent path; the resolver no longer special-cases subagent-owned
 *     promptTypes.
 *   - Handler-prepared payloads (the enriched payload returned by
 *     `handler.prepare`) are preferred over the raw wire payload so
 *     enrichment work like the implement handler's approved-plan fetch
 *     reaches the prompt.
 */

import path from 'node:path';
import { RunWorkspaceWriteBoundary } from '../agents/workspace-write-boundary';
import { randomUUID } from 'node:crypto';
import {
  ClaudeCodeSdkClient,
  CodexSdkClient,
  type CodexSdkConfigValue,
  type ClaudeCodePermissionResult,
  type ClaudeCodeSdkEvent,
  type CodexSdkConfigOverrides,
  type CodexSdkEvent,
  type CodexSdkServerRequest,
  type CodexSdkTokenUsage,
} from '../agent-runtime/index';
import type { AgentOutputHandler } from '../agents/agent-event-stream';
import type { OAuthClient } from '../auth/index';
import type {
  AgentStartupPromptInputResult,
  PromptTypeHandler,
  SubagentConfig,
  UserLaunchablePromptTypeHandler,
} from '../agents/prompt-type-handler';
import { buildMcpServerConfig, resolveHintPromptAccess } from '../agents/mcp-server-config';
import {
  buildServiceContextNote,
  buildPlatformSystemPrompt,
  mentionFormatReminder,
} from '../agents/prompts/common';
import { readSessionStartContext } from '../agents/prompts/session-start-context';
import { prependPriorReports } from '../agents/prompts/report-chain';
import { loadProviderEventNormalizationConfig } from '../agents/providers/provider-event-normalization';
import { resolveAgentProviderId } from '../agents/providers/provider-config';
import { mapCodexEvent } from '../agents/providers/codex/codex-event-mapper';
import {
  resolveCodexPermissionPlan,
  type CodexPermissionPlan,
} from '../agents/providers/codex/codex-permissions';
import { emitNormalizedSubagentEvent } from '../agents/subagent-event-pipe';
import { buildSubmissionToolsMcpConfig } from '../agents/submission-tools/mcp-config';
import { summarizeClaudeInitToolExposure } from '../agents/providers/claude/init-tool-exposure';
import type { SubmissionToolRegistry } from '../agents/submission-tools/registry';
import type { LocalAgentEndpoint } from '../server/local-base-url';
import type { ServerLogger } from '../server/logger';
import { requestContext } from '../server/request-context';
import type { AgenticSession } from '../session/types';
import type { LocalReasoningEffort } from '../shared/agent-bridge-contract/index';
import type { LocalContextData } from '../shared/agent-bridge-contract/runtime-types';
import type { ProviderPhase, ReportChainEntry } from './types';
import {
  withholdEvalMutationTools,
  type EvalExecutionContext,
} from '../agents/run-eval/eval-execution-context';
import { EvalChildPlatformMcpProxy } from '../agents/platform-mcp-proxy/eval-child-proxy';
import { childPlatformMcpProxies } from '../agents/platform-mcp-proxy/child-proxy-registry';
import { buildPlatformMcpProxyMcpConfig } from '../agents/platform-mcp-proxy/mcp-config';
import type { EvalResearchTools } from '../agents/run-eval/eval-research-tools';

const MCP_SERVER_NAME = 'heyhey-platform';
const AGENT_ID = 'claude-subagent';
const CODEX_AGENT_ID = 'codex-subagent';
const CODEX_MCP_ELICITATION_METHOD = 'mcpServer/elicitation/request';
const HEYHEY_MCP_SERVER_NAMES = new Set(['heyhey-platform', 'heyhey-submission-tools']);

const extractAssistantText = (event: ClaudeCodeSdkEvent): string | null => {
  const message = event['message'] as Record<string, unknown> | undefined;
  if (!message) return null;
  const content = message['content'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const item of content) {
    if (item['type'] === 'text' && typeof item['text'] === 'string') {
      parts.push(item['text']);
    }
  }
  return parts.length > 0 ? parts.join('') : null;
};

const isUserLaunchable = (
  handler: PromptTypeHandler<unknown>,
): handler is UserLaunchablePromptTypeHandler<{ userMessage?: string }> =>
  typeof (handler as { addUserMessage?: unknown } | undefined)?.addUserMessage === 'function';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readMcpElicitationBody = (request: CodexSdkServerRequest): Record<string, unknown> => {
  const params = request.params ?? {};
  return isRecord(params['request']) ? params['request'] : params;
};

const readMcpElicitationMeta = (request: CodexSdkServerRequest): Record<string, unknown> | null => {
  const params = request.params ?? {};
  const body = readMcpElicitationBody(request);
  if (isRecord(body['_meta'])) return body['_meta'];
  if (isRecord(body['meta'])) return body['meta'];
  if (body !== params && isRecord(params['_meta'])) return params['_meta'];
  if (body !== params && isRecord(params['meta'])) return params['meta'];
  return null;
};

const parseMcpElicitationMessage = (
  message: string | null,
): { serverName: string | null; toolName: string | null } => {
  if (!message) return { serverName: null, toolName: null };
  const match = /^Allow the (.+?) MCP server to run tool ["'](.+?)["']\??$/u.exec(message.trim());
  return {
    serverName: match?.[1] ?? null,
    toolName: match?.[2] ?? null,
  };
};

const readMcpElicitationTool = (
  request: CodexSdkServerRequest,
): { serverName: string | null; toolName: string | null; qualifiedToolName: string | null } => {
  const body = readMcpElicitationBody(request);
  const meta = readMcpElicitationMeta(request);
  const fromMessage = parseMcpElicitationMessage(readTrimmedString(body['message']));
  const serverName = readTrimmedString(body['serverName']) ?? fromMessage.serverName;
  const toolName = readTrimmedString(meta?.['tool_name']) ?? fromMessage.toolName;
  return {
    serverName,
    toolName,
    qualifiedToolName: toolName
      ? serverName
        ? `mcp__${serverName}__${toolName}`
        : toolName
      : null,
  };
};

const shellQuote = (arg: string): string => {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(arg)) return arg;
  return `'${arg.replace(/'/gu, `'\\''`)}'`;
};

const isShellProgram = (program: string): boolean =>
  program === 'sh' ||
  program === 'bash' ||
  program === 'zsh' ||
  program === '/bin/sh' ||
  program === '/bin/bash' ||
  program === '/bin/zsh';

const tokenizeShellWrapper = (command: string): readonly string[] | null => {
  const trimmed = command.trim();
  if (trimmed.length === 0) return null;

  const tokens: string[] = [];
  let current = '';
  let hasToken = false;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]!;
    if (escaped) {
      current += ch;
      hasToken = true;
      escaped = false;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      hasToken = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }

  if (quote) return null;
  if (hasToken) tokens.push(current);
  return tokens.length > 0 ? tokens : null;
};

const unwrapShellWrappedCommand = (command: readonly string[]): string | null => {
  if (command.length !== 3) return null;
  const [program, shellFlag, innerCommand] = command;
  if (
    program &&
    shellFlag &&
    innerCommand &&
    isShellProgram(program) &&
    (shellFlag === '-c' || shellFlag === '-lc')
  ) {
    return innerCommand;
  }
  return null;
};

const codexCommandToBashInput = (params: Record<string, unknown>): { command: string } | null => {
  const command = params['command'];
  if (typeof command === 'string') {
    const shellWrapped = unwrapShellWrappedCommand(tokenizeShellWrapper(command) ?? []);
    return { command: shellWrapped ?? command };
  }
  if (Array.isArray(command) && command.every((item): item is string => typeof item === 'string')) {
    const shellWrapped = unwrapShellWrappedCommand(command);
    return { command: shellWrapped ?? command.map(shellQuote).join(' ') };
  }
  return null;
};

type PlatformMcpServerEntry = {
  type?: string;
  url?: string;
  headers?: Record<string, string>;
};

const toPlatformMcpEntry = (value: unknown): PlatformMcpServerEntry | null => {
  if (!isRecord(value)) return null;
  const url = value['url'];
  if (typeof url !== 'string' || url.trim().length === 0) return null;
  const headers = isRecord(value['headers'])
    ? Object.fromEntries(
        Object.entries(value['headers']).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : undefined;
  return {
    url,
    ...(typeof value['type'] === 'string' ? { type: value['type'] } : {}),
    ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
  };
};

const toCodexPlatformMcpConfig = (entry: PlatformMcpServerEntry): CodexSdkConfigOverrides => ({
  mcp_servers: {
    'heyhey-platform': {
      url: entry.url ?? '',
      ...(entry.headers ? { http_headers: entry.headers } : {}),
    },
  },
});

const toCodexSubmissionMcpConfig = (
  serverName: string,
  serverEntry: unknown,
): CodexSdkConfigOverrides | null => {
  const entry = toPlatformMcpEntry(serverEntry);
  if (!entry?.url) return null;
  return {
    mcp_servers: {
      [serverName]: {
        url: entry.url,
      },
    },
  };
};

const mergeCodexMcpConfigs = (
  configs: ReadonlyArray<CodexSdkConfigOverrides | null>,
): CodexSdkConfigOverrides | undefined => {
  const mcpServers: Record<string, CodexSdkConfigValue> = {};
  for (const config of configs) {
    const value = config?.['mcp_servers'];
    if (!isRecord(value)) continue;
    Object.assign(mcpServers, value as Record<string, CodexSdkConfigValue>);
  }
  return Object.keys(mcpServers).length > 0 ? { mcp_servers: mcpServers } : undefined;
};

const applyCodexWorkspaceContainment = (
  config: CodexSdkConfigOverrides | undefined,
  workspaceWriteConfig: NonNullable<CodexPermissionPlan['workspaceWriteConfig']>,
): CodexSdkConfigOverrides => ({
  ...(config ?? {}),
  ...workspaceWriteConfig,
});

export interface SubAgentArgs {
  researchTools?: EvalResearchTools;
  session: AgenticSession;
  handler: PromptTypeHandler<unknown>;
  config: SubagentConfig;
  payload: unknown;
  touchedFiles: readonly string[];
  onAgentOutput: AgentOutputHandler;
  oauthClient: OAuthClient;
  logger: ServerLogger;
  signal?: AbortSignal;
  cwd: string;
  allowedRepositoryRoots?: readonly string[];
  priorReports: ReadonlyArray<Readonly<ReportChainEntry>>;
  startupPromptInput?: AgentStartupPromptInputResult;
  model?: string;
  reasoningEffort?: LocalReasoningEffort;
  /** A Fast mode the user chose for this child; absent runs the child without Fast mode. */
  fastMode?: boolean;
  submissionToolRegistry: SubmissionToolRegistry;
  localAgentEndpoint: LocalAgentEndpoint;
  /**
   * Provider-reported tokens (input, cache and output) this child may spend.
   * The host aborts the child once usage passes it; a prompt-stated budget
   * alone is not honoured by models.
   */
  tokenBudget?: number;
  /** Present when the child runs one eval attempt; narrows its tools and hides eval reports. */
  evalExecution?: EvalExecutionContext;
}

/** Context usage read from a subagent's live session just before it disconnects. */
export interface SubAgentContextReading {
  providerSessionId: string;
  usage: LocalContextData;
}

export interface SubAgentResult {
  preparationMeasurements?: import('../shared/api/generated/api').EvalMeasurement[];
  handlerElapsedMs?: number;
  assistantCompleted: boolean;
  outputText?: string;
  /** Present only for a handler whose session counts for context; null when unreadable. */
  contextReading?: SubAgentContextReading | null;
  /** True when the host stopped the child for passing its token budget; outputText is partial. */
  budgetExhausted?: boolean;
  /** Provider-reported usage. A field is absent when the provider reported nothing for it. */
  usage: SubAgentUsage;
}

export interface SubAgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  toolCalls?: number;
}

/**
 * Accumulates the provider's own usage evidence for one child. Claude repeats a
 * message's usage on streamed copies, so totals are kept per message id; Codex
 * reports cumulative thread totals and does not report tool calls here.
 */
class ChildUsageMeter {
  private readonly claudeMessages = new Map<string, { input: number; output: number }>();
  private readonly claudeToolUseIds = new Set<string>();
  private codexTotals: { input: number; output: number } | null = null;

  public recordClaudeAssistant(event: ClaudeCodeSdkEvent): void {
    const message = event['message'];
    if (!isRecord(message) || typeof message['id'] !== 'string') return;
    const content = message['content'];
    if (Array.isArray(content)) {
      for (const block of content) {
        if (isRecord(block) && block['type'] === 'tool_use' && typeof block['id'] === 'string') {
          this.claudeToolUseIds.add(block['id']);
        }
      }
    }
    if (!isRecord(message['usage'])) return;
    const usage = message['usage'];
    const previous = this.claudeMessages.get(message['id']);
    const input =
      readTokenCount(usage, 'input_tokens') +
      readTokenCount(usage, 'cache_creation_input_tokens') +
      readTokenCount(usage, 'cache_read_input_tokens');
    const output = readTokenCount(usage, 'output_tokens');
    this.claudeMessages.set(message['id'], {
      input: Math.max(previous?.input ?? 0, input),
      output: Math.max(previous?.output ?? 0, output),
    });
  }

  public recordCodexTotals(usage: CodexSdkTokenUsage): void {
    this.codexTotals = {
      input: (usage.inputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0),
      output: usage.outputTokens,
    };
  }

  public read(): SubAgentUsage {
    if (this.codexTotals) {
      return { inputTokens: this.codexTotals.input, outputTokens: this.codexTotals.output };
    }
    if (this.claudeMessages.size === 0) return {};
    let inputTokens = 0;
    let outputTokens = 0;
    for (const totals of this.claudeMessages.values()) {
      inputTokens += totals.input;
      outputTokens += totals.output;
    }
    return { inputTokens, outputTokens, toolCalls: this.claudeToolUseIds.size };
  }
}

/**
 * Host-side token budget for one child. Usage is the provider's own count of
 * input, cache and output tokens; passing the budget aborts the child through
 * a signal linked to the caller's.
 */
class TokenBudgetGuard {
  private readonly controller = new AbortController();
  private exhausted = false;

  public constructor(
    private readonly budget: number,
    parent: AbortSignal | undefined,
    private readonly onExhausted: (tokensUsed: number) => void,
  ) {
    if (parent?.aborted) this.controller.abort(parent.reason);
    parent?.addEventListener('abort', () => this.controller.abort(parent.reason), { once: true });
  }

  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  public get isExhausted(): boolean {
    return this.exhausted;
  }

  public record(tokensUsed: number): void {
    if (this.exhausted || tokensUsed <= this.budget) return;
    this.exhausted = true;
    this.onExhausted(tokensUsed);
    this.controller.abort(new Error('Subagent token budget exhausted'));
  }
}

const readTokenCount = (usage: Record<string, unknown>, key: string): number => {
  const value = usage[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

/** One Claude assistant message's total tokens; streamed copies of a message repeat its usage. */
const readClaudeMessageUsage = (
  event: ClaudeCodeSdkEvent,
): { messageId: string; tokens: number } | null => {
  const message = event['message'];
  if (!isRecord(message) || typeof message['id'] !== 'string' || !isRecord(message['usage'])) {
    return null;
  }
  const usage = message['usage'];
  return {
    messageId: message['id'],
    tokens:
      readTokenCount(usage, 'input_tokens') +
      readTokenCount(usage, 'cache_creation_input_tokens') +
      readTokenCount(usage, 'cache_read_input_tokens') +
      readTokenCount(usage, 'output_tokens'),
  };
};

/**
 * Read the live session's context usage before disconnect, because a finished
 * subagent's client can no longer report it. Best-effort: a failed read is
 * logged and yields null so it never fails the subagent.
 */
const readContextBeforeDisconnect = async (input: {
  client: { getSessionId(): string | null | undefined; getContextUsage(): unknown };
  logger: ServerLogger;
  runId: string;
  adapterId: string;
}): Promise<SubAgentContextReading | null> => {
  const providerSessionId = input.client.getSessionId();
  if (!providerSessionId) return null;
  try {
    // Same already-validated boundary cast the provider runners use.
    const usage = (await input.client.getContextUsage()) as LocalContextData;
    return { providerSessionId, usage };
  } catch (error) {
    requestContext.log(input.logger, 'warn', 'local.subagent.context_usage.read_failed', {
      runId: input.runId,
      adapterId: input.adapterId,
      providerSessionId,
      error,
    });
    return null;
  }
};

export class SubAgent {
  private readonly budgetIdentity = randomUUID();
  private readonly usageMeter = new ChildUsageMeter();
  private releaseEvalProxy: (() => void) | null = null;

  constructor(private readonly args: SubAgentArgs) {}

  async execute(): Promise<SubAgentResult> {
    try {
      return await this.executeSession();
    } finally {
      this.releaseEvalProxy?.();
      await this.args.researchTools?.settle();
    }
  }

  private async executeSession(): Promise<SubAgentResult> {
    const {
      session,
      handler,
      config,
      payload,
      touchedFiles,
      onAgentOutput,
      oauthClient,
      logger,
      signal: parentSignal,
      cwd,
      allowedRepositoryRoots,
      priorReports,
      startupPromptInput,
      model,
      reasoningEffort,
      fastMode,
      submissionToolRegistry,
      localAgentEndpoint,
      tokenBudget,
      evalExecution,
      researchTools,
    } = this.args;
    const signal = evalExecution?.tokenBudget?.signal ?? parentSignal;
    const runId = session.agentic_session_id;

    // Build the prompt the runtime way: handler.buildPrompt + service-context
    // note + handler.addUserMessage (when the handler is user-launchable).
    // Mirrors `resolvePrompt`'s composition for provider-session flows so the
    // subagent and provider-session paths share one contract.
    //
    // touchedFiles is a runtime-only concept the resolver never sees; it is
    // injected onto the payload here under the underscore-prefixed `_touchedFiles`
    // convention so handlers that care (review) can read it through their
    // existing `buildPrompt(payload)` signature without taking a runtime dep.
    const enrichedPayload =
      payload !== null && typeof payload === 'object'
        ? { ...(payload as Record<string, unknown>), _touchedFiles: touchedFiles }
        : payload;
    const launchable = isUserLaunchable(handler) ? handler : null;
    const systemPrompt =
      handler.buildPrompt(enrichedPayload, {
        entity: session.entity,
        ...(startupPromptInput?.loadedEntityContext
          ? { loadedEntityContext: startupPromptInput.loadedEntityContext }
          : {}),
        recentUserReplies: [],
        triggerParentMessageId: null,
      }) + buildServiceContextNote(session.launchServiceId);
    const userInjection =
      launchable?.addUserMessage(enrichedPayload as { userMessage?: string }) ?? null;
    const handlerPrompt = userInjection ? `${systemPrompt}${userInjection}` : systemPrompt;
    const composed = startupPromptInput
      ? `${startupPromptInput.renderedInput}\n\n---\n\n${handlerPrompt}`
      : handlerPrompt;
    logger.debug('local.subagent.provider_session.action', {
      runId,
      providerSessionAction: 'mint',
      promptType: handler.promptType,
      launchServiceId: session.launchServiceId ?? null,
      services: session.services ?? [],
      cwd,
      processCwd: process.cwd(),
      priorPlanReportIds: priorReports
        .filter((report) => report.reportType === 'PLAN')
        .map((report) => report.reportId),
      startupInputAvailable: startupPromptInput !== undefined,
      startupInputDelivered: startupPromptInput !== undefined,
    });
    if (startupPromptInput) {
      const { provenance } = startupPromptInput;
      requestContext.log(logger, 'info', 'local.subagent.startup_context', {
        runId,
        providerSessionAction: 'create',
        templateKey: provenance.templateKey,
        ownershipSource: provenance.ownershipSource,
        revisionId: provenance.revisionId,
        revisionNumber: provenance.revisionNumber,
      });
    }
    // Tail the entity-mention HARD STOP reminder so it is the last thing the
    // subagent reads before composing its report — parity with the main-session
    // per-turn append in `resolve-prompt.ts`. Prior reports are prepended, so
    // the reminder stays at the very end.
    const basePrompt = `${prependPriorReports(composed, priorReports)}\n\n${mentionFormatReminder}`;

    // An eval child writes as its attempt's target session, never the Run's,
    // so the platform attributes its output to that attempt.
    const mcpContext = {
      ...(session.contextMetadata?.projectId
        ? { projectId: session.contextMetadata.projectId }
        : {}),
      ...(evalExecution
        ? { conversationId: evalExecution.targetConversationId }
        : session.conversationId
          ? { conversationId: session.conversationId }
          : {}),
      ...(session.launchServiceId ? { serviceId: session.launchServiceId } : {}),
      agentSessionId: evalExecution ? evalExecution.targetSessionId : session.agentic_session_id,
    };
    const mcpConfig = await buildMcpServerConfig(oauthClient, mcpContext);

    // Assemble the platform system prompt from the project's active work-item
    // type definitions, read once before the subagent session starts. A failed
    // read aborts the subagent rather than opening on a stale or empty ontology.
    const sessionStartContext = await readSessionStartContext({
      oauthClient,
      projectId: session.contextMetadata?.projectId,
    });
    const configuredApiUrl = process.env['HEYHEY_API_URL']?.trim() || 'https://heyhey.dev';
    const roleGuidance = await new SessionRoleGuidance({
      auth: new SubmissionToolAuth(oauthClient),
      logger,
      apiBaseUrl: configuredApiUrl.endsWith('/api/v1')
        ? configuredApiUrl
        : `${configuredApiUrl.replace(/\/$/u, '')}/api/v1`,
    }).prepare({
      session,
      handler,
      payload: enrichedPayload,
      fresh: true,
      ...(startupPromptInput ? { startup: startupPromptInput } : {}),
      definitions: sessionStartContext.workItemTypeDefinitions,
    });
    const prompt = [roleGuidance.text, basePrompt].filter(Boolean).join('\n\n');
    const providerId = resolveAgentProviderId(session.provider);
    const platformSystemPrompt = buildPlatformSystemPrompt(
      sessionStartContext.workItemTypeDefinitions,
      providerId === 'codex'
        ? {
            provider: providerId,
            model: model ?? session.model ?? null,
            ...(handler.epistemicCalibration ? { epistemicCalibration: true as const } : {}),
          }
        : undefined,
      {
        intentFirst: sessionStartContext.intentFirst,
        maturity: sessionStartContext.maturity,
        hints: resolveHintPromptAccess(sessionStartContext.hintsEnabled, config.mcpAllowedTools),
      },
    );

    const mcpAllowedShortNames = evalExecution
      ? withholdEvalMutationTools(config.mcpAllowedTools)
      : [...config.mcpAllowedTools];
    const allowedMcpTools = mcpAllowedShortNames.map((tool) => `mcp__${MCP_SERVER_NAME}__${tool}`);
    const allowedMcpToolsSet = new Set(allowedMcpTools);
    const allowedBuiltinSet = new Set(config.builtinAllowedTools);
    const readOnlyFilesystem = handler.readOnlyFilesystem === true;
    const touchedFilesSet = new Set(touchedFiles);

    // Use the Run-resolved roots verbatim when present. In worktree-backed
    // sessions, service metadata may still name ordinary checkouts and must
    // never widen the provider's write authority.
    const allowedRepoRoots = new Set<string>(
      (allowedRepositoryRoots ?? [cwd]).map((root) => path.resolve(root)),
    );

    // If this run has submission tools registered (e.g. a pass-through
    // report tool on the project_assistant subagent), expose them via the
    // CLI's local HTTP MCP server. Mirrors the same attachment in
    // `session-runner-claude.ts` for provider-session runners.
    const runRegistration = submissionToolRegistry.getByRunId(runId);
    const cliBaseUrl = localAgentEndpoint.get();
    let submissionAllowedTools: readonly string[] = [];
    let mcpServers: Record<string, unknown> = mcpConfig.mcpServers;
    if (evalExecution) {
      // Eval children reach the platform only through a CLI proxy that hides
      // eval reports; they never mount the Run's submission tools.
      if (!cliBaseUrl) throw new Error('Eval child requires the local agent endpoint.');
      const proxy = new EvalChildPlatformMcpProxy({
        runId,
        attemptId: evalExecution.attemptId,
        context: mcpContext,
        allowedTools: mcpAllowedShortNames,
        activeHandlerPromptType: handler.promptType,
        logger,
      });
      const unregister = childPlatformMcpProxies.register(proxy);
      this.releaseEvalProxy = () => {
        proxy.close();
        unregister();
      };
      mcpServers = buildPlatformMcpProxyMcpConfig({ mount: proxy.mount, cliBaseUrl }).mcpServers;
      if (researchTools) {
        const researchProxy = new EvalChildPlatformMcpProxy({
          runId,
          attemptId: evalExecution.attemptId,
          context: mcpContext,
          allowedTools: [],
          activeHandlerPromptType: handler.promptType,
          logger,
          researchTools,
        });
        const unregisterResearch = childPlatformMcpProxies.register(researchProxy);
        this.releaseEvalProxy = () => {
          proxy.close();
          unregister();
          researchProxy.close();
          unregisterResearch();
        };
        const researchConfig = buildPlatformMcpProxyMcpConfig({
          mount: researchProxy.mount,
          cliBaseUrl,
        });
        mcpServers = { ...mcpServers, 'heyhey-submission-tools': researchConfig.serverEntry };
        submissionAllowedTools = researchTools.toolNames.map(
          (name) => `mcp__heyhey-submission-tools__${name}`,
        );
      }
    } else if (
      config.submissionTools !== 'none' &&
      runRegistration &&
      cliBaseUrl &&
      runRegistration.tools.length > 0
    ) {
      const submissionConfig = buildSubmissionToolsMcpConfig({
        token: runRegistration.token,
        cliBaseUrl,
        tools: runRegistration.tools,
      });
      mcpServers = { ...mcpServers, [submissionConfig.serverName]: submissionConfig.serverEntry };
      submissionAllowedTools = submissionConfig.allowedTools;
      requestContext.log(logger, 'info', 'local.subagent.submission_tools.attached', {
        runId,
        adapterId: config.adapterId,
        toolCount: runRegistration.tools.length,
        allowedTools: submissionConfig.allowedTools,
      });
    } else {
      requestContext.log(logger, 'info', 'local.subagent.submission_tools.not_attached', {
        runId,
        adapterId: config.adapterId,
        promptType: handler.promptType,
        optedOut: config.submissionTools === 'none',
        hasRunRegistration: runRegistration !== undefined && runRegistration !== null,
        registeredToolCount: runRegistration?.tools.length ?? 0,
        hasCliBaseUrl: Boolean(cliBaseUrl),
      });
    }
    const submissionAllowedSet = new Set(submissionAllowedTools);

    const allowedTools = [
      ...allowedMcpTools,
      ...config.builtinAllowedTools,
      ...submissionAllowedTools,
    ];
    const emitNormalizedEvents = config.emitNormalizedEvents ?? true;
    // Only a Turn-owning subagent feeds the Run's context gauge; a child launched
    // from a provider-session handler's childConfig never reaches Run ingress.
    const countsForContext =
      handler.runnerKind === 'subagent' && handler.providerSessionCountsForContext;
    const delivery = composeFreshPlatformPromptDelivery({
      mode: resolveProviderPlatformPromptDeliveryMode(
        providerId === 'codex' ? 'codex' : 'claude',
        handler.replaceProviderSystemPrompt,
      ),
      assembledPlatformPrompt: platformSystemPrompt,
      resolvedFirstTurnInput: prompt,
    });
    const startSessionConfig = {
      prompt: delivery.firstTurnInput,
      // Children have independent model selections. Fast mode is on only when the user chose it
      // for this child; otherwise saved Claude preferences are disabled so they cannot switch
      // the child's model.
      fastMode: fastMode === true,
      cwd,
      permissionMode: 'default' as const,
      ...(delivery.mode === PLATFORM_PROMPT_DELIVERY_MODE.FULL_SYSTEM_PROMPT
        ? { systemPrompt: delivery.systemPrompt }
        : delivery.mode === PLATFORM_PROMPT_DELIVERY_MODE.APPENDED_SYSTEM_SLOT
          ? { appendSystemPrompt: delivery.appendedSystemPrompt }
          : {}),
      mcpServers,
      allowedTools,
      ...(model ? { model } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
    };

    const budgetGuard =
      tokenBudget === undefined
        ? null
        : new TokenBudgetGuard(tokenBudget, signal, (tokensUsed) => {
            requestContext.log(logger, 'info', 'local.subagent.token_budget.exhausted', {
              runId,
              adapterId: config.adapterId,
              tokenBudget,
              tokensUsed,
            });
          });
    const sessionSignal = budgetGuard?.signal ?? signal;

    if (providerId === 'codex') {
      return this.executeCodex({
        session,
        config,
        prompt,
        cwd,
        delivery,
        mcpServers,
        allowedMcpTools,
        allowedBuiltinSet,
        submissionAllowedTools,
        submissionAllowedSet,
        touchedFiles,
        touchedFilesSet,
        allowedRepoRoots,
        enforceWorkspaceContainment: allowedRepositoryRoots !== undefined,
        readOnlyFilesystem,
        onAgentOutput,
        logger,
        signal: sessionSignal,
        budgetGuard,
        runId,
        model,
        reasoningEffort,
        fastMode,
        emitNormalizedEvents,
        countsForContext,
      });
    }

    if (providerId !== 'claude') {
      throw new Error(
        `Subagent provider "${providerId}" is not supported for promptType "${handler.promptType}".`,
      );
    }

    const client = new ClaudeCodeSdkClient();

    client.onPermissionRequest(
      async (toolName: string, input: unknown): Promise<ClaudeCodePermissionResult> => {
        // Allowlist short-circuit: anything statically permitted is allowed
        // unless the handler also wants to inspect it dynamically. The
        // decidePermission hook runs only for tools NOT in the static
        // allowlist (or for tools the handler explicitly wants to gate, like
        // commit's Bash policy — see commitHandler.decidePermission).
        const inAllowlist =
          allowedMcpToolsSet.has(toolName) ||
          allowedBuiltinSet.has(toolName) ||
          submissionAllowedSet.has(toolName);
        if (config.decidePermission) {
          const result = await config.decidePermission({
            toolName,
            input,
            touchedFiles,
            touchedFilesSet,
            allowedRepoRoots,
            logger,
            runId,
          });
          if (result.behavior === 'allow') {
            return { behavior: 'allow', updatedInput: {} };
          }
          requestContext.log(logger, 'warn', 'local.subagent.permission.denied', {
            runId,
            adapterId: config.adapterId,
            toolName,
            reason: result.message,
          });
          return { behavior: 'deny', message: result.message };
        }
        if (inAllowlist) {
          return { behavior: 'allow', updatedInput: {} };
        }
        requestContext.log(logger, 'warn', 'local.subagent.permission.denied', {
          runId,
          adapterId: config.adapterId,
          toolName,
        });
        return {
          behavior: 'deny',
          message: `Tool is not in the ${config.adapterId} allowlist.`,
        };
      },
    );

    let bufferedAssistantText: string | null = null;
    let lastAssistantText = '';
    let assistantCompleted = false;
    let contextReading: SubAgentContextReading | null | undefined;
    let firstProviderEventReceived = false;
    let lastProcessingKind: ProviderPhase | null = null;

    const emit = (input: {
      source: 'provider' | 'local';
      eventType: string;
      timestamp: string;
      sessionId: string | null;
      agentId: string | null;
      payload: Record<string, unknown>;
    }): void => {
      onAgentOutput({ event: input });
    };

    const normalizationConfig = emitNormalizedEvents
      ? loadProviderEventNormalizationConfig()
      : null;
    const tokensByMessage = new Map<string, number>();

    client.onEvent((event: ClaudeCodeSdkEvent) => {
      const eventType = typeof event['type'] === 'string' ? event['type'] : 'unknown';
      if (eventType === 'assistant') this.usageMeter.recordClaudeAssistant(event);
      if (budgetGuard && eventType === 'assistant') {
        const usage = readClaudeMessageUsage(event);
        if (usage) {
          tokensByMessage.set(
            usage.messageId,
            Math.max(tokensByMessage.get(usage.messageId) ?? 0, usage.tokens),
          );
          let tokensUsed = 0;
          for (const tokens of tokensByMessage.values()) tokensUsed += tokens;
          budgetGuard.record(tokensUsed);
          this.args.evalExecution?.tokenBudget?.record(this.budgetIdentity, tokensUsed);
        }
      }
      const eventTimestamp =
        typeof event['timestamp'] === 'string' ? event['timestamp'] : new Date().toISOString();
      const eventSessionId = typeof event['session_id'] === 'string' ? event['session_id'] : null;

      if (normalizationConfig) {
        emitNormalizedSubagentEvent({
          rawEvent: event,
          runId,
          agentId: AGENT_ID,
          onAgentOutput,
          config: normalizationConfig,
        });
      }

      if (!firstProviderEventReceived) {
        firstProviderEventReceived = true;
        lastProcessingKind = 'thinking';
        emit({
          source: 'local',
          eventType: 'processing_status',
          timestamp: new Date().toISOString(),
          sessionId: eventSessionId,
          agentId: AGENT_ID,
          payload: { kind: 'loading.update', loadingText: 'Thinking...', phase: 'thinking' },
        });
      }

      if (eventType === 'assistant' && lastProcessingKind !== 'writing') {
        lastProcessingKind = 'writing';
        emit({
          source: 'local',
          eventType: 'processing_status',
          timestamp: new Date().toISOString(),
          sessionId: eventSessionId,
          agentId: AGENT_ID,
          payload: { kind: 'loading.update', loadingText: 'Writing response...', phase: 'writing' },
        });
      } else if (
        eventType !== 'assistant' &&
        eventType !== 'result' &&
        lastProcessingKind !== 'thinking'
      ) {
        lastProcessingKind = 'thinking';
        emit({
          source: 'local',
          eventType: 'processing_status',
          timestamp: new Date().toISOString(),
          sessionId: eventSessionId,
          agentId: AGENT_ID,
          payload: { kind: 'loading.update', loadingText: 'Thinking...', phase: 'thinking' },
        });
      }

      if (eventType === 'system' && event['subtype'] === 'init') {
        requestContext.log(logger, 'info', 'local.subagent.tool_search.init_diff', {
          runId,
          adapterId: config.adapterId,
          promptType: handler.promptType,
          ...summarizeClaudeInitToolExposure(event, allowedTools, []),
        });
      }

      if (eventType === 'assistant') {
        const text = extractAssistantText(event);
        if (text) {
          if (bufferedAssistantText) {
            emit({
              source: 'provider',
              eventType: 'agent_output',
              timestamp: eventTimestamp,
              sessionId: eventSessionId,
              agentId: AGENT_ID,
              payload: { messageType: 'assistant', summary: bufferedAssistantText },
            });
          }
          bufferedAssistantText = text;
          lastAssistantText = text;
        }
        return;
      }

      if (eventType === 'result') {
        if (bufferedAssistantText) {
          emit({
            source: 'provider',
            eventType: 'agent_output',
            timestamp: eventTimestamp,
            sessionId: eventSessionId,
            agentId: AGENT_ID,
            payload: {
              messageType: 'assistant',
              summary: bufferedAssistantText,
              taskComplete: true,
            },
          });
          bufferedAssistantText = null;
          assistantCompleted = true;
        }
      }
    });

    emit({
      source: 'provider',
      eventType: 'run_started',
      timestamp: new Date().toISOString(),
      sessionId: session.agentic_session_id,
      agentId: AGENT_ID,
      payload: {
        prompt,
        adapterId: config.adapterId,
        providerStartupInput: {
          prompt: startSessionConfig.prompt,
          systemPrompt:
            delivery.mode === PLATFORM_PROMPT_DELIVERY_MODE.FULL_SYSTEM_PROMPT
              ? delivery.systemPrompt
              : delivery.mode === PLATFORM_PROMPT_DELIVERY_MODE.APPENDED_SYSTEM_SLOT
                ? delivery.appendedSystemPrompt
                : null,
        },
      },
    });

    requestContext.log(logger, 'debug', 'local.subagent.started', {
      runId,
      adapterId: config.adapterId,
      projectId: session.contextMetadata?.projectId,
      conversationId: session.conversationId,
      touchedFileCount: touchedFiles.length,
      allowedMcpToolCount: allowedMcpTools.length,
    });

    requestContext.log(logger, 'debug', 'local.subagent.start_session.config', {
      runId,
      adapterId: config.adapterId,
      provider: session.provider,
      modelIncluded: model !== undefined,
      model: model ?? null,
      reasoningEffortIncluded: reasoningEffort !== undefined,
      reasoningEffort: reasoningEffort ?? null,
      allowedToolCount: allowedTools.length,
      mcpServerCount: Object.keys(mcpServers).length,
    });

    let readOnlyBoundary: RunWorkspaceWriteBoundary | undefined;
    try {
      if (readOnlyFilesystem) {
        readOnlyBoundary = await RunWorkspaceWriteBoundary.create({
          ok: true,
          runMode: 'default',
          repositoryPathForRunStarted: cwd,
          cwd,
          allowedRepositoryRoots: [...allowedRepoRoots],
          bindingRepositoryPath: cwd,
          workspaceRoot: null,
        });
        requestContext.log(logger, 'debug', 'local.subagent.read_only.enforced', {
          runId,
          adapterId: config.adapterId,
          provider: providerId,
        });
      }
      emit({
        source: 'local',
        eventType: 'processing_status',
        timestamp: new Date().toISOString(),
        sessionId: null,
        agentId: AGENT_ID,
        payload: { kind: 'loading.update', loadingText: 'Starting...', phase: 'starting' },
      });

      await client.startSession(
        {
          ...startSessionConfig,
          ...(readOnlyBoundary
            ? {
                builtinTools: [...config.builtinAllowedTools],
                workspaceContainment: readOnlyBoundary.claudeReadOnlyContainment(),
              }
            : {}),
        },
        sessionSignal ? { signal: sessionSignal } : undefined,
      );

      requestContext.log(logger, 'debug', 'local.subagent.completed', {
        runId,
        adapterId: config.adapterId,
        assistantCompleted,
      });
    } catch (error) {
      if (!budgetGuard?.isExhausted && !this.args.evalExecution?.tokenBudget?.isExhausted) {
        requestContext.log(logger, 'error', 'local.subagent.failed', {
          runId,
          adapterId: config.adapterId,
          error,
        });
        throw error;
      }
    } finally {
      client.onEvent(null);
      if (bufferedAssistantText && !assistantCompleted) {
        emit({
          source: 'provider',
          eventType: 'agent_output',
          timestamp: new Date().toISOString(),
          sessionId: session.agentic_session_id,
          agentId: AGENT_ID,
          payload: { messageType: 'assistant', summary: bufferedAssistantText },
        });
      }

      emit({
        source: 'local',
        eventType: 'run_completed',
        timestamp: new Date().toISOString(),
        sessionId: session.agentic_session_id,
        agentId: null,
        payload: assistantCompleted ? {} : { status: 'error' },
      });

      if (countsForContext) {
        contextReading = await readContextBeforeDisconnect({
          client,
          logger,
          runId,
          adapterId: config.adapterId,
        });
      }

      await readOnlyBoundary?.dispose();
      await client.disconnect().catch((error: unknown) => {
        requestContext.log(logger, 'warn', 'local.subagent.disconnect_failed', {
          runId,
          adapterId: config.adapterId,
          error,
        });
      });
    }

    return {
      assistantCompleted,
      outputText: lastAssistantText,
      ...(contextReading !== undefined ? { contextReading } : {}),
      ...(budgetGuard?.isExhausted || this.args.evalExecution?.tokenBudget?.isExhausted
        ? { budgetExhausted: true }
        : {}),
      usage: this.usageMeter.read(),
    };
  }

  private async executeCodex(input: {
    session: AgenticSession;
    config: SubagentConfig;
    prompt: string;
    cwd: string;
    delivery: PlatformPromptFreshDelivery;
    mcpServers: Record<string, unknown>;
    allowedMcpTools: readonly string[];
    allowedBuiltinSet: ReadonlySet<string>;
    submissionAllowedTools: readonly string[];
    submissionAllowedSet: ReadonlySet<string>;
    touchedFiles: readonly string[];
    touchedFilesSet: ReadonlySet<string>;
    allowedRepoRoots: ReadonlySet<string>;
    enforceWorkspaceContainment: boolean;
    readOnlyFilesystem: boolean;
    onAgentOutput: AgentOutputHandler;
    logger: ServerLogger;
    signal?: AbortSignal | undefined;
    budgetGuard: TokenBudgetGuard | null;
    runId: string;
    model?: string | undefined;
    reasoningEffort?: LocalReasoningEffort | undefined;
    fastMode?: boolean | undefined;
    emitNormalizedEvents: boolean;
    countsForContext: boolean;
  }): Promise<SubAgentResult> {
    const {
      session,
      config,
      prompt,
      cwd,
      delivery,
      mcpServers,
      allowedMcpTools,
      allowedBuiltinSet,
      submissionAllowedTools,
      submissionAllowedSet,
      touchedFiles,
      touchedFilesSet,
      allowedRepoRoots,
      enforceWorkspaceContainment,
      readOnlyFilesystem,
      onAgentOutput,
      logger,
      signal,
      budgetGuard,
      runId,
      model,
      reasoningEffort,
      fastMode,
      emitNormalizedEvents,
      countsForContext,
    } = input;

    const platformEntry = toPlatformMcpEntry(mcpServers[MCP_SERVER_NAME]);
    const platformMcpConfig = platformEntry ? toCodexPlatformMcpConfig(platformEntry) : null;
    const submissionConfig = (() => {
      for (const [serverName, serverEntry] of Object.entries(mcpServers)) {
        if (serverName === MCP_SERVER_NAME) continue;
        const converted = toCodexSubmissionMcpConfig(serverName, serverEntry);
        if (converted) return converted;
      }
      return null;
    })();
    const codexPermissionPlan: CodexPermissionPlan =
      readOnlyFilesystem || config.codexSandboxMode === 'read-only'
        ? {
            sandboxMode: 'read-only',
            cwd,
            allowedRepositoryRoots: [...allowedRepoRoots],
            extraWritableDirs: [],
          }
        : enforceWorkspaceContainment
          ? await resolveCodexPermissionPlan({
              cwd,
              allowedRepositoryRoots: [...allowedRepoRoots],
              enforceWorkspaceContainment: true,
            })
          : {
              sandboxMode: 'workspace-write',
              cwd,
              allowedRepositoryRoots: [...allowedRepoRoots],
              extraWritableDirs: [],
            };
    const mcpConfig = mergeCodexMcpConfigs([platformMcpConfig, submissionConfig]);
    const codexConfig = applyCodexSessionReviewerPolicy(
      codexPermissionPlan.workspaceWriteConfig
        ? applyCodexWorkspaceContainment(mcpConfig, codexPermissionPlan.workspaceWriteConfig)
        : mcpConfig,
      codexPermissionPlan.sandboxMode,
    );
    const allowedMcpToolNames = new Set([...allowedMcpTools, ...submissionAllowedTools]);
    const client = new CodexSdkClient();
    const normalizationConfig = emitNormalizedEvents
      ? loadProviderEventNormalizationConfig()
      : null;
    let bufferedAssistantText = '';
    let lastAssistantText = '';
    let assistantCompleted = false;
    let contextReading: SubAgentContextReading | null | undefined;
    let firstProviderEventReceived = false;
    let lastProcessingKind: ProviderPhase | null = null;

    const emit = (event: {
      source: 'provider' | 'local';
      eventType: string;
      timestamp: string;
      sessionId: string | null;
      agentId: string | null;
      payload: Record<string, unknown>;
    }): void => {
      onAgentOutput({ event });
    };

    const emitProcessingStatus = (
      inputStatus: {
        kind: 'loading.update';
        loadingText: string;
        phase: ProviderPhase;
      },
      sessionId: string | null,
    ): void => {
      emit({
        source: 'local',
        eventType: 'processing_status',
        timestamp: new Date().toISOString(),
        sessionId,
        agentId: CODEX_AGENT_ID,
        payload: inputStatus,
      });
    };

    const submitClientResponse = (
      rawRequestId: string | number,
      accepted: boolean,
      kind: 'mcp_elicitation' | 'approval',
    ): void => {
      const response =
        kind === 'mcp_elicitation'
          ? {
              action: accepted ? 'accept' : 'decline',
              content: null,
              _meta: null,
            }
          : { decision: accepted ? 'accept' : 'decline' };
      client.submitClientResponse(rawRequestId, response);
    };

    const decideCodexServerRequest = async (
      request: CodexSdkServerRequest,
    ): Promise<{ accepted: boolean; kind: 'mcp_elicitation' | 'approval'; reason?: string }> => {
      if (request.method === CODEX_MCP_ELICITATION_METHOD) {
        const tool = readMcpElicitationTool(request);
        if (tool.qualifiedToolName && allowedMcpToolNames.has(tool.qualifiedToolName)) {
          return { accepted: true, kind: 'mcp_elicitation' };
        }
        if (tool.serverName && HEYHEY_MCP_SERVER_NAMES.has(tool.serverName)) {
          return {
            accepted: false,
            kind: 'mcp_elicitation',
            reason: `MCP tool ${tool.qualifiedToolName ?? '(unknown)'} is not in the subagent allowlist.`,
          };
        }
        return {
          accepted: false,
          kind: 'mcp_elicitation',
          reason: 'External MCP elicitations are not supported for ephemeral subagents.',
        };
      }

      // A read-only sandbox must never be upgraded by an approval request.
      // Normal inspection/check commands execute inside it without escalation.
      if (codexPermissionPlan.sandboxMode === 'read-only') {
        return {
          accepted: false,
          kind: 'approval',
          reason: 'This subagent cannot authorize filesystem writes or sandbox escalation.',
        };
      }

      if (!config.decidePermission) {
        if (
          request.method === 'applyPatchApproval' ||
          request.method === 'item/fileChange/requestApproval'
        ) {
          return {
            accepted: allowedBuiltinSet.has('Edit') || allowedBuiltinSet.has('Write'),
            kind: 'approval',
          };
        }
        if (
          request.method === 'execCommandApproval' ||
          request.method === 'item/commandExecution/requestApproval'
        ) {
          return { accepted: allowedBuiltinSet.has('Bash'), kind: 'approval' };
        }
        return {
          accepted: false,
          kind: 'approval',
          reason: `Unsupported Codex request ${request.method}.`,
        };
      }

      if (
        request.method === 'execCommandApproval' ||
        request.method === 'item/commandExecution/requestApproval'
      ) {
        const params = request.params ?? {};
        const bashInput = codexCommandToBashInput(params);
        if (!bashInput) {
          return {
            accepted: false,
            kind: 'approval',
            reason: 'Bash command approval missing command.',
          };
        }
        const decision = await config.decidePermission({
          toolName: 'Bash',
          input: bashInput,
          touchedFiles,
          touchedFilesSet,
          allowedRepoRoots,
          logger,
          runId,
        });
        return {
          accepted: decision.behavior === 'allow',
          kind: 'approval',
          ...(decision.behavior === 'deny' ? { reason: decision.message } : {}),
        };
      }

      if (
        request.method === 'applyPatchApproval' ||
        request.method === 'item/fileChange/requestApproval'
      ) {
        return {
          accepted: false,
          kind: 'approval',
          reason: 'File-change approvals are not permitted by this subagent policy.',
        };
      }

      return {
        accepted: false,
        kind: 'approval',
        reason: `Unsupported Codex request ${request.method}.`,
      };
    };

    client.onEvent((event: CodexSdkEvent) => {
      const eventTimestamp = new Date().toISOString();
      const fallbackSessionId = client.getSessionId();

      if (normalizationConfig) {
        const normalized = mapCodexEvent({
          provider: 'codex',
          runId,
          eventType: event.method,
          timestamp: eventTimestamp,
          sessionId: fallbackSessionId,
          agentId: CODEX_AGENT_ID,
          rawEvent: event.params ?? {},
          config: normalizationConfig,
        });
        const payloadSessionId = normalized.payload['session_id'];
        const sessionIdForEmit =
          typeof payloadSessionId === 'string' ? payloadSessionId : fallbackSessionId;
        emit({
          source: 'provider',
          eventType: normalized.resolvedEventType ?? event.method,
          timestamp: eventTimestamp,
          sessionId: sessionIdForEmit,
          agentId: CODEX_AGENT_ID,
          payload: normalized.payload,
        });

        if (normalized.assistantText && normalized.assistantText.kind === 'text') {
          if (normalized.assistantText.isFinal) {
            bufferedAssistantText = normalized.assistantText.text;
          } else if (normalized.assistantText.text.length > bufferedAssistantText.length) {
            bufferedAssistantText = normalized.assistantText.text;
          }
        }
        if (normalized.assistantTextDelta) {
          bufferedAssistantText += normalized.assistantTextDelta;
        }

        if (!firstProviderEventReceived) {
          firstProviderEventReceived = true;
          lastProcessingKind = 'thinking';
          emitProcessingStatus(
            { kind: 'loading.update', loadingText: 'Thinking...', phase: 'thinking' },
            sessionIdForEmit,
          );
        }
        if (normalized.assistantText && lastProcessingKind !== 'writing') {
          lastProcessingKind = 'writing';
          emitProcessingStatus(
            { kind: 'loading.update', loadingText: 'Writing response...', phase: 'writing' },
            sessionIdForEmit,
          );
        } else if (
          !normalized.assistantText &&
          !normalized.isTerminal &&
          lastProcessingKind !== 'thinking'
        ) {
          lastProcessingKind = 'thinking';
          emitProcessingStatus(
            { kind: 'loading.update', loadingText: 'Thinking...', phase: 'thinking' },
            sessionIdForEmit,
          );
        }

        if (normalized.isTerminal) {
          assistantCompleted = true;
          if (bufferedAssistantText.length > 0) {
            lastAssistantText = bufferedAssistantText;
            emit({
              source: 'provider',
              eventType: 'agent_output',
              timestamp: eventTimestamp,
              sessionId: sessionIdForEmit,
              agentId: CODEX_AGENT_ID,
              payload: {
                messageType: 'assistant',
                summary: bufferedAssistantText,
                taskComplete: true,
              },
            });
            bufferedAssistantText = '';
          }
        }
        return;
      }

      if (!firstProviderEventReceived) {
        firstProviderEventReceived = true;
        lastProcessingKind = 'thinking';
        emitProcessingStatus(
          { kind: 'loading.update', loadingText: 'Thinking...', phase: 'thinking' },
          fallbackSessionId,
        );
      }
    });

    // Codex reports cumulative thread totals, so each update replaces the last.
    client.onTokenUsage((usage) => {
      this.usageMeter.recordCodexTotals(usage);
      budgetGuard?.record(
        (usage.inputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0) + usage.outputTokens,
      );
      this.args.evalExecution?.tokenBudget?.record(
        this.budgetIdentity,
        (usage.inputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0) + usage.outputTokens,
      );
    });

    client.onServerRequest((request: CodexSdkServerRequest) => {
      void (async () => {
        const decision = await decideCodexServerRequest(request);
        if (!decision.accepted) {
          requestContext.log(logger, 'warn', 'local.subagent.codex.permission.denied', {
            runId,
            adapterId: config.adapterId,
            method: request.method,
            rawRequestId: request.id,
            reason: decision.reason ?? null,
          });
        }
        submitClientResponse(request.id, decision.accepted, decision.kind);
      })().catch((error: unknown) => {
        requestContext.log(logger, 'error', 'local.subagent.codex.permission.failed', {
          runId,
          adapterId: config.adapterId,
          method: request.method,
          rawRequestId: request.id,
          error,
        });
      });
    });

    const composedPrompt =
      delivery.mode === PLATFORM_PROMPT_DELIVERY_MODE.INITIAL_PREFIX
        ? delivery.prefixedFirstTurnInput
        : delivery.firstTurnInput;

    emit({
      source: 'provider',
      eventType: 'run_started',
      timestamp: new Date().toISOString(),
      sessionId: session.agentic_session_id,
      agentId: CODEX_AGENT_ID,
      payload: {
        prompt,
        adapterId: config.adapterId,
        providerStartupInput: {
          prompt: composedPrompt,
          systemPrompt:
            delivery.mode === PLATFORM_PROMPT_DELIVERY_MODE.BASE_INSTRUCTIONS
              ? delivery.baseInstructions
              : null,
        },
      },
    });

    requestContext.log(logger, 'debug', 'local.subagent.codex.started', {
      runId,
      adapterId: config.adapterId,
      projectId: session.contextMetadata?.projectId,
      conversationId: session.conversationId,
      touchedFileCount: touchedFiles.length,
      allowedMcpToolCount: allowedMcpTools.length,
      submissionAllowedToolCount: submissionAllowedSet.size,
      workspaceContainmentEnforced: enforceWorkspaceContainment,
      cwd: codexPermissionPlan.cwd,
      requestedCwd: cwd,
      launchServiceId: session.launchServiceId ?? null,
      services: session.services ?? [],
      allowedRepositoryRoots: codexPermissionPlan.allowedRepositoryRoots,
      extraWritableDirs: codexPermissionPlan.extraWritableDirs,
      platformPromptDeliveryMode: delivery.mode,
      reviewer: codexPermissionPlan.sandboxMode === 'read-only' ? 'user' : 'user-configured',
    });

    try {
      emitProcessingStatus(
        { kind: 'loading.update', loadingText: 'Starting...', phase: 'starting' },
        client.getSessionId(),
      );

      await client.startSession(
        {
          prompt: composedPrompt,
          ...(delivery.mode === PLATFORM_PROMPT_DELIVERY_MODE.BASE_INSTRUCTIONS
            ? { baseInstructions: delivery.baseInstructions }
            : {}),
          cwd: codexPermissionPlan.cwd,
          ...(codexPermissionPlan.sandboxMode ? { sandbox: codexPermissionPlan.sandboxMode } : {}),
          ...(codexPermissionPlan.extraWritableDirs.length > 0
            ? { extraWritableDirs: codexPermissionPlan.extraWritableDirs }
            : {}),
          ...(model ? { model } : {}),
          ...(codexConfig ? { config: codexConfig } : {}),
          ...(reasoningEffort ? { effort: reasoningEffort } : {}),
          ...(fastMode === undefined ? {} : { serviceTier: fastMode ? 'priority' : 'default' }),
        },
        signal ? { signal } : undefined,
      );
    } catch (error) {
      if (!budgetGuard?.isExhausted && !this.args.evalExecution?.tokenBudget?.isExhausted) {
        requestContext.log(logger, 'error', 'local.subagent.codex.failed', {
          runId,
          adapterId: config.adapterId,
          error,
        });
        throw error;
      }
    } finally {
      client.onEvent(null);
      client.onServerRequest(null);
      client.onTokenUsage(null);
      if (
        (budgetGuard?.isExhausted || this.args.evalExecution?.tokenBudget?.isExhausted) &&
        lastAssistantText.length === 0
      ) {
        lastAssistantText = bufferedAssistantText;
      }
      if (bufferedAssistantText.length > 0) {
        emit({
          source: 'provider',
          eventType: 'agent_output',
          timestamp: new Date().toISOString(),
          sessionId: session.agentic_session_id,
          agentId: CODEX_AGENT_ID,
          payload: { messageType: 'assistant', summary: bufferedAssistantText },
        });
      }
      emit({
        source: 'local',
        eventType: 'run_completed',
        timestamp: new Date().toISOString(),
        sessionId: session.agentic_session_id,
        agentId: null,
        payload: assistantCompleted ? {} : { status: 'error' },
      });
      if (countsForContext) {
        contextReading = await readContextBeforeDisconnect({
          client,
          logger,
          runId,
          adapterId: config.adapterId,
        });
      }
      await client.disconnect().catch((error: unknown) => {
        requestContext.log(logger, 'warn', 'local.subagent.codex.disconnect_failed', {
          runId,
          adapterId: config.adapterId,
          error,
        });
      });
    }

    return {
      assistantCompleted,
      outputText: lastAssistantText,
      ...(contextReading !== undefined ? { contextReading } : {}),
      ...(budgetGuard?.isExhausted || this.args.evalExecution?.tokenBudget?.isExhausted
        ? { budgetExhausted: true }
        : {}),
      usage: this.usageMeter.read(),
    };
  }
}
