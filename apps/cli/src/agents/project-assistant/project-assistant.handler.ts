import { HINT_READ_MCP_TOOLS, resolveMcpToolNames } from '../mcp-server-config';
import type { AgenticSession } from '../../session/types';
import { LocalPromptType, SessionRole } from '../../shared/agent-bridge-contract/generated/api';
import type { RunCreatePayloadResearch } from '../../shared/agent-bridge-contract/generated/api';
import { ReportAudience, ReportType } from '../../shared/api/index';
import type {
  LocalWorktreeStateByService,
  ResolvedServiceBinding,
} from '../../shared/agent-bridge-contract/contract';
import {
  type PrepareResult,
  type ProjectAssistantPolicy,
  type PromptTypeHandler,
  type PromptTypeHandlerContext,
  type PromptTypeHandlerDeps,
  type ReportSpec,
  type ResolveAdditionalAllowedToolsArgs,
} from '../prompt-type-handler';
import { buildProjectAssistantPrompt } from '../prompts/project-assistant';
import { CodingResearchTool } from '../submission-tools/create-coding-research-tool';
import type { CreateReportProxy } from '../submission-tools/create-report-proxy';
import { RunSubagentsTool } from '../submission-tools/run-subagents-tool';
import { resolveFocal } from '../context-trimming/create-trimmer';
import { gatherProjectContext, type ContextGatheringDeps } from './context-gathering';
import { loadNearestParentFeatureSection } from './nearest-parent-feature';
import type { ParentRequirementsFilter } from './parent-requirements';
import { resolveProjectAssistantAdditionalTools } from './proactive-behavior';
import { prepareRecentProjectAssistantReportContext } from './recent-report-context';
import { resolveProjectAssistantTaskType } from './task-context';

interface ProjectAssistantHandoff {
  consumerHandlerId: string;
  policy: ProjectAssistantPolicy;
}

export type ProjectAssistantPromptPayload = RunCreatePayloadResearch & {
  projectAssistantHandoff: ProjectAssistantHandoff;
};

type EnrichedPayload = ProjectAssistantPromptPayload & {
  _priorProjectAssistantReportContext?: string;
  _nearestParentFeature?: string;
  _services?: ResolvedServiceBinding[];
  _launchServiceId?: string;
  _worktreeState?: LocalWorktreeStateByService;
  _gatheredContext?: string;
};

export class ProjectAssistantHandler implements PromptTypeHandler<ProjectAssistantPromptPayload> {
  public readonly id = 'project_assistant';
  public readonly handsOffOrdinaryReplies = true as const;
  public readonly sessionRole = SessionRole.Research;
  public readonly promptType = LocalPromptType.ProjectAssistant;
  public readonly service = 'optional';
  public readonly launchEntity = 'none';
  public readonly implementationReadiness = 'none';
  public readonly runnerKind = 'provider_session' as const;
  public readonly providerSessionCountsForContext = true;
  public readonly providerSessionLifetime = 'turn' as const;
  // The research thread is discarded before the consuming handler starts,
  // so its read-only reviewer policy cannot leak into a writing session.
  public readonly readOnlyFilesystem = true;
  public readonly mcpToolUseCase = 'research' as const;
  public readonly additionalAllowedTools = [
    'get_agent_session',
    'get_agent_sessions',
    'get_report_body',
    'get_report_schema',
    'list_reports_by_entity',
    'list_services',
    'plan_search',
    ...HINT_READ_MCP_TOOLS,
  ];
  // No built-in tools. The agent has no file-reading surface — Read, Bash,
  // Glob, Grep are all absent. The project graph (via MCP) is the only
  // investigation surface. The prompt does not need a code-gate conditional
  // because there is nothing to gate.
  public readonly builtinTools = [];
  public readonly childConfig = {
    adapterId: 'eval-project-assistant',
    mcpAllowedTools: resolveMcpToolNames({
      useCase: 'research',
      additionalTools: this.additionalAllowedTools,
    }),
    builtinAllowedTools: [],
    submissionTools: 'none' as const,
    codexSandboxMode: 'read-only' as const,
    includePriorReports: false,
  };
  public readonly reports: readonly ReportSpec[] = [
    {
      reportType: ReportType.CodingResearch,
      audience: ReportAudience.ProjectVisible,
      required: true,
    },
  ];
  public readonly submissionTools: (CodingResearchTool | RunSubagentsTool)[];
  private readonly parallelResearchSubagents: boolean;

  /**
   * `runSubagentsTool: null` switches the research subagents off: no tool and no prompt section.
   * `parentRequirements` and `contextGathering` are defined only with a Jev key: the first
   * turns on the filtered parent load, the second the context gathered into the prompt before
   * the session starts.
   */
  public constructor(
    createReportProxy: CreateReportProxy,
    runSubagentsTool: RunSubagentsTool | null = new RunSubagentsTool(),
    private readonly parentRequirements?: ParentRequirementsFilter,
    private readonly contextGathering?: ContextGatheringDeps,
  ) {
    const codingResearchTool = new CodingResearchTool(createReportProxy);
    this.submissionTools = [codingResearchTool, ...(runSubagentsTool ? [runSubagentsTool] : [])];
    this.parallelResearchSubagents = runSubagentsTool !== null;
  }

