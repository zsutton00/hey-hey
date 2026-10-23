/**
 * `create_commit_report` pass-through submission tool.
 *
 * Called by the runtime-owned commit executor once a successful commit
 * operation has completed. The commit subagent only supplies the message and
 * never receives this tool. The wrapper:
 *
 * 1. Posts a COMMIT report to the platform via the proxy.
 * 2. Appends a matching `ReportChainEntry` to the Run's report chain.
 * 3. Records a `PreviousProviderSession` on the Run summarising committed services and hashes.
 *
 * The tool must NOT be called when no git commit was produced.
 */

import type { ReportChainEntry } from '../../run/types';
import type { CreateReportDto } from '../../shared/api/generated/api';
import type { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { CreateReportProxy } from './create-report-proxy';
import type { PassThroughSubmissionToolDeclaration, SubmissionToolExecuteContext } from './types';

const CREATE_COMMIT_REPORT_TOOL_NAME = 'create_commit_report';

const CREATE_COMMIT_REPORT_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: {
      type: 'string',
      minLength: 1,
      description: '50–100 word handoff summarising what was committed and the outcome.',
    },
    files: {
      type: 'array',
      description: 'Paths of all files staged and committed.',
      items: { type: 'string' },
    },
    hashes: {
      type: 'array',
      description:
        'One entry per repository committed in. `service` is the session service id; `hash` is the short SHA printed by git commit; `branch` is the branch checked out where the commit landed.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['service', 'hash', 'branch'],
        properties: {
          service: { type: 'string', minLength: 1 },
          hash: { type: 'string', minLength: 1 },
          branch: { type: 'string', minLength: 1 },
        },
      },
    },
  },
  required: ['summary', 'files', 'hashes'],
} as const;

export class CommitReportTool implements PassThroughSubmissionToolDeclaration {
  public readonly kind = 'pass_through' as const;
  public readonly name = CREATE_COMMIT_REPORT_TOOL_NAME;
  public readonly description =
    'Record the COMMIT report once a git commit has been successfully produced. ' +
    'Call this exactly once on a successful commit with `summary`, `files`, and `hashes` ' +
    '(one `{ service, hash, branch }` entry per repository committed in). ' +
    'Do NOT call this tool if no git commit was produced.';
  public readonly inputSchema = CREATE_COMMIT_REPORT_INPUT_SCHEMA as unknown as Record<
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
      throw new Error('create_commit_report wrapper: ctx.run is required for pass-through tools');
    }

    const phase = run.session.promptType as LocalPromptType | undefined;
    if (!phase) {
      throw new Error(
        'create_commit_report wrapper: run.session.promptType is required to derive chain entry phase',
      );
    }

    const summaryRaw = ctx.args['summary'];
    const filesRaw = ctx.args['files'];
    const hashesRaw = ctx.args['hashes'];

    if (typeof summaryRaw !== 'string' || summaryRaw.length === 0) {
      throw new Error('create_commit_report wrapper: summary must be a non-empty string');
    }

    const summary: string = summaryRaw;
    const files: string[] = Array.isArray(filesRaw) ? (filesRaw as string[]) : [];
    const hashes: Array<{ service: string; hash: string; branch: string }> = Array.isArray(
      hashesRaw,
    )
      ? (hashesRaw as Array<{ service: string; hash: string; branch: string }>)
      : [];

    const entities = run.taskId
      ? [
          {
            entityType: 'TASK' as const,
            entityId: run.taskId,
            relation: 'PRIMARY' as const,
          },
        ]
      : [
          {
            entityType: 'AGENT_SESSION' as const,
            entityId: run.runId,
            relation: 'PRIMARY' as const,
          },
          ...hashes.map(({ service }) => ({
            entityType: 'SERVICE' as const,
            entityId: service,
            relation: 'CONTEXT' as const,
          })),
        ];

    const platformArgs = {
      reportType: 'COMMIT',
      audience: 'PROJECT_VISIBLE',
      payload: {
        reportType: 'COMMIT',
        summary,
        files,
        hashes,
      },
      entities,
    } satisfies CreateReportDto;

    const proxyResult = await this.proxy.create({
      runId: ctx.runId,
      args: platformArgs,
      conversationId: run.conversationId,
      projectId: run.projectId,
    });

    const entry: ReportChainEntry = {
      createdAt: this.now(),
      phase,
      reportId: proxyResult.reportId,
      reportType: 'COMMIT',
      summary,
      audience: 'EXTERNAL',
    };

    run.appendReportChainEntry(entry);

    const hashLines = hashes.map((h) => `- ${h.service}: \`${h.hash}\` (${h.branch})`).join('\n');

    run.recordPreviousProviderSession({
      promptType: phase,
      lastMessage: `## Committed\n\n${hashLines || '(no hashes recorded)'}\n\n---\n\n${summary}`,
      completedAt: this.now(),
    });

    return {
      content: [
        { type: 'text', text: `COMMIT report created (reportId: ${proxyResult.reportId}).` },
      ],
    };
  };
}
