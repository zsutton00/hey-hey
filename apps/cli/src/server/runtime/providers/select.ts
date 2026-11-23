import { AntigravityAgentSessionRunner } from '../../../agents/providers/antigravity/session-runner-antigravity';
/**
 * Run-scoped provider selection and runner ownership.
 *
 * The facade owns the provider-runner cache. Callers provide the Run object,
 * so provider runners retain their real output owner and no registry lookup or
 * late-bound construction seam is required.
 */

import path from 'node:path';

import {
  ClaudeAgentSessionRunner,
  requestClaudeUsageByControl,
} from '../../../agents/providers/claude/session-runner-claude';
import { ExecutionRecorder } from '../../../agents/providers/execution-recorder/execution-recorder';
import { CodexAgentSessionRunner } from '../../../agents/providers/codex/session-runner-codex';
import { OpenCodeAgentSessionRunner } from '../../../agents/providers/opencode/session-runner-opencode';
import { NativePermissionModeProbe } from '../../../agents/providers/native-permission-mode';
import {
  resolveAgentProviderId,
  type AgentProviderId,
  type ProviderPermissionMode,
} from '../../../agents/providers/provider-config';
import {
  AgentSessionRunnerError,
  type AgentSessionRunner,
  type ResumeArgs,
  type RunPromptArgs,
} from '../../../agents/providers/session-runner';
import type { SubmissionToolRegistry } from '../../../agents/submission-tools/registry';
import type { OAuthClient } from '../../../auth/index';
import type { RepoMappingStore } from '../../../repo/index';
import { MachineOptionsStore } from '../../../options/machine-options-store';
import type { Run } from '../../../run/run';
import type { RunStore } from '../../../run-store/run-store';
import type { ToolRuleStore } from '../../../session/tool-rules';
import type { AgenticSession } from '../../../session/types';
import type { LocalContextData } from '../../../shared/agent-bridge-contract/contract';
import type { AgentSkillCatalog } from '../../../agents/providers/agent-skills';
import type { UsageData } from '../../../agent-runtime/index';
import { listModels } from '../../../shared/runtime/components/AgentSession/capabilityCatalog';
import { resolveBaseDir } from '../../../session/paths';
import type { LocalAgentEndpoint } from '../../local-base-url';
import type { ServerLogger } from '../../logger';
import type { AgentSessionReader } from '../../monitors/agent-session-reader';
import type { CatalogAvailability } from '../../runtime-capability-catalog';

export interface SessionRunnerFacadeDependencies {
  runStore: RunStore;
  repoStore: RepoMappingStore;
  oauthClient: OAuthClient;
  localAgentEndpoint: LocalAgentEndpoint;
  submissionToolRegistry: SubmissionToolRegistry;
  logger: ServerLogger;
  /**
   * Live AgentSession reader used to derive `skipPermissions` from the
   * session's `autoDecide` flag when the caller did not pin the value.
   */
  agentSessionReader: AgentSessionReader;
  toolRuleStore: ToolRuleStore;
  /** Launches that name no model wait for the providers' first report. */
  capabilityCatalog: Pick<CatalogAvailability, 'settled'>;
  /** Read once per Run, when its first prompt starts, to decide whether capture hooks are sent. */
  machineOptionsStore?: Pick<MachineOptionsStore, 'isPreciseFileChangeTrackingEnabled'>;
  /** Checks the installed provider before its native permission mode is used. */
  nativePermissionModeProbe?: Pick<NativePermissionModeProbe, 'resolve'>;
  /** Where hook-captured file versions are kept; defaults to the CLI's data directory. */
  executionEvidenceDirectory?: string;
}

/**
 * A launch uses exactly the model it names; the provider judges a model this
 * machine's catalog does not list. A launch that names none uses the first model
 * the provider reported (OpenCode launches its own default), never a model id
 * written into this code.
 */
const firstReportedModel = (providerId: AgentProviderId): string | undefined =>
  providerId === 'opencode' ? undefined : listModels(providerId)[0]?.id;

