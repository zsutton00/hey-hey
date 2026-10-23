import type { InputAdmissionLifecycle } from './input-admission/admission-lifecycle';
import type { OperationTimelineRegistry } from './input-admission/operation-timeline';
import { WorkspaceSkillsReadHandler } from './workspace-skills-read-handler';
import type {
  CliReadWorkspaceSkillsListEnvelopeBody,
  CliReadResponseDto,
} from '../shared/agent-bridge-contract/generated/api';
import type { PromptTypeRegistry } from '../agents/prompt-type-registry';
import type { RepoMappingStore } from '../repo/index';
import type { RunRegistry } from '../run/run-registry';
import type { RunStore } from '../run-store/run-store';
import type {
  LocalCreateRunRequest,
  LocalCreateRunResponse,
  MonitorRunEnsuredResponse,
  LocalRunPromptRequest,
  LocalSubmitPromptResponse,
  SendMessageOptions,
  CliReadProjectSessionCostsListEnvelopeBody,
  CliReadProjectSessionCostsResult,
  CliReadRunContextUsageResult,
} from '../shared/agent-bridge-contract/contract';
import type {
  CliReadProviderUsageResult,
  CliReadRuntimeModelCatalogResult,
} from '../shared/agent-bridge-contract/generated/api';
import { readRuntimeModelCatalogResult } from './model-catalog/runtime-model-catalog-result';
import type { CatalogAvailability } from './runtime-capability-catalog';
import type { ServerLogger } from './logger';
import {
  MonitorRunIdentityService,
  type EnsureRunForMonitorInput,
} from './services/monitor-run-identity.service';
import {
  MessageService,
  type MessagesGetMessageApiClient,
  type WorkflowsPromptTypeApiClient,
} from './services/message.service';
import { RunCreationCoordinator } from './services/run-creation-coordinator';
import { RunService } from './services/run.service';
import { ProjectSessionCostsService } from './services/project-session-costs.service';
import type { CcusageSessionJsonReader } from './services/session-cost-adapter';
import {
  SessionCostAdapter,
  unavailableProviderSessionCost,
} from './services/session-cost-adapter';
import type { SessionRunnerFacade } from './runtime/providers/select';
import type { Run } from '../run/run';
import type { AgentSkillCatalog } from '../agents/providers/agent-skills';
import { resolveAgentProviderId } from '../agents/providers/provider-config';
import { AgentSessionRunnerError } from '../agents/providers/session-runner';
import type {
  WorkflowDispatchIdentity,
  WorkflowDispatchVerdict,
} from './services/workflow-dispatch-verdict';
import type { AdmittedHostAction } from './controller-authorization/types';
import { ProjectModeBundleMaterializer } from '../agents/project-mode';
import type { RunTabs } from '../browser/run-tabs';
import type { StagedBrowserTabReference } from '../shared/agent-bridge-contract/generated/api';
import { ProviderUsageStore } from '../provider-usage/provider-usage-store';
import { providers } from '../provider-usage/provider-usage';
import { readClaudeUsage } from '../provider-usage/claude-usage';
import { requestClaudeUsageByControl } from '../agents/providers/claude/session-runner-claude';

export interface LocalAgentServiceDependencies {
  runStore: RunStore;
  repoStore: RepoMappingStore;
  runRegistry: RunRegistry;
  promptTypeRegistry: PromptTypeRegistry;
  logger: ServerLogger;
  workflowsApi: WorkflowsPromptTypeApiClient;
  messagesApi: MessagesGetMessageApiClient;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  readCcusageSessionJson?: CcusageSessionJsonReader;
  sessionRunnerFacade?: SessionRunnerFacade;
  projectModeBundleMaterializer?: ProjectModeBundleMaterializer;
  operationTimeline?: OperationTimelineRegistry;
  capabilityCatalog: CatalogAvailability;
  stagedBrowserTabs?: Pick<RunTabs, 'adoptStaged'>;
}

