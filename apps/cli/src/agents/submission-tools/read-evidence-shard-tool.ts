/**
 * `read_evidence_shard` pass-through submission tool.
 *
 * Report agents read their evidence through this tool, one page of one shard
 * per call. The host records every page it returns, which is how it knows every
 * record was read. Section children call it through the parent Run's
 * registration, so their reads count toward the parent's `create_report` check.
 */

import {
  PROJECT_REPORT_FINDINGS_DOCUMENT_ID,
  ProjectReportEvidenceReadError,
  projectReportEvidenceLedgers,
  type ProjectReportEvidenceLedgers,
} from '../project-report/project-report-evidence-store';
import {
  SubmissionToolCorrectableError,
  type PassThroughSubmissionToolDeclaration,
  type SubmissionToolExecuteContext,
  type SubmissionToolPassThroughResult,
} from './types';

export const READ_EVIDENCE_SHARD_TOOL_NAME = 'read_evidence_shard';

const READ_EVIDENCE_SHARD_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    shardId: {
      type: 'string',
      minLength: 1,
      description: `A shard id from the manifest, or "${PROJECT_REPORT_FINDINGS_DOCUMENT_ID}" for the section findings.`,
    },
    page: {
      type: 'integer',
      minimum: 1,
      description: 'Which page of the shard to return. Defaults to 1.',
    },
  },
  required: ['shardId'],
} as const;

const unreadPagesNote = (pages: readonly number[]): string =>
  pages.length === 0
    ? 'You have now read every page of this shard.'
    : `Pages of this shard not yet read: ${pages.join(', ')}.`;

export class ReadEvidenceShardTool implements PassThroughSubmissionToolDeclaration {
  public readonly kind = 'pass_through' as const;
  public readonly name = READ_EVIDENCE_SHARD_TOOL_NAME;
  public readonly description =
    'Read one page of one evidence shard from this report’s manifest, as JSON lines. Every shard has one or more pages; call it for every page of every shard you are responsible for. The host tracks which pages it has returned, and the report cannot be submitted until every shard has been read to its last page.';
  public readonly inputSchema = READ_EVIDENCE_SHARD_INPUT_SCHEMA as unknown as Record<
    string,
    unknown
  >;

  public constructor(
    private readonly ledgers: ProjectReportEvidenceLedgers = projectReportEvidenceLedgers,
  ) {}

  public readonly execute = async (
    ctx: SubmissionToolExecuteContext,
  ): Promise<SubmissionToolPassThroughResult> => {
    const run = ctx.run;
    if (!run) {
      throw new Error('read_evidence_shard: ctx.run is required for pass-through tools');
    }

    const shardId = String(ctx.args['shardId']);
    const page = typeof ctx.args['page'] === 'number' ? ctx.args['page'] : 1;
    const ledger = this.ledgers.get(run.session.agentic_session_id);
    if (!ledger) {
      throw new SubmissionToolCorrectableError({
        reason: 'This session has no evidence to read.',
        findings: [
          {
            identity: shardId,
            reason: 'No evidence manifest was prepared for this session.',
            correction:
              'Work from the evidence named in your prompt; there is nothing to read here.',
          },
        ],
      });
    }

    try {
      const result = await ledger.readPage(shardId, page);
      const shard = ledger.manifest.shards.find((entry) => entry.id === shardId);
      const header = `${result.documentId} page ${String(result.page)} of ${String(result.pageCount)}, ${String(result.recordCount)} line${result.recordCount === 1 ? '' : 's'}.`;
      const note = shard ? unreadPagesNote(ledger.unreadPages(shard)) : '';

      return {
        content: [{ type: 'text', text: [header, note, '', result.text].join('\n') }],
      };
    } catch (error) {
      if (!(error instanceof ProjectReportEvidenceReadError)) {
        throw error;
      }
      throw new SubmissionToolCorrectableError({
        reason: error.message,
        findings: [
          {
            field: 'shardId',
            reason: error.message,
            correction: 'Use a shard id and page number that exist in the manifest.',
          },
        ],
      });
    }
  };
}

export const readEvidenceShardTool = new ReadEvidenceShardTool();
