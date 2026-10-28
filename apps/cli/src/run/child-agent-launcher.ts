import { randomUUID } from 'node:crypto';
import { createFirstTurnPromptRunState, resolvePrompt } from './resolve-prompt';
import { SessionRoleGuidance } from '../agents/session-role-guidance/session-role-guidance';
import { readSessionStartContext } from '../agents/prompts/session-start-context';
import type { PromptTypeHandlerBaseDeps, RecentUserReply } from '../agents/prompt-type-handler';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import type { OAuthClient } from '../auth';
import type { RepoMappingStore } from '../repo';
import { resolveRunWorkspace, resolveServiceBindingsForIds } from '../agents/run-scope';
import type {
  AgentStartupPromptInputResult,
  PromptTypeHandler,
  PromptTypeHandlerDeps,
} from '../agents/prompt-type-handler';
import type { PromptTypeRegistry } from '../agents/prompt-type-registry';
import type { SubmissionToolRegistry } from '../agents/submission-tools/registry';
import type { ServerLogger } from '../server/logger';
import type { LocalAgentEndpoint } from '../server/local-base-url';
import type { AgenticSession } from '../session/types';
import type { LocalReasoningEffort } from '../shared/agent-bridge-contract/index';
import { SubAgent, type SubAgentResult } from './subagent';
import type { AgentOutputHandler } from '../agents/agent-event-stream';
import type { ReportChainEntry } from './types';
import type { EvalExecutionContext } from '../agents/run-eval/eval-execution-context';
import { EvalChildExecution } from '../agents/run-eval/eval-child-execution';
import type { RunEntityReference } from '../shared/agent-bridge-contract/contract';

export interface ChildLaunchRequest {
  parentSession: AgenticSession;
  handler: PromptTypeHandler<unknown>;
  payload: unknown;
  signal: AbortSignal;
  workspace?: { cwd: string; allowedRepositoryRoots?: readonly string[] };
  touchedFiles?: readonly string[];
  priorReports?: ReadonlyArray<Readonly<ReportChainEntry>>;
  startupPromptInput?: AgentStartupPromptInputResult;
  onAgentOutput?: AgentOutputHandler;
  model?: string;
  reasoningEffort?: LocalReasoningEffort;
  /** Runs the child on this provider instead of the parent session's. */
  provider?: AgenticSession['provider'];
  fastMode?: boolean;
  /** Present for an admitted /subagent interaction; [] selects graph-only execution. */
  serviceIds?: readonly string[];
  launchServiceId?: string;
  /** Host-enforced provider token budget; the child is stopped once usage passes it. */
  tokenBudget?: number;
  /** Runs the child as one eval attempt: mutation tools withheld, eval reports hidden. */
  evalExecution?: EvalExecutionContext;
  /** The case's focal entity and normal preparation dependencies, isolated from its coordinator. */
  entity?: RunEntityReference;
  handlerDeps?: PromptTypeHandlerDeps;
  /** The caller owns preparation and has already persisted its results. */
  prepared?: boolean;
  promptContext?: {
    turnId: string;
    startedPromptTypes: ReadonlySet<string>;
    recentUserReplies: ReadonlyArray<RecentUserReply>;
    triggerParentMessageId: string | null;
  };
}

export type RegisteredChildLaunchRequest = Omit<ChildLaunchRequest, 'handler'>;

export interface ChildAgentLauncherDependencies {
  handlerDeps: Omit<PromptTypeHandlerBaseDeps, 'childAgentLauncher'>;
  promptTypeRegistry: PromptTypeRegistry;
  repoStore: RepoMappingStore;
  oauthClient: OAuthClient;
  submissionToolRegistry: SubmissionToolRegistry;
  localAgentEndpoint: LocalAgentEndpoint;
  logger: ServerLogger;
}

export class ChildAgentLauncher {
  public constructor(private readonly deps: ChildAgentLauncherDependencies) {}

  /** The registered handler a child launch by this id would run, for callers that read its declarations. */
  public resolveChildHandler(handlerId: string): PromptTypeHandler<unknown> | undefined {
    return this.deps.promptTypeRegistry.getChildHandler(handlerId);
  }

  public async launchRegistered(
    handlerId: string,
    request: RegisteredChildLaunchRequest,
  ): Promise<SubAgentResult> {
    const handler = this.resolveChildHandler(handlerId);
    if (!handler) throw new Error(`Child handler "${handlerId}" is not registered.`);
    return this.launch({ ...request, handler });
  }

