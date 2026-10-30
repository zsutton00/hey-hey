import type { RunStore } from '../run-store/run-store';
import path from 'node:path';
import { resolveBaseDir } from '../session/paths';
import type { OAuthClient } from '../auth';
import type { ServerLogger } from '../server/logger';
import type { TaskMonitorManagedTurnRuntime } from '../server/task-monitor-managed-turn-runtime';
import { PromptTypeRegistry } from './prompt-type-registry';
import { CreateReportProxy } from './submission-tools/create-report-proxy';
import { CreateReportTool } from './submission-tools/create-report-tool';
import { suggestFeatureVerificationTool } from './submission-tools/suggest-feature-verification-tool';
import { RunSubagentsTool } from './submission-tools/run-subagents-tool';
import {
  CONTEXT_SEARCH_HOP_LIMITS,
  CONTEXT_SEARCH_MAX_RESULTS,
  type ContextGatheringDeps,
} from './project-assistant/context-gathering';
import type { SubmissionToolDeclaration } from './submission-tools/types';
import { ReportEmissionEvents } from './submission-tools/report-emission-events';
import { SubmissionToolRegistry } from './submission-tools/registry';
import { SubmissionToolAuth } from './submission-tools/submission-tool-auth';
import { TaskMonitorDecisionStore } from './task-monitor/task-monitor-decision-store';
import { SessionMonitorEvaluationStore } from './session-monitor';
import { EntityContextLoader } from './entity-context/entity-context-loader';
import { AgentStartupPromptInput } from '../commands/agent-startup-prompt-input';
import { PlanSubmissionAdmissionClient } from './plan-shaping/plan-submission-admission.client';
import { createJevClient, DEFAULT_JEV_MODEL, type JevClient } from '../jev/client';
import { DEFAULT_WORDING } from '../jev/scenarios';
import { createLiveSearchExecutor } from '../jev/search';
import { createLiveReader } from '../jev/traversal';

export interface AgentApplicationRuntimeDependencies {
  runStore?: RunStore;
  oauthClient: OAuthClient;
  apiBaseUrl: string;
  logger: ServerLogger;
  taskMonitorManagedTurnRuntime: TaskMonitorManagedTurnRuntime;
  /** The Jev switch, read on every Project Assistant prepare; backed by the machine options file. */
  isJevEnabled: () => Promise<boolean>;
  fetchImpl?: typeof fetch;
}

/** `HEYHEY_RUN_SUBAGENTS`: `on` enables Project Assistant research subagents; unset or `off` disables them. */
const readRunSubagentsSwitch = (): boolean => {
  const value = process.env['HEYHEY_RUN_SUBAGENTS'];
  if (value === 'on') return true;
  if (value === undefined || value === 'off') return false;
  throw new Error(`HEYHEY_RUN_SUBAGENTS must be 'on' or 'off', got '${value}'.`);
};

/** What Project Assistant gathers into its prompt over the live project graph; built only with a Jev key. */
const createContextGathering = (
  client: JevClient,
  auth: SubmissionToolAuth,
  apiBaseUrl: string,
): ContextGatheringDeps => ({
  jev: { client, model: DEFAULT_JEV_MODEL, wording: DEFAULT_WORDING },
  limits: CONTEXT_SEARCH_HOP_LIMITS,
  maxResultsPerSearch: CONTEXT_SEARCH_MAX_RESULTS,
  executorFor: (project) => createLiveSearchExecutor({ auth, apiBaseUrl, ...project }),
  readerFor: (project, focal, known) =>
    createLiveReader(focal, { auth, apiBaseUrl, ...project }, known),
  traceLogDir: path.join(resolveBaseDir(), 'jev-logs', 'gather'),
});