/** Owns the internal Run, message, and monitor services. */
export class LocalAgentService {
  private inputAdmissionLifecycle: InputAdmissionLifecycle | null = null;
  public bindInputAdmission(owner: InputAdmissionLifecycle): void {
    if (this.inputAdmissionLifecycle) throw new Error('Input admission is already bound.');
    this.inputAdmissionLifecycle = owner;
  }
  public get inputAdmission(): InputAdmissionLifecycle {
    if (!this.inputAdmissionLifecycle) throw new Error('Input admission is not ready.');
    return this.inputAdmissionLifecycle;
  }
  public materializeAdmittedRun(input: LocalCreateRunRequest): Promise<LocalCreateRunResponse> {
    return this.runCreationCoordinator.createRunFromTrigger({ ...input, triggersAgent: false });
  }
  public adoptStagedBrowserTab(
    runId: string,
    projectId: string,
    reference: StagedBrowserTabReference | null,
  ): Promise<void> {
    return this.runCreationCoordinator.adoptStagedBrowserTab(runId, projectId, reference);
  }

  private readonly workspaceSkills: WorkspaceSkillsReadHandler;
  private readonly runService: RunService;
  private readonly messageService: MessageService;
  private readonly runCreationCoordinator: RunCreationCoordinator;
  private readonly monitorRunIdentityService: MonitorRunIdentityService;
  private readonly projectSessionCostsService: ProjectSessionCostsService;
  private readonly providerUsageStore: ProviderUsageStore;
  private readonly sessionCostAdapter: SessionCostAdapter;
  private readonly sessionRunnerFacade: SessionRunnerFacade | undefined;
  private readonly logger: ServerLogger;
  private readonly capabilityCatalog: CatalogAvailability;

  public constructor(dependencies: LocalAgentServiceDependencies) {
    const logger = dependencies.logger;
    this.capabilityCatalog = dependencies.capabilityCatalog;
    this.workspaceSkills = new WorkspaceSkillsReadHandler(dependencies.repoStore, logger);
    this.logger = logger;
    this.sessionRunnerFacade = dependencies.sessionRunnerFacade;
    this.runService = new RunService({
      runStore: dependencies.runStore,
      repoStore: dependencies.repoStore,
      runRegistry: dependencies.runRegistry,
      promptTypeRegistry: dependencies.promptTypeRegistry,
      logger,
      ...(dependencies.readCcusageSessionJson
        ? { readCcusageSessionJson: dependencies.readCcusageSessionJson }
        : {}),
    });
    this.projectSessionCostsService = new ProjectSessionCostsService({
      runStore: dependencies.runStore,
      logger: logger.child({ component: 'project-session-costs' }),
      ...(dependencies.readCcusageSessionJson
        ? { readCcusageSessionJson: dependencies.readCcusageSessionJson }
        : {}),
    });
    this.providerUsageStore = new ProviderUsageStore(
      undefined,
      logger.child({ component: 'provider-usage' }),
    );
    this.sessionCostAdapter = new SessionCostAdapter(dependencies.readCcusageSessionJson);
    this.messageService = new MessageService({
      logger,
      runService: this.runService,
      runRegistry: dependencies.runRegistry,
      promptTypeRegistry: dependencies.promptTypeRegistry,
      workflowsApi: dependencies.workflowsApi,
      messagesApi: dependencies.messagesApi,
      ...(dependencies.operationTimeline
        ? { operationTimeline: dependencies.operationTimeline }
        : {}),
    });
    this.runCreationCoordinator = new RunCreationCoordinator({
      runService: this.runService,
      messageService: this.messageService,
      runRegistry: dependencies.runRegistry,
      promptTypeRegistry: dependencies.promptTypeRegistry,
      logger,
      projectModeBundleMaterializer:
        dependencies.projectModeBundleMaterializer ?? new ProjectModeBundleMaterializer(),
      ...(dependencies.stagedBrowserTabs
        ? { stagedBrowserTabs: dependencies.stagedBrowserTabs }
        : {}),
    });
    this.monitorRunIdentityService = new MonitorRunIdentityService({
      runStore: dependencies.runStore,
      runCreationCoordinator: this.runCreationCoordinator,
      logger,
      apiBaseUrl: dependencies.apiBaseUrl,
      ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
    });
  }