  public resolveAdditionalAllowedTools({
    payload,
  }: ResolveAdditionalAllowedToolsArgs<ProjectAssistantPromptPayload>) {
    const handoff = payload.projectAssistantHandoff;
    return resolveProjectAssistantAdditionalTools(handoff.policy);
  }

  public async prepare(
    run: AgenticSession,
    payload: ProjectAssistantPromptPayload,
    deps: PromptTypeHandlerDeps,
    ctx?: PromptTypeHandlerContext,
  ): Promise<PrepareResult<ProjectAssistantPromptPayload>> {
    const focalEntity = run.entity;
    if (!focalEntity) {
      deps.logger.error('project_assistant.prepare.missing_run_entity', {
        runId: run.agentic_session_id,
      });
      throw new Error('project_assistant handler requires a persisted Run entity.');
    }
    const handoff = payload.projectAssistantHandoff;
    deps.logger.debug('project_assistant.prepare.policy_received', {
      runId: run.agentic_session_id,
      consumerHandlerId: handoff.consumerHandlerId,
      allowEdgeUpdates: handoff.policy.allowEdgeUpdates,
      notifyDiscrepancies: handoff.policy.notifyDiscrepancies,
      workItemProposalMode: handoff.policy.workItemProposalMode,
    });

    let priorProjectAssistantReportContext: string | null = null;
    priorProjectAssistantReportContext = await prepareRecentProjectAssistantReportContext(
      run,
      focalEntity,
      deps,
    );

    const loaded = ctx?.loadedEntityContext;
    const { organizationId, projectId } = run.contextMetadata ?? {};
    const filterEnabled = this.parentRequirements
      ? await this.parentRequirements.isEnabled()
      : false;
    const nearestParentFeature =
      loaded && organizationId && projectId
        ? await loadNearestParentFeatureSection(
            { organizationId, projectId, context: loaded.context },
            deps,
            this.parentRequirements && filterEnabled
              ? { settings: this.parentRequirements, loaded }
              : undefined,
          )
        : null;

    const enriched: EnrichedPayload = {
      ...payload,
      ...(nearestParentFeature ? { _nearestParentFeature: nearestParentFeature } : {}),
      ...(priorProjectAssistantReportContext
        ? { _priorProjectAssistantReportContext: priorProjectAssistantReportContext }
        : {}),
      ...(run.services && run.services.length > 0 ? { _services: run.services } : {}),
      ...(run.launchServiceId ? { _launchServiceId: run.launchServiceId } : {}),
      ...(run.worktreeState ? { _worktreeState: run.worktreeState } : {}),
    };

    let gatheredContext: string | undefined;
    if (this.contextGathering) {
      const ask = payload.userMessage.trim();
      const focal = await resolveFocal(loaded ?? null, ask || undefined, deps);
      if (focal) {
        const turnId = ctx?.turnId;
        const abortSignal = ctx?.abortSignal?.();
        if (!organizationId || !projectId) {
          throw new Error('project_assistant context gathering requires a project.');
        }
        if (!turnId || !abortSignal) {
          throw new Error('project_assistant context gathering requires a Turn being prepared.');
        }
        gatheredContext = await gatherProjectContext({
          deps: this.contextGathering,
          handlerDeps: deps,
          runId: run.agentic_session_id,
          turnId,
          project: { organizationId, projectId },
          focalRef: { id: focalEntity.entityId, kind: focalEntity.entityType.toLowerCase() },
          focal,
          ask,
          promptContext: this.buildPrompt(enriched, ctx),
          signal: abortSignal,
        });
      } else {
        deps.logger.warn('project_assistant.prepare.context_gathering_skipped', {
          runId: run.agentic_session_id,
          reason: 'no_focal_work',
        });
      }
    }

    if (gatheredContext) enriched._gatheredContext = gatheredContext;
    return { payload: enriched };
  }

  public buildPrompt(
    payload: ProjectAssistantPromptPayload,
    ctx?: PromptTypeHandlerContext,
  ): string {
    const enriched = payload as EnrichedPayload;
    const loadedEntity = ctx?.loadedEntityContext?.entity;
    const loadedWorkItemType =
      loadedEntity && 'type' in loadedEntity && typeof loadedEntity.type === 'string'
        ? loadedEntity.type
        : undefined;
    const base = buildProjectAssistantPrompt(
      payload,
      {
        services: enriched._services,
        launchServiceId: enriched._launchServiceId,
        worktreeState: enriched._worktreeState,
      },
      {
        handoffTo: enriched.projectAssistantHandoff.consumerHandlerId,
        policy: enriched.projectAssistantHandoff.policy,
        focalTaskType: resolveProjectAssistantTaskType(loadedWorkItemType),
        parallelResearchSubagents: this.parallelResearchSubagents,
        hasNearestParentFeature: enriched._nearestParentFeature !== undefined,
        provider: ctx?.provider,
      },
    );
    const sections: string[] = [base];
    if (enriched._nearestParentFeature) {
      sections.push(enriched._nearestParentFeature);
    }
    if (enriched._gatheredContext) {
      sections.push(enriched._gatheredContext);
    }
    if (enriched._priorProjectAssistantReportContext) {
      sections.push(enriched._priorProjectAssistantReportContext);
    }
    return sections.join('\n\n');
  }
}
