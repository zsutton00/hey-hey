import { LocalPromptType } from '../shared/agent-bridge-contract/generated';
import { agentSearchHandler } from './agent-search/agent-search.handler';
import { childTaskUpdatesHandler } from './child-task-updates/child-task-updates.handler';
import { codingFreeformHandler, freeFormHandler } from './coding-conversation';
import { codingPlanHandler } from './coding-plan/coding-plan.handler';
import { CommitHandler } from './commit/commit.handler';
import { dailySessionCoachHandler } from './daily-session/daily-session-coach.handler';
import { debugHandler } from './debug';
import { quickHandler } from './quick/quick.handler';
import { designDocRefinerHandler } from './design-doc-refiner/design-doc-refiner.handler';
import {
  EntityConversationHandler,
  type EntityConversationHandlerDependencies,
} from './entity-conversation/entity-conversation.handler';
import { featureRefinerHandler } from './feature-refiner/feature-refiner.handler';
import { featureSyncAnalyzeHandler } from './feature-sync/analyze.handler';
import { featureSyncIterateHandler } from './feature-sync/iterate.handler';
import { featureTreeConversationHandler } from './feature-tree-conversation';
import { finalAssessmentHandler } from './final-assessment/final-assessment.handler';
import { GoalPmHandler } from './goal-pm';
import { OpenItemsTriageHandler } from './open-items-triage/open-items-triage.handler';
import { htmlCssMockupRevisionHandler } from './html-css-mockup-revision/html-css-mockup-revision.handler';
import { implementHandler } from './implement/implement.handler';
import { planExecutionHandler } from './plan-execution/plan-execution.handler';
import {
  PlanShapingPhaseBreakdownHandler,
  planShapingFinalizeHandler,
  planShapingVisualPreviewHandler,
  planShapingProposedStagesHandler,
  planShapingRefineStageHandler,
  createPlanShapingStepReviewHandler,
} from './plan-shaping';
import {
  planShapingFeatureSyncAnalyzeHandler,
  planShapingFeatureSyncIterateHandler,
} from './plan-shaping-feature-sync';
import { planShapingFeatureSyncDiscussHandler } from './plan-shaping-feature-sync/discuss.handler';
import type { ContextGatheringDeps } from './project-assistant/context-gathering';
import type { ParentRequirementsFilter } from './project-assistant/parent-requirements';
import { ProjectAssistantHandler } from './project-assistant/project-assistant.handler';
import type { RunSubagentsTool } from './submission-tools/run-subagents-tool';
import { projectReportHandler } from './project-report/project-report.handler';
import { releaseNotesHandler } from './release-notes/release-notes.handler';
import { projectReportSectionHandler } from './project-report/project-report-section.handler';
import { projectModeHandler } from './project-mode';
import type { PromptTypeHandler } from './prompt-type-handler';
import { proposalRefinerHandler } from './proposal-refiner/proposal-refiner.handler';
import { reportUpdateHandler } from './report-update/report-update.handler';
import { researchHandler } from './research';
import { sessionMessageHandler } from './session-message/session-message.handler';
import {
  workTrackerConnectHandler,
  workTrackerImportHandler,
} from './work-tracker-import/work-tracker-import.handler';
import { repositoryAnalysisHandler } from './repository-analysis';
import { repositoryFeatureEnrichmentHandler } from './repository-feature-enrichment';
import { repositoryFirstWorkHandler } from './repository-first-work';
import { repositoryPlacementHandler } from './repository-placement';
import { reviewHandler } from './review-subagent/review.handler';
import { rollupProposalHandler } from './rollup-proposal/rollup-proposal.handler';
import { runEvalHandler } from './run-eval';
import { evalJudgeHandler } from './run-eval/eval-judge.handler';
import { evalPreparationHandler } from './run-eval/eval-preparation.handler';
import { EVAL_CONSUMER_HANDLER_IDS, EVAL_TARGET_HANDLER_IDS } from './run-eval/eval-targets';
import { SessionMonitorHandler } from './session-monitor';
import { setSplittingHandler } from './set-splitting/set-splitting.handler';
import type { CreateReportProxy } from './submission-tools/create-report-proxy';
import { taskRefinerHandler } from './task-refiner/task-refiner.handler';
import { taskMonitorHandler } from './task-monitor';
import { validationWalkthroughHandler } from './validation/validation.handler';
import { VerifyFeatureHandler } from './verify-feature';
import { verificationPlanHandler } from './verification-plan/verification-plan.handler';
import { workflowDefinedStub } from './workflow-defined/workflow-defined.stub';
import type { PlanSubmissionAdmissionClient } from './plan-shaping/plan-submission-admission.client';

