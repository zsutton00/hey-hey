import type { OAuthClient } from '../auth';
import type { RepoMappingStore } from '../repo';
import { resolveRunWorkspace, resolveServiceBindingsForIds } from '../agents/run-scope';
import type {
  AgentStartupPromptInputResult,
  PromptTypeHandler,
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
}

export type RegisteredChildLaunchRequest = Omit<ChildLaunchRequest, 'handler'>;

export interface ChildAgentLauncherDependencies {
  promptTypeRegistry: PromptTypeRegistry;
  repoStore: RepoMappingStore;
  oauthClient: OAuthClient;
  submissionToolRegistry: SubmissionToolRegistry;
  localAgentEndpoint: LocalAgentEndpoint;
  logger: ServerLogger;
}

export class ChildAgentLauncher {
  public constructor(private readonly deps: ChildAgentLauncherDependencies) {}

  public async launchRegistered(
    handlerId: string,
    request: RegisteredChildLaunchRequest,
  ): Promise<SubAgentResult> {
    const handler = this.deps.promptTypeRegistry.getChildHandler(handlerId);
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
    this.deps.logger.debug('local.child_agent_launcher.start', {
      handlerId: request.handler.id,
      provider: session.provider,
      adapterId: config.adapterId,
    });
    const child = new SubAgent({
      session,
      handler: request.handler,
      config,
      payload: request.payload,
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
      ...(request.startupPromptInput ? { startupPromptInput: request.startupPromptInput } : {}),
      submissionToolRegistry: this.deps.submissionToolRegistry,
      localAgentEndpoint: this.deps.localAgentEndpoint,
      ...(request.model ? { model: request.model } : {}),
      ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
      ...(request.fastMode !== undefined ? { fastMode: request.fastMode } : {}),
      ...(request.tokenBudget !== undefined ? { tokenBudget: request.tokenBudget } : {}),
      ...(request.evalExecution ? { evalExecution: request.evalExecution } : {}),
    });
    return child.execute();
  }
}
