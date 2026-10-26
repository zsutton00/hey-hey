/**
 * `run_subagents` pass-through submission tool.
 *
 * Mounted on the `project_assistant` handler. The agent calls it once with one
 * objective per research angle; each objective runs as a read-only `research`
 * child in parallel on the subagent fan-out machine, and the call returns one
 * result per objective in request order.
 *
 * Handlers are built before the Run runtime that owns the fan-out, so the
 * fan-out is bound late through `bindFanout`. Until it is bound and restored,
 * the tool rejects with a correctable error so the turn can continue without it.
 */

import type { ProjectAssistantPromptPayload } from '../project-assistant/project-assistant.handler';
import { resolveProjectAssistantChecksForRun } from '../project-assistant/task-context';
import { MAX_SUBAGENT_OBJECTIVES } from '../subagent-fanout/machine';
import {
  SubagentFanoutUnavailableError,
  type SubagentChildResult,
  type SubagentFanout,
} from '../subagent-fanout/subagent-fanout-runtime';
import {
  SubmissionToolCorrectableError,
  type PassThroughSubmissionToolDeclaration,
  type SubmissionToolExecuteContext,
  type SubmissionToolPassThroughResult,
} from './types';

const RUN_SUBAGENTS_TOOL_NAME = 'run_subagents';

const RUN_SUBAGENTS_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    objectives: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_SUBAGENT_OBJECTIVES,
      description:
        'One self-contained research objective per distinct angle, in the order you want the results.',
      items: { type: 'string', minLength: 1 },
    },
  },
  required: ['objectives'],
} as const;

const readObjectives = (value: unknown): string[] => {
  const objectives = Array.isArray(value)
    ? value.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    : null;
  if (
    objectives === null ||
    objectives.length === 0 ||
    objectives.length > MAX_SUBAGENT_OBJECTIVES ||
    objectives.some((objective) => objective.length === 0)
  ) {
    throw new SubmissionToolCorrectableError({
      reason: `run_subagents takes 1–${String(MAX_SUBAGENT_OBJECTIVES)} non-empty objectives.`,
      findings: [
        {
          field: 'objectives',
          reason: `Received ${objectives === null ? 'no objectives array' : `${String(objectives.length)} objectives`}.`,
          correction: `Pass between 1 and ${String(MAX_SUBAGENT_OBJECTIVES)} non-empty objective strings, one per research angle.`,
        },
      ],
    });
  }
  return objectives;
};

const formatResults = (results: readonly SubagentChildResult[]): string =>
  [
    `Results for ${String(results.length)} research objective(s), in request order.`,
    ...results.map((result, index) =>
      [
        `### ${String(index + 1)}. ${result.objective}`,
        `Outcome: ${result.outcome}${result.reason ? ` — ${result.reason}` : ''}`,
        '',
        result.outputText ?? '(No final text.)',
      ].join('\n'),
    ),
  ].join('\n\n');

export class RunSubagentsTool implements PassThroughSubmissionToolDeclaration {
  public readonly kind = 'pass_through' as const;
  public readonly name = RUN_SUBAGENTS_TOOL_NAME;
  public readonly description =
    `Run 1–${String(MAX_SUBAGENT_OBJECTIVES)} read-only research subagents in parallel, one per objective. ` +
    'Each child can read the project graph, the code of the session Services, and the web. ' +
    'Returns one result per objective in request order, with its outcome (succeeded, failed, ' +
    'cancelled or interrupted) and the child’s final text. A failed child does not fail the call.';
  public readonly inputSchema = RUN_SUBAGENTS_INPUT_SCHEMA as unknown as Record<string, unknown>;
  // Research children can run for many minutes; the call waits for all of them.
  public readonly maxDurationMs = 60 * 60 * 1000;
  private fanout: SubagentFanout | null = null;

  public bindFanout(fanout: SubagentFanout): void {
    if (this.fanout) throw new Error('Subagent fan-out is already bound.');
    this.fanout = fanout;
  }

  public readonly execute = async (
    ctx: SubmissionToolExecuteContext,
  ): Promise<SubmissionToolPassThroughResult> => {
    if (ctx.evalResearch) {
      const results = await ctx.evalResearch.runChildren(readObjectives(ctx.args['objectives']));
      return { content: [{ type: 'text', text: formatResults(results) }] };
    }
    const run = ctx.run;
    if (!run) throw new Error('run_subagents: ctx.run is required for pass-through tools');
    const objectives = readObjectives(ctx.args['objectives']);
    const turn = run.activeTurn;
    if (!turn) throw new Error('run_subagents: an active Turn is required');
    // Mounted only on project_assistant, so the Turn carries its prepared payload.
    const policy = (turn.payload as ProjectAssistantPromptPayload).projectAssistantHandoff.policy;
    const projectAssistantChecks = resolveProjectAssistantChecksForRun(
      policy,
      run.entity,
      run.workItemType ?? undefined,
    );

    let results: readonly SubagentChildResult[];
    try {
      if (!this.fanout) throw new SubagentFanoutUnavailableError();
      results = await this.fanout.run({
        parentSession: run.session,
        parentRunId: ctx.runId,
        parentTurnId: turn.turnId,
        objectives,
        projectAssistantChecks,
        signal: turn.abortSignal,
      });
    } catch (error) {
      if (!(error instanceof SubagentFanoutUnavailableError)) throw error;
      throw new SubmissionToolCorrectableError({
        reason: 'Research subagents are unavailable in this CLI session.',
        findings: [
          {
            identity: RUN_SUBAGENTS_TOOL_NAME,
            reason: error.message,
            correction: 'Continue the research yourself with the project graph tools.',
          },
        ],
      });
    }
    return { content: [{ type: 'text', text: formatResults(results) }] };
  };
}
