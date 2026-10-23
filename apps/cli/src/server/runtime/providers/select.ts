/**
 * Run-scoped provider selection and runner ownership.
 *
 * The facade owns the provider-runner cache. Callers provide the Run object,
 * so provider runners retain their real output owner and no registry lookup or
 * late-bound construction seam is required.
 */

import {
  ClaudeAgentSessionRunner,
  requestClaudeUsageByControl,
} from '../../../agents/providers/claude/session-runner-claude';
import { CodexAgentSessionRunner } from '../../../agents/providers/codex/session-runner-codex';
import { OpenCodeAgentSessionRunner } from '../../../agents/providers/opencode/session-runner-opencode';
import {
  resolveAgentProviderId,
  type AgentProviderId,
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
import type { Run } from '../../../run/run';
import type { RunStore } from '../../../run-store/run-store';
import type { ToolRuleStore } from '../../../session/tool-rules';
import type { AgenticSession } from '../../../session/types';
import type { LocalContextData } from '../../../shared/agent-bridge-contract/contract';
import type { AgentSkillCatalog } from '../../../agents/providers/agent-skills';
import type { UsageData } from '@hey-hey/ui-common/agents';
import { listModels } from '@hey-hey/ui-common/capability-catalog';
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
}

/** Strict mapping for accepted feature-level provider names. */
export const resolveSelectedProviderId = (provider: string): AgentProviderId => {
  const normalized = provider.trim().toLowerCase();
  if (normalized === 'claude') return 'claude';
  if (normalized === 'codex' || normalized === 'openai') return 'codex';
  if (normalized === 'opencode') return 'opencode';
  throw new AgentSessionRunnerError(
    'NOT_SUPPORTED',
    `Provider ${provider} is not supported for repository analysis.`,
  );
};

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

  public constructor(private readonly dependencies: SessionRunnerFacadeDependencies) {}

  public forRun(run: Run, selectedProvider?: string): AgentSessionRunner {
    const existing = this.runners.get(run.runId);
    const providerId = selectedProvider
      ? resolveSelectedProviderId(selectedProvider)
      : resolveAgentProviderId(run.provider);
    if (existing?.providerId === providerId) return existing.runner;

    // Execution-evidence snapshots are disabled: provider hooks must not scan
    // repository trees before tools or delay turn settlement for those scans.
    const common = {
      runStore: this.dependencies.runStore,
      repoStore: this.dependencies.repoStore,
      oauthClient: this.dependencies.oauthClient,
      localAgentEndpoint: this.dependencies.localAgentEndpoint,
      submissionToolRegistry: this.dependencies.submissionToolRegistry,
      agentOutputOwner: run,
    };

    let runner: AgentSessionRunner;
    if (providerId === 'codex') {
      runner = new CodexAgentSessionRunner({
        ...common,
        logger: this.dependencies.logger.child({ component: 'runner.codex-mcp' }),
      });
    } else if (providerId === 'claude') {
      runner = new ClaudeAgentSessionRunner({
        ...common,
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
      executionCaptureEnabled: false,
      cachedRunnerCount: this.runners.size,
    });
    return runner;
  }

  public forgetRun(runId: string): void {
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
    selectedProvider?: string,
  ): Promise<Awaited<ReturnType<AgentSessionRunner['runPrompt']>>> {
    const runner = this.forRun(run, selectedProvider);
    const named = args.model ?? args.session.model;
    let launch = args;
    if (!named) {
      await this.dependencies.capabilityCatalog.settled();
      const model = firstReportedModel(
        selectedProvider
          ? resolveSelectedProviderId(selectedProvider)
          : resolveAgentProviderId(run.provider),
      );
      if (model) launch = { ...args, model };
    }
    if (launch.skipPermissions !== undefined) {
      run.setTaskMonitorAutomationAuthorization(false);
      return runner.runPrompt(launch);
    }
    const derived = await this.readAutoDecide(launch);
    run.setTaskMonitorAutomationAuthorization(derived === true);
    return derived === undefined
      ? runner.runPrompt(launch)
      : runner.runPrompt({ ...launch, skipPermissions: derived });
  }

  public async resumeSession(
    run: Run,
    args: ResumeArgs,
    selectedProvider?: string,
  ): Promise<Awaited<ReturnType<AgentSessionRunner['resumeSession']>>> {
    const runner = this.forRun(run, selectedProvider);
    if (args.skipPermissions !== undefined) {
      run.setTaskMonitorAutomationAuthorization(false);
      return runner.resumeSession(args);
    }
    const derived = await this.readAutoDecide(args);
    run.setTaskMonitorAutomationAuthorization(derived === true);
    return derived === undefined
      ? runner.resumeSession(args)
      : runner.resumeSession({ ...args, skipPermissions: derived });
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