/** Owns prompt handlers, submission tools, and their shared agent-side state. */
export class AgentApplicationRuntime {
  public readonly jevClient: JevClient | undefined;
  public readonly auth: SubmissionToolAuth;
  public readonly reportEmissionEvents = new ReportEmissionEvents();
  public readonly submissionToolRegistry = new SubmissionToolRegistry();
  /**
   * Bound to the subagent fan-out by the Run runtime, which owns the child launcher.
   * `null` unless `HEYHEY_RUN_SUBAGENTS=on`, read once at startup.
   */
  public readonly runSubagentsTool: RunSubagentsTool | null;
  public readonly taskMonitorDecisionStore: TaskMonitorDecisionStore;
  public readonly sessionMonitorEvaluationStore: SessionMonitorEvaluationStore;
  public readonly promptTypeRegistry: PromptTypeRegistry;
  public readonly entityContextLoader: EntityContextLoader;
  public readonly startupPromptInput: AgentStartupPromptInput;
  public readonly baseSubmissionTools: readonly SubmissionToolDeclaration[];

  public readonly createReportProxy: CreateReportProxy;

  public constructor(dependencies: AgentApplicationRuntimeDependencies) {
    this.jevClient = createJevClient(process.env, dependencies.logger.child({ component: 'jev' }));
    const fetchImpl = dependencies.fetchImpl ?? fetch;
    this.runSubagentsTool = readRunSubagentsSwitch() ? new RunSubagentsTool() : null;
    this.auth = new SubmissionToolAuth(dependencies.oauthClient);
    this.taskMonitorDecisionStore = new TaskMonitorDecisionStore(
      dependencies.logger.child({ component: 'task-monitor.decision-store' }),
      dependencies.taskMonitorManagedTurnRuntime,
    );
    this.sessionMonitorEvaluationStore = new SessionMonitorEvaluationStore(
      dependencies.logger.child({ component: 'session-monitor.evaluation-store' }),
    );
    this.createReportProxy = new CreateReportProxy({
      ...(dependencies.runStore ? { runStore: dependencies.runStore } : {}),
      auth: this.auth,
      apiBaseUrl: dependencies.apiBaseUrl,
      fetchImpl,
      reportEmissionEvents: this.reportEmissionEvents,
      logger: dependencies.logger.child({ component: 'create-report-proxy' }),
    });
    this.entityContextLoader = new EntityContextLoader({
      auth: this.auth,
      apiBaseUrl: dependencies.apiBaseUrl,
      logger: dependencies.logger.child({ component: 'entity-context' }),
    });
    this.startupPromptInput = new AgentStartupPromptInput({
      auth: this.auth,
      apiBaseUrl: dependencies.apiBaseUrl,
      logger: dependencies.logger.child({ component: 'startup-prompt-input' }),
      entityContextLoader: this.entityContextLoader,
    });
    this.promptTypeRegistry = new PromptTypeRegistry({
      createReportProxy: this.createReportProxy,
      runSubagentsTool: this.runSubagentsTool,
      ...(this.jevClient
        ? {
            contextGathering: createContextGathering(
              this.jevClient,
              this.auth,
              dependencies.apiBaseUrl,
            ),
            parentRequirements: {
              jevClient: this.jevClient,
              entityContextLoader: this.entityContextLoader,
              attemptLogDir: path.join(resolveBaseDir(), 'jev-logs', 'parent-requirements'),
            },
            isJevEnabled: dependencies.isJevEnabled,
          }
        : {}),
      planSubmissionAdmissionClient: new PlanSubmissionAdmissionClient({
        logger: dependencies.logger,
        auth: this.auth,
        apiBaseUrl: dependencies.apiBaseUrl,
      }),
      entityConversation: {
        auth: this.auth,
        apiBaseUrl: dependencies.apiBaseUrl,
        fetchImpl,
        logger: dependencies.logger.child({ component: 'entity-conversation' }),
      },
    });
    this.baseSubmissionTools = [
      new CreateReportTool(this.createReportProxy, undefined, dependencies.logger),
      suggestFeatureVerificationTool,
    ];
  }
}