  public createRun(input: LocalCreateRunRequest): Promise<LocalCreateRunResponse> {
    return this.runCreationCoordinator.createRun(input);
  }

  public createRunFromTrigger(
    capability: AdmittedHostAction,
    input: LocalCreateRunRequest,
  ): Promise<LocalCreateRunResponse> {
    this.assertCapability(capability, 'CONVERSATION_TRIGGER');
    return this.runCreationCoordinator.createRunFromTrigger(input);
  }

  public stopRun(runId: string): Promise<void> {
    return this.runService.stopRun(runId);
  }

  public compactRun(capability: AdmittedHostAction, runId: string): Promise<void> {
    this.assertCapability(capability, 'CONVERSATION_CONTROL_COMPACT_RUN');
    return this.runService.compactRun(runId);
  }

  public sendMessage(
    capability: AdmittedHostAction,
    runId: string,
    input: LocalRunPromptRequest,
    options?: SendMessageOptions,
  ): Promise<LocalSubmitPromptResponse> {
    this.assertCapability(capability, 'CONVERSATION_TRIGGER');
    return this.messageService.sendMessage(runId, input, options);
  }

  /** Local lifecycle continuations that do not originate from a browser request. */
  public sendSystemMessage(
    runId: string,
    input: LocalRunPromptRequest,
    options?: SendMessageOptions,
  ): Promise<LocalSubmitPromptResponse> {
    return this.messageService.sendMessage(runId, input, options);
  }

  private assertCapability(
    capability: AdmittedHostAction,
    expectedAction: AdmittedHostAction['actionType'],
  ): void {
    if (capability.actionType !== expectedAction) {
      throw new Error(`Host action capability does not admit ${expectedAction}.`);
    }
  }

  public readWorkflowVerdict(identity: WorkflowDispatchIdentity): Promise<WorkflowDispatchVerdict> {
    return this.messageService.readWorkflowVerdict(identity);
  }

  public readAssistantMessage(input: {
    organizationId: string;
    projectId: string;
    conversationId: string;
    messageId: string;
  }): Promise<{ messageId: string; content: string } | null> {
    return this.messageService.readAssistantMessage(input);
  }

  public readUserMessage(input: {
    organizationId: string;
    projectId: string;
    conversationId: string;
    messageId: string;
  }): Promise<{ messageId: string; content: string } | null> {
    return this.messageService.readUserMessage(input);
  }

  public listProjectSessionCosts(
    input: CliReadProjectSessionCostsListEnvelopeBody,
    organizationId: string,
  ): Promise<CliReadProjectSessionCostsResult> {
    return this.projectSessionCostsService.list(input, organizationId);
  }

  /** Retries every provider that is not ready, so a fixed provider shows up without a restart. */
  public async readRuntimeModelCatalog(): Promise<CliReadRuntimeModelCatalogResult> {
    await this.capabilityCatalog.refresh();
    return readRuntimeModelCatalogResult(this.logger);
  }

  public async readProviderUsage(): Promise<CliReadProviderUsageResult> {
    this.logger.debug('local.service.provider_usage.read_started', {
      providerCount: providers.length,
    });
    const facade = this.sessionRunnerFacade;
    const claudeLogger = this.logger.child({ component: 'provider-usage' });
    const [claude, stored] = await Promise.all([
      readClaudeUsage(
        (signal) =>
          facade
            ? facade.readClaudeUsage(signal)
            : requestClaudeUsageByControl(signal, claudeLogger),
        claudeLogger,
      ),
      this.providerUsageStore.readAll(),
    ]);
    const readings = [claude, ...stored];
    const result = {
      providers: readings.map((reading) =>
        reading.status === 'storage_failure'
          ? {
              provider: reading.provider,
              status: 'error' as const,
              observedAt: null,
              fiveHour: null,
              weekly: null,
            }
          : { ...reading.usage, status: reading.status },
      ),
    } satisfies CliReadProviderUsageResult;
    this.logger.debug('local.service.provider_usage.read_completed', {
      providerCount: result.providers.length,
      reportedCount: result.providers.filter((reading) => reading.status === 'reported').length,
      unreportedCount: result.providers.filter((reading) => reading.status === 'unreported').length,
      errorCount: result.providers.filter((reading) => reading.status === 'error').length,
    });
    return result;
  }