  public async launch(request: ChildLaunchRequest): Promise<SubAgentResult> {
    const config = request.handler.subagentConfig ?? request.handler.childConfig;
    if (!config)
      throw new Error(`Child handler "${request.handler.id}" has no child configuration.`);
    let workspace = request.workspace;
    let session = request.parentSession;
    if (request.serviceIds !== undefined) {
      const serviceIds = request.serviceIds;
      if (serviceIds.length === 0) {
        session = { ...session, services: [] };
        delete session.launchServiceId;
        delete session.scope;
        delete session.worktree;
        delete session.worktreeState;
        workspace = { cwd: process.cwd() };
        this.deps.logger.debug('local.child_agent_launcher.workspace.selected', {
          decision: 'graph_only_current_directory',
          cwd: workspace.cwd,
          serviceIds,
        });
      } else {
        const launchServiceId = request.launchServiceId;
        if (!launchServiceId || !serviceIds.includes(launchServiceId)) {
          throw new Error('Admitted child launch Service is missing from its Service set.');
        }
        const reuseSourceWorkspace =
          request.parentSession.launchServiceId !== undefined &&
          serviceIds.includes(request.parentSession.launchServiceId);
        const sourceBindings = reuseSourceWorkspace
          ? new Map(request.parentSession.services.map((service) => [service.id, service]))
          : new Map();
        const serviceIdsToResolve = serviceIds.filter((id) => !sourceBindings.has(id));
        const bindings =
          serviceIdsToResolve.length > 0
            ? await resolveServiceBindingsForIds({
                serviceIds: serviceIdsToResolve,
                repoStore: this.deps.repoStore,
                logger: this.deps.logger,
              })
            : { ok: true as const, services: [] };
        if (!bindings.ok) throw new Error(bindings.message);
        for (const service of bindings.services) sourceBindings.set(service.id, service);
        session = {
          ...session,
          services: serviceIds.map((id) => {
            const service = sourceBindings.get(id);
            if (!service)
              throw new Error(`Selected Service ${id} has no resolved local directory.`);
            return service;
          }),
          launchServiceId,
        };
        delete session.scope;
        if (!reuseSourceWorkspace) {
          delete session.worktreeState;
        }
        const resolved = await resolveRunWorkspace({
          session: reuseSourceWorkspace ? request.parentSession : session,
          repoStore: this.deps.repoStore,
          logger: this.deps.logger,
        });
        if (!resolved.ok) throw new Error(resolved.message);
        workspace = reuseSourceWorkspace
          ? {
              ...resolved,
              allowedRepositoryRoots: [
                ...new Set([
                  resolved.cwd,
                  ...session.services.map(
                    (service) => resolved.worktree?.[service.id]?.worktreePath ?? service.path,
                  ),
                ]),
              ],
            }
          : resolved;
        this.deps.logger.debug('local.child_agent_launcher.workspace.selected', {
          decision: reuseSourceWorkspace ? 'reuse_source_workspace' : 'selected_service_workspace',
          cwd: workspace.cwd,
          serviceIds,
          launchServiceId,
        });
      }
    }
    if (
      !workspace &&
      request.handler.service === 'optional' &&
      (session.services?.length ?? 0) === 0
    ) {
      workspace = { cwd: process.cwd() };
      this.deps.logger.debug('local.child_agent_launcher.workspace.selected', {
        decision: 'graph_only_current_directory',
        handlerId: request.handler.id,
        cwd: workspace.cwd,
        serviceIds: [],
      });
    }
    if (!workspace) {
      const resolved = await resolveRunWorkspace({
        session: request.parentSession,
        repoStore: this.deps.repoStore,
        logger: this.deps.logger,
      });
      if (!resolved.ok) throw new Error(resolved.message);
      workspace = resolved;
    }
    if (request.provider) session = { ...session, provider: request.provider };
    if (request.model) session = { ...session, model: request.model };
    if (request.reasoningEffort) session = { ...session, reasoningEffort: request.reasoningEffort };
    const evalChild = request.evalExecution
      ? new EvalChildExecution({ ...request, evalExecution: request.evalExecution }, session, this)
      : undefined;
    try {
      await evalChild?.prepare();
    } catch (error) {
      if (evalChild?.execution.tokenBudget?.isExhausted)
        return { assistantCompleted: false, budgetExhausted: true, usage: {} };
      throw error;
    }
    if (evalChild) session = evalChild.session;
    const startupPromptInput = evalChild?.startupPromptInput ?? request.startupPromptInput;
    const sessionStartContext = await readSessionStartContext({
      oauthClient: this.deps.oauthClient,
      projectId: session.contextMetadata?.projectId,
    });
    const baseHandlerDeps: PromptTypeHandlerDeps = {
      ...(request.handlerDeps ?? this.deps.handlerDeps),
      childAgentLauncher: this,
      // Preparation uses the same tool-free launch for ordinary children and
      // evals. Evals carry only their identity, cancellation and shared budget.
      promptOnce: async ({ prompt }) => {
        const result = await this.launchRegistered('eval_preparation', {
          parentSession: session,
          payload: { prompt },
          signal: evalChild?.execution.tokenBudget?.signal ?? request.signal,
          serviceIds: [],
          ...(evalChild ? { evalExecution: evalChild.execution } : {}),
          ...(request.tokenBudget !== undefined ? { tokenBudget: request.tokenBudget } : {}),
        });
        evalChild?.recordPreparation(result);
        if (!result.assistantCompleted || !result.outputText) {
          throw new Error('Child preparation ended without a result.');
        }
        return result.outputText;
      },
    };
    const handlerDeps = evalChild?.preparationDeps(baseHandlerDeps) ?? baseHandlerDeps;
    const resolved = await resolvePrompt({
      handler: request.handler,
      run: session,
      runState: {
        ...createFirstTurnPromptRunState(),
        startupPromptInput: startupPromptInput ?? null,
        reportChain: config.includePriorReports === false ? [] : (request.priorReports ?? []),
        memos: evalChild?.memos ?? [],
        startedPromptTypes: request.promptContext?.startedPromptTypes ?? new Set(),
      },
      input: {
        promptType: request.handler.promptType,
        payload: evalChild?.payload ?? request.payload,
      } as InternalRunPromptRequest,
      handlerDeps,
      turnId: request.promptContext?.turnId ?? request.evalExecution?.attemptId ?? randomUUID(),
      abortSignal: () => evalChild?.execution.tokenBudget?.signal ?? request.signal,
      recentUserReplies: request.promptContext?.recentUserReplies ?? [],
      triggerParentMessageId: request.promptContext?.triggerParentMessageId ?? null,
      childExecution: {
        prepared: request.prepared === true,
        touchedFiles: request.touchedFiles ?? [],
        roleGuidance: new SessionRoleGuidance(handlerDeps),
        definitions: sessionStartContext.workItemTypeDefinitions,
      },
    });
    evalChild?.resolved(resolved.preparedPayload ?? request.payload, resolved.startupPromptInput);
    if (!resolved.resolvedPrompt) {
      throw new Error(`Child handler "${request.handler.id}" produced no prompt.`);
    }
    this.deps.logger.debug('local.child_agent_launcher.start', {
      handlerId: request.handler.id,
      provider: session.provider,
      adapterId: config.adapterId,
    });
    const child = new SubAgent({
      session,
      handler: request.handler,
      config: {
        ...config,
        // Child execution keeps the handler's payload-dependent authority;
        // SubAgent withholds direct live mutations only after this resolution.
        mcpAllowedTools: [
          ...new Set([
            ...config.mcpAllowedTools,
            ...(request.handler.resolveAdditionalAllowedTools?.({
              session,
              input: {
                promptType: request.handler.promptType,
                payload: resolved.preparedPayload ?? request.payload,
              } as InternalRunPromptRequest,
              payload: resolved.preparedPayload ?? request.payload,
            }) ?? []),
          ]),
        ],
      },
      prompt: resolved.resolvedPrompt,
      sessionStartContext,
      touchedFiles: request.touchedFiles ?? [],
      onAgentOutput: request.onAgentOutput ?? (() => {}),
      oauthClient: this.deps.oauthClient,
      logger: this.deps.logger,
      signal: request.signal,
      cwd: workspace.cwd,
      ...(workspace.allowedRepositoryRoots
        ? { allowedRepositoryRoots: workspace.allowedRepositoryRoots }
        : {}),
      priorReports: request.priorReports ?? [],
      ...(resolved.startupPromptInput ? { startupPromptInput: resolved.startupPromptInput } : {}),
      submissionToolRegistry: this.deps.submissionToolRegistry,
      localAgentEndpoint: this.deps.localAgentEndpoint,
      ...(request.model ? { model: request.model } : {}),
      ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
      ...(request.fastMode !== undefined ? { fastMode: request.fastMode } : {}),
      ...(request.tokenBudget !== undefined ? { tokenBudget: request.tokenBudget } : {}),
      ...(evalChild ? { evalExecution: evalChild.execution } : {}),
      ...(evalChild?.researchTools ? { researchTools: evalChild.researchTools } : {}),
    });
    const startedAt = Date.now();
    const result = await child.execute();
    return evalChild?.complete(result, Date.now() - startedAt) ?? result;
  }
}
