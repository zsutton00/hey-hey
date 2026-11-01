import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveMcpToolNames } from '../mcp-server-config';
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
  type ProviderInputRecord,
  type ReportSpec,
  type ResolveAdditionalAllowedToolsArgs,
} from '../prompt-type-handler';
import { buildProjectAssistantPrompt } from '../prompts/project-assistant';
import { CodingResearchTool } from '../submission-tools/create-coding-research-tool';
import type { CreateReportProxy } from '../submission-tools/create-report-proxy';
import { RunSubagentsTool } from '../submission-tools/run-subagents-tool';
import { resolveFocal } from '../context-trimming/create-trimmer';
import { DEFAULT_JEV_MODEL } from '../../jev/client';
import type { Tier } from '../../jev/scenarios';
import type { FullEntityContextDto } from '../../shared/api/generated';
import { gatherProjectContext, type ContextGatheringDeps } from './context-gathering';
import {
  findNearestParentFeatureId,
  loadNearestParentFeatureSection,
  readNearestParentFeature,
  renderParentFeatureSection,
} from './nearest-parent-feature';
import { narrowContext } from './narrow-context';
import type { ParentRequirementsFilter } from './parent-requirements';
import type { JevEvaluator } from '../../jev/scenarios';
import type { LoadedEntityPromptContext } from '../entity-context/types';
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
  /** Set when the starting context was narrowed; names the saved-input trace. */
  _startingContextNarrowed?: true;
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
   * the session starts. `isJevEnabled` is the machine's Jev switch, read once per prepare: off, neither runs.
   */
  public constructor(
    createReportProxy: CreateReportProxy,
    runSubagentsTool: RunSubagentsTool | null = new RunSubagentsTool(),
    private readonly parentRequirements?: ParentRequirementsFilter,
    private readonly contextGathering?: ContextGatheringDeps,
    private readonly isJevEnabled: () => Promise<boolean> = () => Promise.resolve(true),
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
    const hasJev = this.parentRequirements !== undefined || this.contextGathering !== undefined;
    const jevEnabled = hasJev ? await this.isJevEnabled() : false;
    const parentRequirements = jevEnabled ? this.parentRequirements : undefined;
    const contextGathering = jevEnabled ? this.contextGathering : undefined;
    const jevClient = contextGathering?.jev.client ?? parentRequirements?.jevClient;
    const narrowing = jevClient && loaded?.kind === 'entity' ? { jevClient, loaded } : undefined;
    const parentRequest =
      loaded && organizationId && projectId
        ? {
            organizationId,
            projectId,
            context: loaded.context,
            readRestriction: deps.readRestriction,
          }
        : undefined;

    // One parent read serves its presentation, its relevance decision and gathering.
    const parentFeature =
      narrowing && parentRequest ? await readNearestParentFeature(parentRequest, deps) : null;
    const startingContext = narrowing
      ? await this.narrowStartingContext({
          ...narrowing,
          parentFeature,
          run,
          ask: payload.userMessage.trim(),
          model: contextGathering?.jev.model ?? parentRequirements?.model ?? DEFAULT_JEV_MODEL,
          deps,
          ctx,
        })
      : null;
    const parentTier: Tier = startingContext?.tiers.get(parentFeature?.id ?? '') ?? 'full';
    const nearestParentFeature = parentFeature
      ? renderParentFeatureSection(parentFeature, startingContext ? parentTier : 'full')
      : parentRequest && !narrowing
        ? await loadNearestParentFeatureSection(parentRequest, deps)
        : null;
    // Judgment failed: the ordinary Project Assistant researches on its own, without gathering.
    const gathering = narrowing && !startingContext ? undefined : contextGathering;

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
    if (gathering) {
      const ask = payload.userMessage.trim();
      const focal = await resolveFocal(
        loaded ?? null,
        ask || undefined,
        deps,
        parentFeature ?? undefined,
      );
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
          fullEntityIds:
            parentFeature && parentTier === 'full' && startingContext
              ? [parentFeature.id]
              : loaded && nearestParentFeature && !narrowing
                ? [findNearestParentFeatureId(loaded.context)].filter(
                    (id): id is string => id !== null,
                  )
                : [],
          deps: gathering,
          handlerDeps: deps,
          runId: run.agentic_session_id,
          turnId,
          project: { organizationId, projectId, readRestriction: deps.readRestriction },
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
    if (startingContext) {
      enriched._startingContextNarrowed = true;
    }
    return {
      payload: enriched,
      ...(startingContext ? { startupContextReplacement: startingContext.context } : {}),
    };
  }

  /**
   * Jev judges the whole starting neighbourhood against the user's ask. A failure is logged and
   * returns null so the caller keeps the original context: nothing partial is ever used.
   */
  private async narrowStartingContext(args: {
    jevClient: JevEvaluator;
    loaded: Extract<LoadedEntityPromptContext, { kind: 'entity' }>;
    parentFeature: Awaited<ReturnType<typeof readNearestParentFeature>>;
    run: AgenticSession;
    ask: string;
    model: string;
    deps: PromptTypeHandlerDeps;
    ctx: PromptTypeHandlerContext | undefined;
  }): Promise<{ context: FullEntityContextDto; tiers: ReadonlyMap<string, Tier> } | null> {
    const { run, deps } = args;
    const focal = await resolveFocal(
      args.loaded,
      args.ask || undefined,
      deps,
      args.parentFeature ?? undefined,
    );
    if (!focal) {
      deps.logger.warn('project_assistant.prepare.starting_context_narrowing_skipped', {
        runId: run.agentic_session_id,
        reason: 'no_focal_work',
      });
      return null;
    }

    const signal = args.ctx?.abortSignal?.();
    const result = await narrowContext({
      focal,
      context: args.loaded.context,
      ask: args.ask,
      client: args.jevClient,
      model: args.model,
      ...(signal ? { signal } : {}),
    });
    if (!result.ok) {
      deps.logger.warn('project_assistant.prepare.starting_context_narrowing_failed', {
        runId: run.agentic_session_id,
        outcome: 'fallback_to_original_context',
        error: result.cause instanceof Error ? result.cause.message : String(result.cause),
      });
      return null;
    }

    deps.logger.info('project_assistant.prepare.starting_context_narrowed', {
      runId: run.agentic_session_id,
      requests: result.usage.requests,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      candidates: result.tiers.size,
    });
    return result;
  }

  /**
   * Saves the exact input handed to the provider beside the run's gathering trace, so the
   * context the agent received can be read afterwards. Only runs that gathered context save one.
   */
  public async recordProviderInput(record: ProviderInputRecord): Promise<void> {
    const enriched = record.payload as EnrichedPayload;
    const traceLogDir =
      this.contextGathering?.traceLogDir ?? this.parentRequirements?.attemptLogDir;
    if (
      !traceLogDir ||
      (enriched._gatheredContext === undefined && !enriched._startingContextNarrowed)
    ) {
      return;
    }

    const file = path.join(traceLogDir, `${record.runId}.${record.turnId}.input.txt`);
    const text = record.parts
      .map(({ name, text: part }) => `===== ${name} =====\n${part}`)
      .join('\n');
    await mkdir(traceLogDir, { recursive: true });
    await writeFile(file, text, 'utf8');
    record.logger.info('project_assistant.provider_input_saved', {
      runId: record.runId,
      turnId: record.turnId,
      file,
      chars: text.length,
    });
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