  public async readRunContextUsage(
    run: Run,
    providerSessionId?: string,
  ): Promise<CliReadRunContextUsageResult> {
    const history = run.session.provider_session_history ?? [];
    const resolvedProviderSessionId = providerSessionId ?? run.contextProviderSessionId();
    if (!resolvedProviderSessionId) {
      this.logger.debug('local.service.context_usage.provider_session_missing');
      throw new Error('The persisted Run has no provider session for context usage.');
    }
    if (
      providerSessionId &&
      providerSessionId !== run.session.provider_session_id &&
      !history.some((entry) => entry.providerSessionId === providerSessionId)
    ) {
      this.logger.debug('local.service.context_usage.provider_session_rejected');
      throw new Error('The selected provider session does not belong to the persisted Run.');
    }

    this.logger.debug('local.service.context_usage.read_started');
    const [contextData, cost] = await Promise.all([
      this.readSelectedContext(run, resolvedProviderSessionId),
      this.readSelectedCost(run, resolvedProviderSessionId),
    ]);
    return { runId: run.runId, providerSessionId: resolvedProviderSessionId, contextData, cost };
  }

  private async readSelectedContext(
    run: Run,
    providerSessionId: string,
  ): Promise<CliReadRunContextUsageResult['contextData']> {
    const startedAt = Date.now();
    this.logger.debug('local.service.context_usage.context_started');
    try {
      try {
        return run.runner
          ? await run.runner.getContextUsage(providerSessionId)
          : await this.readContextByResume(run, providerSessionId);
      } catch (error) {
        if (!(error instanceof AgentSessionRunnerError) || error.code !== 'NO_ACTIVE_SESSION')
          throw error;
        this.logger.debug('local.service.context_usage.context_resume_fallback');
        return await this.readContextByResume(run, providerSessionId);
      }
    } catch (error) {
      this.logger.debug('local.service.context_usage.context_failed');
      throw error;
    } finally {
      this.logger.debug('local.service.context_usage.context_finished', {
        durationMs: Date.now() - startedAt,
      });
    }
  }

  private readContextByResume(run: Run, providerSessionId: string) {
    this.logger.debug('local.service.context_usage.context_resume_started');
    return this.requireSessionRunnerFacade().readContextUsageByResume(
      run.session,
      providerSessionId,
    );
  }

  private async readSelectedCost(
    run: Run,
    providerSessionId: string,
  ): Promise<CliReadRunContextUsageResult['cost']> {
    const startedAt = Date.now();
    this.logger.debug('local.service.context_usage.cost_started');
    try {
      const cost = await this.sessionCostAdapter.read({
        providerId: resolveAgentProviderId(run.session.provider),
        providerSessionId,
        logger: this.logger,
      });
      this.logger.debug('local.service.context_usage.cost_completed', { state: cost.state });
      return cost;
    } catch {
      this.logger.debug('local.service.context_usage.cost_failed');
      return unavailableProviderSessionCost(
        'adapter_error',
        'The session cost adapter failed while reading the selected provider session.',
      );
    } finally {
      this.logger.debug('local.service.context_usage.cost_finished', {
        durationMs: Date.now() - startedAt,
      });
    }
  }

  public listWorkspaceSkills(
    body: CliReadWorkspaceSkillsListEnvelopeBody,
    userId: string,
  ): Promise<CliReadResponseDto> {
    return this.workspaceSkills.read(body, userId);
  }

  public listRunSkills(run: Run): Promise<AgentSkillCatalog> {
    return this.requireSessionRunnerFacade().listSkills(run);
  }

  private requireSessionRunnerFacade(): SessionRunnerFacade {
    if (!this.sessionRunnerFacade) {
      throw new Error('Resume-based context usage is unavailable.');
    }
    return this.sessionRunnerFacade;
  }

  public ensureRunForMonitor(input: EnsureRunForMonitorInput): Promise<MonitorRunEnsuredResponse> {
    return this.monitorRunIdentityService.ensureRunForMonitor(input);
  }
}
