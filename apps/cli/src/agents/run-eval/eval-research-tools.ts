import { renderCodingResearchMemo } from '../prompts/coding-research-memo';
import type { RunMemo } from '../../session/types';
import Ajv from 'ajv';
import type { AgenticSession } from '../../session/types';
import type { ChildAgentLauncher } from '../../run/child-agent-launcher';
import type { SubAgentUsage } from '../../run/subagent';
import type { CodingResearchReportPayload } from '../../shared/api/generated/api';
import type { JsonObject, JsonValue } from '../platform-mcp-proxy/session';
import type { ProjectAssistantPromptPayload } from '../project-assistant/project-assistant.handler';
import { resolveProjectAssistantChecksForRun } from '../project-assistant/task-context';
import { CodingResearchTool } from '../submission-tools/create-coding-research-tool';
import { RunSubagentsTool } from '../submission-tools/run-subagents-tool';
import type { SubmissionToolDeclaration } from '../submission-tools/types';
import type { EvalExecutionContext } from './eval-execution-context';

/** Totals are unavailable when any participating provider omitted the measurement. */
export const sumEvalUsage = (usages: readonly SubAgentUsage[]): SubAgentUsage => {
  const total: SubAgentUsage = {};
  if (!usages.length) return total;
  for (const key of ['inputTokens', 'outputTokens', 'toolCalls'] as const) {
    const values = usages.map((usage) => usage[key]);
    if (values.every((value) => value !== undefined))
      total[key] = values.reduce((sum, value) => sum + value, 0);
  }
  return total;
};

/** Owns the real research tools and retained structured result for one isolated attempt. */
export class EvalResearchTools {
  private readonly validators = new Ajv({ strict: false });
  private output: CodingResearchReportPayload | null = null;
  private readonly childUsage: SubAgentUsage[] = [];
  private readonly pending = new Set<Promise<JsonValue>>();
  private readonly declarations: readonly (CodingResearchTool | RunSubagentsTool)[];

  public constructor(
    private readonly input: {
      session: AgenticSession;
      payload: ProjectAssistantPromptPayload;
      tools: readonly SubmissionToolDeclaration[];
      launcher: Pick<ChildAgentLauncher, 'launchRegistered'>;
      execution: EvalExecutionContext;
      signal: AbortSignal;
      tokenBudget?: number;
      workItemType?: string;
    },
  ) {
    // Only these two tools have an attempt-owned execution path. Other Run
    // submission tools must never be mounted on the coordinator's behalf.
    this.declarations = input.tools.filter(
      (tool): tool is CodingResearchTool | RunSubagentsTool =>
        tool instanceof CodingResearchTool || tool instanceof RunSubagentsTool,
    );
  }

  public get session(): AgenticSession {
    return this.input.session;
  }

  public get toolNames(): readonly string[] {
    return this.declarations.map((tool) => tool.name);
  }

  public get tools(): JsonObject[] {
    return this.declarations.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: JSON.parse(JSON.stringify(tool.inputSchema)),
    }));
  }

  public get outputText(): string | undefined {
    return this.output ? JSON.stringify(this.output) : undefined;
  }

  public get memo(): RunMemo | undefined {
    return this.output
      ? {
          source: 'project_assistant',
          content: renderCodingResearchMemo(this.output),
          writtenAt: new Date().toISOString(),
        }
      : undefined;
  }

  public recordOutput(payload: CodingResearchReportPayload): void {
    this.output = payload;
  }

  public combineUsage(parent: SubAgentUsage): SubAgentUsage {
    return sumEvalUsage([parent, ...this.childUsage]);
  }

  public async call(name: string, args: JsonObject): Promise<JsonValue> {
    const request = this.execute(name, args);
    this.pending.add(request);
    try {
      return await request;
    } finally {
      this.pending.delete(request);
    }
  }

  /** Close the proxy first, then drain writes before the attempt becomes terminal. */
  public async settle(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  private async execute(name: string, args: JsonObject): Promise<JsonValue> {
    const tool = this.declarations.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`Research tool "${name}" is unavailable.`);
    const validate = this.validators.compile(tool.inputSchema);
    if (!validate(args)) {
      return {
        isError: true,
        content: [{ type: 'text', text: this.validators.errorsText(validate.errors) }],
      };
    }
    try {
      const result = await tool.execute({
        runId: this.session.agentic_session_id,
        args,
        evalResearch: this,
      });
      return JSON.parse(JSON.stringify(result));
    } catch (error) {
      return {
        isError: true,
        content: [
          { type: 'text', text: error instanceof Error ? error.message : 'Research tool failed.' },
        ],
      };
    }
  }

  public async runChildren(objectives: readonly string[]) {
    const checks = resolveProjectAssistantChecksForRun(
      this.input.payload.projectAssistantHandoff.policy,
      this.session.entity,
      this.input.workItemType,
    );
    return Promise.all(
      objectives.map(async (objective) => {
        try {
          const result = await this.input.launcher.launchRegistered('research', {
            parentSession: this.session,
            payload: { userMessage: objective, _projectAssistantChecks: checks },
            signal: this.input.signal,
            evalExecution: this.input.execution,
            ...(this.session.model ? { model: this.session.model } : {}),
            ...(this.session.reasoningEffort
              ? { reasoningEffort: this.session.reasoningEffort }
              : {}),
            ...(!this.session.services.length ? { serviceIds: [] } : {}),
            ...(this.input.tokenBudget !== undefined
              ? { tokenBudget: this.input.tokenBudget }
              : {}),
          });
          this.childUsage.push(result.usage);
          return {
            objective,
            outcome: result.assistantCompleted ? ('succeeded' as const) : ('failed' as const),
            ...(result.outputText ? { outputText: result.outputText } : {}),
          };
        } catch (error) {
          this.childUsage.push({});
          return {
            objective,
            outcome: 'failed' as const,
            reason: error instanceof Error ? error.message : 'Research child failed.',
          };
        }
      }),
    );
  }
}