export interface PromptTypeRegistryDependencies {
  createReportProxy: CreateReportProxy;
  entityConversation: EntityConversationHandlerDependencies;
  planSubmissionAdmissionClient: PlanSubmissionAdmissionClient;
  /**
   * Late-bound to the subagent fan-out by the Run runtime; unbound, it rejects correctably.
   * `null` switches the research subagents off for Project Assistant.
   */
  runSubagentsTool?: RunSubagentsTool | null;
  /** Defined only with a Jev key; Project Assistant then filters its parent feature load. */
  parentRequirements?: ParentRequirementsFilter;
  /** Defined only with a Jev key; Project Assistant then gathers context into its prompt before its session starts. */
  contextGathering?: ContextGatheringDeps;
  /** The machine's Jev switch, read on every Project Assistant prepare; off disables both Jev uses above. */
  isJevEnabled?: () => Promise<boolean>;
}

interface BuilderSpec {
  promptType: string;
  build: () => PromptTypeHandler<unknown>;
}

const staticHandler = (promptType: string, handler: PromptTypeHandler<unknown>): BuilderSpec => ({
  promptType,
  build: () => handler,
});

const createHandlerBuilders = (
  createReportProxy: CreateReportProxy,
  entityConversationHandler: EntityConversationHandler,
  admissionClient: PlanSubmissionAdmissionClient,
  runSubagentsTool: RunSubagentsTool | null | undefined,
  parentRequirements: ParentRequirementsFilter | undefined,
  contextGathering: ContextGatheringDeps | undefined,
  isJevEnabled: (() => Promise<boolean>) | undefined,
): readonly BuilderSpec[] => [
  staticHandler(LocalPromptType.StartupSession, codingPlanHandler),
  staticHandler(LocalPromptType.PlanExecution, planExecutionHandler),
  staticHandler(LocalPromptType.FinalAssessment, finalAssessmentHandler),
  staticHandler(LocalPromptType.RunEval, runEvalHandler),
  staticHandler(LocalPromptType.VerificationPlan, verificationPlanHandler),
  staticHandler(LocalPromptType.ChildTaskUpdates, childTaskUpdatesHandler),
  {
    promptType: LocalPromptType.EntityConversation,
    build: () => entityConversationHandler,
  },
  {
    promptType: LocalPromptType.VerifyFeature,
    build: () => new VerifyFeatureHandler(entityConversationHandler.submissionTools),
  },
  {
    promptType: LocalPromptType.GoalPm,
    build: () => new GoalPmHandler(),
  },
  staticHandler(LocalPromptType.SetSplitting, setSplittingHandler),
  staticHandler(LocalPromptType.OpenItemsTriage, new OpenItemsTriageHandler()),
  staticHandler(LocalPromptType.FreeForm, freeFormHandler),
  staticHandler(LocalPromptType.Debug, debugHandler),
  staticHandler(LocalPromptType.Research, researchHandler),
  staticHandler(LocalPromptType.Quick, quickHandler),
  staticHandler(LocalPromptType.DailySession, dailySessionCoachHandler),
  staticHandler(LocalPromptType.RollupProposal, rollupProposalHandler),
  staticHandler(LocalPromptType.TaskRefiner, taskRefinerHandler),
  staticHandler(LocalPromptType.FeatureRefiner, featureRefinerHandler),
  staticHandler(LocalPromptType.DesignDocRefiner, designDocRefinerHandler),
  staticHandler(LocalPromptType.ProposalRefiner, proposalRefinerHandler),
  {
    promptType: LocalPromptType.Commit,
    build: () => new CommitHandler(createReportProxy),
  },
  staticHandler(LocalPromptType.AgentSearch, agentSearchHandler),
  staticHandler(LocalPromptType.ReportUpdate, reportUpdateHandler),
  staticHandler(LocalPromptType.CodeReview, reviewHandler),
  staticHandler(LocalPromptType.FeatureSyncAnalyze, featureSyncAnalyzeHandler),
  staticHandler(LocalPromptType.FeatureSyncIterate, featureSyncIterateHandler),
  staticHandler(
    LocalPromptType.PlanShapingFeatureSyncAnalyze,
    planShapingFeatureSyncAnalyzeHandler,
  ),
  staticHandler(
    LocalPromptType.PlanShapingFeatureSyncIterate,
    planShapingFeatureSyncIterateHandler,
  ),
  staticHandler(
    LocalPromptType.PlanShapingFeatureSyncDiscuss,
    planShapingFeatureSyncDiscussHandler,
  ),
  staticHandler(LocalPromptType.Implement, implementHandler),
  staticHandler(LocalPromptType.ValidationWalkthrough, validationWalkthroughHandler),
  staticHandler(LocalPromptType.PlanShapingProposedStages, planShapingProposedStagesHandler),
  staticHandler(LocalPromptType.PlanShapingRefineStage, planShapingRefineStageHandler),
  staticHandler(LocalPromptType.PlanShapingVisualPreview, planShapingVisualPreviewHandler),
  {
    promptType: LocalPromptType.PlanShapingPhaseBreakdown,
    build: () => new PlanShapingPhaseBreakdownHandler(createReportProxy, admissionClient),
  },
  {
    promptType: LocalPromptType.PlanShapingStepReview,
    build: () => createPlanShapingStepReviewHandler(admissionClient),
  },
  staticHandler(LocalPromptType.PlanShapingFinalize, planShapingFinalizeHandler),
  staticHandler(LocalPromptType.CodingFreeform, codingFreeformHandler),
  staticHandler(LocalPromptType.SessionMessage, sessionMessageHandler),
  staticHandler(LocalPromptType.WorkflowDefined, workflowDefinedStub),
  staticHandler(LocalPromptType.FeatureTreeConversation, featureTreeConversationHandler),
  staticHandler(LocalPromptType.ProjectReport, projectReportHandler),
  staticHandler(LocalPromptType.ReleaseNotes, releaseNotesHandler),
  {
    promptType: LocalPromptType.SessionMonitor,
    build: () => new SessionMonitorHandler(createReportProxy),
  },
  staticHandler(LocalPromptType.TaskMonitor, taskMonitorHandler),
  staticHandler(LocalPromptType.WorkTrackerConnect, workTrackerConnectHandler),
  staticHandler(LocalPromptType.WorkTrackerImport, workTrackerImportHandler),
  staticHandler(LocalPromptType.RepositoryGrounding, repositoryAnalysisHandler),
  staticHandler(LocalPromptType.RepositoryFeatureEnrichment, repositoryFeatureEnrichmentHandler),
  staticHandler(LocalPromptType.RepositoryFirstWork, repositoryFirstWorkHandler),
  staticHandler(LocalPromptType.RepositoryPlacement, repositoryPlacementHandler),
  staticHandler(LocalPromptType.HtmlCssMockupRevision, htmlCssMockupRevisionHandler),
  {
    promptType: LocalPromptType.ProjectAssistant,
    build: () =>
      new ProjectAssistantHandler(
        createReportProxy,
        runSubagentsTool,
        parentRequirements,
        contextGathering,
        isJevEnabled,
      ),
  },
  // Project-defined routing is deliberately last: built-ins retain first
  // claim on their stable prompt types and the registry stores no MODE state.
  staticHandler(LocalPromptType.ProjectMode, projectModeHandler),
];