export class SessionRunnerFacade {
  private readonly runners = new Map<
    string,
    { providerId: AgentProviderId; runner: AgentSessionRunner }
  >();

  /** Runs whose provider hooks are sent, decided once when the Run's first prompt starts. */
  private readonly preciseTrackingRuns = new Set<string>();
  private readonly decidedRuns = new Set<string>();
  private executionRecorder: ExecutionRecorder | null = null;
  private readonly nativeModeProbe: Pick<NativePermissionModeProbe, 'resolve'>;
  private readonly machineOptionsStore: Pick<
    MachineOptionsStore,
    'isPreciseFileChangeTrackingEnabled'
  >;

  public constructor(private readonly dependencies: SessionRunnerFacadeDependencies) {
    this.machineOptionsStore = dependencies.machineOptionsStore ?? new MachineOptionsStore();
    this.nativeModeProbe =
      dependencies.nativePermissionModeProbe ?? new NativePermissionModeProbe();
  }

  /**
   * Reads the precise file change tracking option the first time a Run prompts, so a change
   * applies to sessions started afterward and never mid-Run. A read failure leaves the Run
   * approximate and says why; coding continues.
   */
  private async decidePreciseTracking(run: Run): Promise<void> {
    if (this.decidedRuns.has(run.runId)) {
      return;
    }
    const providerId = resolveAgentProviderId(run.provider);
    this.decidedRuns.add(run.runId);
    let enabled = false;
    try {
      enabled = await this.machineOptionsStore.isPreciseFileChangeTrackingEnabled();
    } catch (error) {
      this.dependencies.logger.warn('select.precise_tracking.option_unreadable', {
        runId: run.runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (!enabled) {
      return;
    }
    if (providerId === 'opencode') {
      this.dependencies.logger.info('select.precise_tracking.provider_without_hooks', {
        runId: run.runId,
        provider: providerId,
        reason: 'This provider does not support precise execution capture',
      });
      return;
    }
    this.preciseTrackingRuns.add(run.runId);
    // The runner picker calls forRun before the first prompt, so a runner cached without the
    // recorder must be rebuilt now that this Run is known to want one.
    this.runners.delete(run.runId);
  }

  private recorderFor(run: Run): ExecutionRecorder | undefined {
    if (!this.preciseTrackingRuns.has(run.runId)) {
      return undefined;
    }
    this.executionRecorder ??= new ExecutionRecorder(
      this.dependencies.executionEvidenceDirectory ??
        path.join(resolveBaseDir(), 'execution-evidence'),
      this.dependencies.logger.child({ component: 'execution-capture' }),
    );
    return this.executionRecorder;
  }

  public forRun(run: Run): AgentSessionRunner {
    const existing = this.runners.get(run.runId);
    const providerId = resolveAgentProviderId(run.provider);
    if (existing?.providerId === providerId) return existing.runner;

    // Provider hooks are sent only for a Run started with precise file change tracking on.
    const executionRecorder = this.recorderFor(run);
    const common = {
      runStore: this.dependencies.runStore,
      repoStore: this.dependencies.repoStore,
      oauthClient: this.dependencies.oauthClient,
      localAgentEndpoint: this.dependencies.localAgentEndpoint,
      submissionToolRegistry: this.dependencies.submissionToolRegistry,
      agentOutputOwner: run,
    };

    let runner: AgentSessionRunner;
    if (providerId === 'antigravity') {
      runner = new AntigravityAgentSessionRunner({
        ...common,
        ...(executionRecorder ? { executionRecorder } : {}),
        logger: this.dependencies.logger.child({ component: 'runner.antigravity' }),
      });
    } else if (providerId === 'codex') {
      runner = new CodexAgentSessionRunner({
        ...common,
        ...(executionRecorder ? { executionRecorder } : {}),
        logger: this.dependencies.logger.child({ component: 'runner.codex-mcp' }),
      });
    } else if (providerId === 'claude') {
      runner = new ClaudeAgentSessionRunner({
        ...common,
        ...(executionRecorder ? { executionRecorder } : {}),
        toolRuleStore: this.dependencies.toolRuleStore,
        logger: this.dependencies.logger.child({ component: 'runner.claude' }),
      });
    } else {
      runner = new OpenCodeAgentSessionRunner({
        ...common,
        toolRuleStore: this.dependencies.toolRuleStore,
        logger: this.dependencies.logger.child({ component: 'runner.opencode' }),
      });
    }

    run.setRunner(runner);
    this.runners.set(run.runId, { providerId, runner });
    this.dependencies.logger.info('select.runner.created', {
      runId: run.runId,
      provider: run.provider,
      providerId,
      executionCaptureEnabled: executionRecorder !== undefined,
      cachedRunnerCount: this.runners.size,
    });
    return runner;
  }

  public forgetRun(runId: string): void {
    this.executionRecorder?.releaseRun(runId);
    this.preciseTrackingRuns.delete(runId);
    this.decidedRuns.delete(runId);
    const forgotten = this.runners.delete(runId);
    this.dependencies.logger.debug('select.runner_cache.forgotten', {
      runId,
      forgotten,
      cachedRunnerCount: this.runners.size,
    });
  }

  // Plan usage is account-wide, so any live Claude session can answer it;
  // without one, a short-lived control-only process does.
  public readClaudeUsage(signal: AbortSignal): Promise<UsageData> {
    for (const { runner } of this.runners.values()) {
      if (runner instanceof ClaudeAgentSessionRunner && runner.hasLiveSession()) {
        return runner.getProviderUsage(signal);
      }
    }
    return requestClaudeUsageByControl(signal, this.dependencies.logger);
  }

  public async listSkills(run: Run): Promise<AgentSkillCatalog> {
    const runner = this.forRun(run);
    if (!runner.listSkills) {
      throw new AgentSessionRunnerError(
        'NOT_SUPPORTED',
        `Provider ${resolveAgentProviderId(run.provider)} does not expose a Skill catalog.`,
      );
    }
    return runner.listSkills({ session: run.session });
  }

  public async readContextUsageByResume(
    session: AgenticSession,
    providerSessionId?: string,
  ): Promise<LocalContextData> {
    const providerId = resolveAgentProviderId(session.provider);
    let runner: AgentSessionRunner;
    if (providerId === 'claude') {
      runner = new ClaudeAgentSessionRunner({
        runStore: this.dependencies.runStore,
        repoStore: this.dependencies.repoStore,
        oauthClient: this.dependencies.oauthClient,
        localAgentEndpoint: this.dependencies.localAgentEndpoint,
        submissionToolRegistry: this.dependencies.submissionToolRegistry,
        toolRuleStore: this.dependencies.toolRuleStore,
        logger: this.dependencies.logger.child({ component: 'context-usage-resume-claude' }),
      });
    } else if (providerId === 'codex') {
      runner = new CodexAgentSessionRunner({
        runStore: this.dependencies.runStore,
        repoStore: this.dependencies.repoStore,
        oauthClient: this.dependencies.oauthClient,
        localAgentEndpoint: this.dependencies.localAgentEndpoint,
        submissionToolRegistry: this.dependencies.submissionToolRegistry,
        logger: this.dependencies.logger.child({ component: 'context-usage-resume-codex' }),
      });
    } else if (providerId === 'opencode') {
      runner = new OpenCodeAgentSessionRunner({
        runStore: this.dependencies.runStore,
        repoStore: this.dependencies.repoStore,
        oauthClient: this.dependencies.oauthClient,
        localAgentEndpoint: this.dependencies.localAgentEndpoint,
        submissionToolRegistry: this.dependencies.submissionToolRegistry,
        toolRuleStore: this.dependencies.toolRuleStore,
        logger: this.dependencies.logger.child({ component: 'context-usage-resume-opencode' }),
      });
    } else {
      throw new AgentSessionRunnerError(
        'NOT_SUPPORTED',
        `Resume-based context usage is unavailable for provider ${providerId}.`,
      );
    }
    if (!runner.getContextUsageByResume) {
      throw new AgentSessionRunnerError(
        'NOT_SUPPORTED',
        `Provider ${providerId} does not implement resume-based context usage.`,
      );
    }
    return runner.getContextUsageByResume({
      session,
      ...(providerSessionId ? { providerSessionId } : {}),
    });
  }

  public async runPrompt(
    run: Run,
    args: RunPromptArgs,
  ): Promise<Awaited<ReturnType<AgentSessionRunner['runPrompt']>>> {
    await this.decidePreciseTracking(run);
    const runner = this.forRun(run);
    const named = args.model ?? args.session.model;
    let launch = args;
    if (!named) {
      await this.dependencies.capabilityCatalog.settled();
      const model = firstReportedModel(resolveAgentProviderId(run.provider));
      if (model) launch = { ...args, model };
    }
    if (launch.skipPermissions !== undefined) {
      return runner.runPrompt(launch);
    }
    const autoDecide = await this.readAutoDecide(launch);
    const approval = await this.approvalFor(run, autoDecide);
    return runner.runPrompt({ ...launch, ...approval });
  }

  public async resumeSession(
    run: Run,
    args: ResumeArgs,
  ): Promise<Awaited<ReturnType<AgentSessionRunner['resumeSession']>>> {
    await this.decidePreciseTracking(run);
    const runner = this.forRun(run);
    if (args.skipPermissions !== undefined) {
      return runner.resumeSession(args);
    }
    const autoDecide = await this.readAutoDecide(args);
    const approval = await this.approvalFor(run, autoDecide);
    return runner.resumeSession({ ...args, ...approval });
  }

  /**
   * A Task Monitor run never gets blanket approval. It runs in the provider's
   * native automation mode only when the monitor's authorization was read as
   * on and the installed provider supports that mode; in every other case it
   * keeps explicit permission handling. Either way, each request the provider
   * still raises is admitted to the Task Monitor, which decides it; only a
   * request the monitor escalates reaches a person, so a run that is not in
   * native auto mode does not surface ordinary requests to the user. The
   * provider mode is its own field; `autoDecide` stays the monitor-owned
   * authorization. Runs outside Task Monitor derive `skipPermissions` from
   * `autoDecide` as before.
   */
  private async approvalFor(
    run: Run,
    autoDecide: boolean | undefined,
  ): Promise<{ skipPermissions?: boolean; providerPermissionMode?: ProviderPermissionMode }> {
    if (run.taskMonitorId === null) {
      return autoDecide === undefined ? {} : { skipPermissions: autoDecide };
    }

    const providerId = resolveAgentProviderId(run.provider);
    const logContext = { runId: run.runId, taskMonitorId: run.taskMonitorId, providerId };
    if (autoDecide !== true) {
      this.dependencies.logger.warn('select.provider_permission_mode.explicit', {
        ...logContext,
        reason:
          autoDecide === false ? 'monitor_automation_not_authorized' : 'authorization_unreadable',
      });

      return { skipPermissions: false };
    }

    const native = await this.nativeModeProbe.resolve(providerId);
    if (native.mode === null) {
      this.dependencies.logger.warn('select.provider_permission_mode.explicit', {
        ...logContext,
        ...native,
      });

      return { skipPermissions: false };
    }

    this.dependencies.logger.info('select.provider_permission_mode.native', {
      ...logContext,
      providerPermissionMode: native.mode,
      installedVersion: native.installedVersion,
    });

    return { skipPermissions: false, providerPermissionMode: native.mode };
  }

  private async readAutoDecide(args: RunPromptArgs | ResumeArgs): Promise<boolean | undefined> {
    try {
      const session = await this.dependencies.agentSessionReader.readAgentSession(
        args.session.agentic_session_id,
      );
      return session?.autoDecide ?? false;
    } catch (error) {
      this.dependencies.logger.warn('select.skip_permissions.live_read_failed', {
        agenticSessionId: args.session.agentic_session_id,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}
