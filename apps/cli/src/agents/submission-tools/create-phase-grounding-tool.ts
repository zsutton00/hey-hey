/**
 * `create_phase_grounding` pass-through submission tool.
 *
 * Local-only wrapper the phase-breakdown handler mounts so the agent can
 * record the touchPoints it has identified for the current phase. The
 * wrapper assembles the platform `create_report` arguments server-side
 * (hardcoded `reportType: 'PHASE_GROUNDING'` and `audience:
 * 'WORKFLOW_ONLY'`) and forwards them via the platform proxy, then
 * appends a matching `ReportChainEntry` to the active Run's append-only
 * report chain so `submit_phase_breakdown` can read it back without a
 * network round-trip.
 *
 * Behavior:
 * - Platform proxy success → derive a `ReportChainEntry` and call
 *   `run.appendReportChainEntry`. Forward the platform's content array to
 *   the agent verbatim on chain-success.
 * - Platform proxy failure → throw without touching the chain. The HTTP
 *   layer surfaces the error as a JSON-RPC error to the agent.
 * - Chain-append failure after platform success → throw. The platform has
 *   already persisted the report, but the wrapper deliberately surfaces
 *   the inconsistency rather than returning success the agent can act on,
 *   since downstream prompt resolution would not see the entry.
 */

import type { Run } from '../../run/run';
import type { ReportChainEntry } from '../../run/types';
import type { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { CreateReportProxy } from './create-report-proxy';
import type { PassThroughSubmissionToolDeclaration, SubmissionToolExecuteContext } from './types';

const CREATE_PHASE_GROUNDING_TOOL_NAME = 'create_phase_grounding';

const CREATE_PHASE_GROUNDING_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    touchPoints: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'expectedOutcome'],
        properties: {
          file: { type: 'string', minLength: 1 },
          expectedOutcome: { type: 'string', minLength: 1 },
        },
      },
    },
    planAdjustment: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['touchPoints'],
} as const;

interface PhaseGroundingTouchPoint {
  file: string;
  expectedOutcome: string;
}

const readTouchPoints = (raw: unknown): ReadonlyArray<PhaseGroundingTouchPoint> => {
  if (!Array.isArray(raw)) {
    throw new Error('create_phase_grounding wrapper: touchPoints must be an array');
  }
  if (raw.length === 0) {
    throw new Error('create_phase_grounding wrapper: touchPoints must contain at least one entry');
  }
  const touchPoints: PhaseGroundingTouchPoint[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('create_phase_grounding wrapper: each touchPoint must be an object');
    }
    const record = entry as Record<string, unknown>;
    const file = record['file'];
    const expectedOutcome = record['expectedOutcome'];
    if (typeof file !== 'string' || file.length === 0) {
      throw new Error('create_phase_grounding wrapper: touchPoint.file must be a non-empty string');
    }
    if (typeof expectedOutcome !== 'string' || expectedOutcome.length === 0) {
      throw new Error(
        'create_phase_grounding wrapper: touchPoint.expectedOutcome must be a non-empty string',
      );
    }
    touchPoints.push({ file, expectedOutcome });
  }
  return touchPoints;
};

export class CreatePhaseGroundingTool implements PassThroughSubmissionToolDeclaration {
  public readonly kind = 'pass_through' as const;
  public readonly name = CREATE_PHASE_GROUNDING_TOOL_NAME;
  public readonly description =
    "Record the touchPoints this phase will land in. Forwards a PHASE_GROUNDING report to the platform and appends a matching entry to the active Run's report chain so `submit_phase_breakdown` can read it back without a network round-trip. `touchPoints` must list every file this phase intends to touch (each `{ file: <repo-relative path>, expectedOutcome: <short prose> }`).";
  public readonly inputSchema = CREATE_PHASE_GROUNDING_INPUT_SCHEMA as unknown as Record<
    string,
    unknown
  >;
  private readonly now: () => string;

  public constructor(
    private readonly proxy: CreateReportProxy,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.now = now;
  }

  public readonly execute = async (ctx: SubmissionToolExecuteContext) => {
    const run = ctx.run;
    if (!run) {
      // The HTTP layer guarantees `ctx.run` is set for pass-through tools
      // before invoking execute. A null here means the dispatcher contract
      // was violated; throw rather than guess.
      throw new Error('create_phase_grounding wrapper: ctx.run is required for pass-through tools');
    }

    const phase = run.session.promptType as LocalPromptType | undefined;
    if (!phase) {
      throw new Error(
        'create_phase_grounding wrapper: run.session.promptType is required to derive chain entry phase',
      );
    }

    const touchPoints = readTouchPoints(ctx.args['touchPoints']);
    const summaryRaw = ctx.args['summary'];
    const summary = typeof summaryRaw === 'string' ? summaryRaw : '';
    const planAdjustmentRaw = ctx.args['planAdjustment'];
    const planAdjustment = typeof planAdjustmentRaw === 'string' ? planAdjustmentRaw : undefined;

    const platformArgs: Record<string, unknown> = {
      reportType: 'PHASE_GROUNDING',
      audience: 'WORKFLOW_ONLY',
      payload: {
        reportType: 'PHASE_GROUNDING',
        summary,
        touchPoints: touchPoints.map((tp) => ({ ...tp })),
        ...(planAdjustment !== undefined ? { planAdjustment } : {}),
      },
    };

    const proxyResult = await this.proxy.create({
      runId: ctx.runId,
      args: platformArgs,
      conversationId: run.conversationId,
      // The platform resolves the report's project ONLY from the
      // X-Project-ID header (its create_report ignores any projectId arg).
      // Source it from the Run's non-nullable project id, the same value
      // mcp-server-config.ts sends for the agent subprocess.
      projectId: run.projectId,
    });

    const entry: ReportChainEntry = {
      createdAt: this.now(),
      phase,
      reportId: proxyResult.reportId,
      reportType: 'PHASE_GROUNDING',
      summary,
      audience: 'INTERNAL',
      touchPoints,
    };

    // Append to the chain after platform success. If this throws (e.g.
    // schema validation in `appendReportChainEntry` rejects the entry),
    // we deliberately let the error propagate — the platform has the
    // report but the Run's chain does not, and silently swallowing the
    // mismatch would let downstream prompt resolution drift from the
    // platform's persisted state.
    run.appendReportChainEntry(entry);

    return {
      content: proxyResult.content,
    };
  };
}