/**
 * Handlers that only ever run as children through ChildAgentLauncher. They
 * declare a child configuration and are never dispatched by prompt type.
 */
const CHILD_ONLY_HANDLERS: readonly PromptTypeHandler<unknown>[] = [
  evalPreparationHandler,
  projectReportSectionHandler,
  evalJudgeHandler,
];

export class PromptTypeRegistry {
  private readonly handlersByPromptType = new Map<string, PromptTypeHandler<unknown>>();
  private readonly handlersById = new Map<string, PromptTypeHandler<unknown>>();
  private readonly childOnlyHandlersById = new Map<string, PromptTypeHandler<unknown>>();

  public constructor(dependencies: PromptTypeRegistryDependencies) {
    const registeredPromptTypes = new Set<string>();
    const handlerBuilders = createHandlerBuilders(
      dependencies.createReportProxy,
      new EntityConversationHandler(dependencies.entityConversation),
      dependencies.planSubmissionAdmissionClient,
      dependencies.runSubagentsTool,
      dependencies.parentRequirements,
      dependencies.contextGathering,
      dependencies.isJevEnabled,
    );

    for (const spec of handlerBuilders) {
      const promptType = spec.promptType;
      if (registeredPromptTypes.has(promptType)) {
        throw new Error(`PromptTypeRegistry: duplicate handler for '${promptType}'.`);
      }

      const handler = spec.build();
      if (typeof handler.id !== 'string' || !handler.id.trim()) {
        throw new Error(
          `PromptTypeRegistry: handler '${promptType}' must declare a non-empty stable id.`,
        );
      }

      if (this.handlersById.has(handler.id)) {
        throw new Error(`PromptTypeRegistry: duplicate handler id '${handler.id}'.`);
      }

      registeredPromptTypes.add(promptType);
      this.handlersByPromptType.set(promptType, handler);
      this.handlersById.set(handler.id, handler);
    }

    for (const promptType of Object.values(LocalPromptType)) {
      if (!registeredPromptTypes.has(promptType)) {
        throw new Error(`PromptTypeRegistry: missing handler for '${promptType}'.`);
      }
    }

    for (const handler of CHILD_ONLY_HANDLERS) {
      if (this.handlersById.has(handler.id) || this.childOnlyHandlersById.has(handler.id)) {
        throw new Error(`PromptTypeRegistry: duplicate handler id '${handler.id}'.`);
      }
      if (!handler.childConfig) {
        throw new Error(
          `PromptTypeRegistry: child-only handler '${handler.id}' must declare a child configuration.`,
        );
      }
      this.childOnlyHandlersById.set(handler.id, handler);
    }

    for (const handlerId of EVAL_TARGET_HANDLER_IDS) {
      if (!this.handlersById.has(handlerId)) {
        throw new Error(
          `PromptTypeRegistry: eval target '${handlerId}' must be a registered handler.`,
        );
      }
    }

    for (const handlerId of EVAL_CONSUMER_HANDLER_IDS) {
      if (!this.handlersById.get(handlerId)?.projectAssistant) {
        throw new Error(
          `PromptTypeRegistry: eval consumer '${handlerId}' must be a registered handler that declares a Project Assistant policy.`,
        );
      }
    }
  }

  public get(promptType: string | undefined): PromptTypeHandler<unknown> | undefined {
    if (!promptType) return undefined;
    return this.handlersByPromptType.get(promptType);
  }

  /** Resolve the handler that owns a persisted provider-session agent id. */
  public getById(handlerId: string): PromptTypeHandler<unknown> | undefined {
    return this.handlersById.get(handlerId);
  }

  /** Resolve a handler the child launcher may start, including child-only handlers. */
  public getChildHandler(handlerId: string): PromptTypeHandler<unknown> | undefined {
    return this.handlersById.get(handlerId) ?? this.childOnlyHandlersById.get(handlerId);
  }

  public list(): readonly PromptTypeHandler<unknown>[] {
    return Array.from(this.handlersByPromptType.values());
  }
}
