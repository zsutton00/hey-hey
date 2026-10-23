import { z } from 'zod';
import type {
  ChangedFileReportInput,
  ChangedFileReportFinding,
  ChangedFileReportResult,
} from '../../shared/agent-bridge-contract/generated/api';
import { reportedChangedFileSchema } from '../completion-reconciliation/schemas';
import type { PassThroughSubmissionToolDeclaration } from './types';

const reportInput = z
  .object({
    turnId: z.string().min(1),
    providerSessionId: z.string().min(1),
    changedFiles: z.array(reportedChangedFileSchema),
  })
  .strict() satisfies z.ZodType<ChangedFileReportInput>;

/** Items are deliberately admitted to item validation rather than rejected as a batch. */
export const reportChangedFilesTool = {
  kind: 'pass_through',
  name: 'report_changed_files',
  description:
    'Report service-qualified repository-relative changed files before completing. Use [] for no changes. Correct rejected claims and report again after edits. Supply the current Turn and provider session; a context rejection returns the expected identities.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      turnId: { type: 'string' },
      providerSessionId: { type: 'string' },
      changedFiles: { type: 'array', items: {} },
    },
    required: ['changedFiles'],
  },
  async execute(ctx) {
    const run = ctx.run;
    const turn = run?.activeTurn;
    if (
      !run ||
      ctx.runId !== run.runId ||
      !turn ||
      ctx.args['turnId'] !== turn.turnId ||
      ctx.args['providerSessionId'] !== run.providerSessionId ||
      !run.providerSessionId ||
      !turn.handler.requiresChangedFileReporting ||
      turn.abortSignal.aborted ||
      turn.phase === 'ended' ||
      turn.completedAssistantMessageId !== null ||
      turn.changedFileReporting.isReleasing
    ) {
      const result = {
        state: 'needs_correction',
        findings: [
          {
            index: 0,
            status: 'rejected',
            reason:
              'context_rejected: report must match the active Run, Turn and provider session.',
          },
        ],
        context: {
          turnId: turn?.turnId ?? null,
          providerSessionId: run?.providerSessionId ?? null,
        },
      } satisfies ChangedFileReportResult;
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    const rawItems = ctx.args['changedFiles'];
    if (!Array.isArray(rawItems)) throw new Error('changedFiles must be an array');
    const findings: ChangedFileReportFinding[] = [];
    const claims: Array<{ index: number; claim: z.infer<typeof reportedChangedFileSchema> }> = [];
    for (const [index, rawItem] of rawItems.entries()) {
      const parsed = reportedChangedFileSchema.safeParse(rawItem);
      if (parsed.success) claims.push({ index, claim: parsed.data });
      else
        findings.push({
          index,
          status: 'rejected',
          reason: 'invalid_claim: supply nonempty serviceId and repository-relative path strings.',
        });
    }
    // Validate the known envelope against its generated contract after item narrowing.
    reportInput.parse({
      turnId: turn.turnId,
      providerSessionId: run.providerSessionId,
      changedFiles: claims.map((item) => item.claim),
    });
    const result = await turn.changedFileReporting.submit(
      run,
      run.providerSessionId,
      claims,
      findings,
    );
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
} satisfies PassThroughSubmissionToolDeclaration;
