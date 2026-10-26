import path from 'node:path';

import { ReportAudience, ReportType } from '../../shared/api/index';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { LocalCommitPromptPayload } from '../../shared/agent-bridge-contract/runtime-types';
import type { Prepared } from '../../shared/agent-bridge-contract/contract';
import type { AgenticSession } from '../../session/types';
import {
  defaultAddUserMessage,
  type OnSubagentCompleteContext,
  type PrepareResult,
  type SubagentPermissionContext,
  type SubagentPermissionResult,
  type SubagentConfig,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import type { SubmissionToolDeclaration } from '../submission-tools/types';
import { CommitReportTool } from '../submission-tools/create-commit-report-tool';
import type { CreateReportProxy } from '../submission-tools/create-report-proxy';
import { executeCanonicalCommit } from './commit-executor';
import { CommitMessageResultStore } from './commit-message-result';
import { buildCommitPrompt } from './commit-prompt';

const COMMIT_SUBAGENT_MCP_ALLOWED_TOOLS: readonly string[] = [
  'get_context',
  'get_full_entity',
  'search_implementation_hints',
];

const COMMIT_SUBAGENT_BUILTIN_ALLOWED_TOOLS: readonly string[] = ['Read', 'Bash', 'ToolSearch'];
const COMMIT_PLATFORM_TOOLS = new Set(
  COMMIT_SUBAGENT_MCP_ALLOWED_TOOLS.map((tool) => `mcp__heyhey-platform__${tool}`),
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const tokenizeSimpleCommand = (command: string): readonly string[] | null => {
  const trimmed = command.trim();
  if (!trimmed || trimmed.includes('\n') || /[|&;<>`$]/u.test(trimmed)) return null;
  const tokens = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/gu);
  return tokens?.map((token) => token.replace(/^(?:"(.*)"|'(.*)')$/u, '$1$2')) ?? null;
};

const READ_ONLY_GIT_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show', 'rev-parse']);
const GIT_WRITE_OR_EXECUTION_OPTIONS = new Set(['--ext-diff', '--output', '--textconv']);

const hasGitWriteOrExecutionOption = (tokens: readonly string[], start: number): boolean =>
  tokens.slice(start).some((token) => {
    const option = token.split('=', 1)[0];
    return option !== undefined && GIT_WRITE_OR_EXECUTION_OPTIONS.has(option);
  });

export const decideReadOnlyCommitPermission = async (
  ctx: SubagentPermissionContext,
): Promise<SubagentPermissionResult> => {
  if (ctx.toolName === 'Read') {
    if (!isRecord(ctx.input) || typeof ctx.input['file_path'] !== 'string') {
      return { behavior: 'deny', message: 'Read requires a string file_path.' };
    }
    const requested = path.resolve(ctx.input['file_path']);
    return ctx.touchedFilesSet.has(requested)
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: 'Read is limited to canonical Run files.' };
  }
  if (ctx.toolName === 'Bash') {
    if (!isRecord(ctx.input) || typeof ctx.input['command'] !== 'string') {
      return { behavior: 'deny', message: 'Bash requires a string command.' };
    }
    const tokens = tokenizeSimpleCommand(ctx.input['command']);
    if (!tokens || tokens[0] !== 'git') {
      return { behavior: 'deny', message: 'Only a single read-only git command is allowed.' };
    }
    let index = 1;
    let selectedRepo: string | null = null;
    if (tokens[index] === '-C') {
      const repo = tokens[index + 1];
      if (!repo || !ctx.allowedRepoRoots.has(path.resolve(repo))) {
        return { behavior: 'deny', message: 'git -C must target a Run service repository.' };
      }
      selectedRepo = path.resolve(repo);
      index += 2;
    }
    const subcommand = tokens[index];
    if (!subcommand || !READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
      return {
        behavior: 'deny',
        message: 'The commit agent may inspect git state but cannot stage or commit files.',
      };
    }
    if (hasGitWriteOrExecutionOption(tokens, index + 1)) {
      return {
        behavior: 'deny',
        message:
          'Git options that write output files or invoke external diff/textconv helpers are not allowed.',
      };
    }
    if (subcommand === 'status' || subcommand === 'diff') {
      const separator = tokens.indexOf('--', index + 1);
      const pathspecs = separator >= 0 ? tokens.slice(separator + 1) : [];
      if (pathspecs.length === 0) {
        return {
          behavior: 'deny',
          message: `git ${subcommand} requires explicit canonical Run pathspecs after --.`,
        };
      }
      for (const pathspec of pathspecs) {
        const resolved = path.isAbsolute(pathspec)
          ? path.resolve(pathspec)
          : selectedRepo
            ? path.resolve(selectedRepo, pathspec)
            : null;
        if (!resolved || !ctx.touchedFilesSet.has(resolved)) {
          return {
            behavior: 'deny',
            message: `git ${subcommand} pathspec is outside canonical Run scope.`,
          };
        }
      }
    }
    return { behavior: 'allow' };
  }
  // Loading a deferred schema grants nothing; its later call is decided here.
  if (ctx.toolName === 'ToolSearch') return { behavior: 'allow' };
  if (ctx.toolName === 'mcp__heyhey-submission-tools__submit_commit_message') {
    return { behavior: 'allow' };
  }
  if (COMMIT_PLATFORM_TOOLS.has(ctx.toolName)) return { behavior: 'allow' };
  return { behavior: 'deny', message: 'Tool is not in the read-only commit-agent allowlist.' };
};

export class CommitHandler implements UserLaunchablePromptTypeHandler<LocalCommitPromptPayload> {
  public readonly id = 'commit';
  public readonly promptType = LocalPromptType.Commit;
  public readonly service = 'required';
  public readonly launchEntity = 'none';
  public readonly implementationReadiness = 'none';
  public readonly allowsEmptyUserMessage = true;
  public readonly runnerKind = 'subagent' as const;
  public readonly providerSessionCountsForContext = false;
  public readonly reports = [
    { reportType: ReportType.Commit, audience: ReportAudience.ProjectVisible, required: true },
  ];
  public readonly submissionTools: SubmissionToolDeclaration[];
  public readonly subagentConfig: SubagentConfig = {
    includePriorReports: false,
    mcpAllowedTools: COMMIT_SUBAGENT_MCP_ALLOWED_TOOLS,
    builtinAllowedTools: COMMIT_SUBAGENT_BUILTIN_ALLOWED_TOOLS,
    adapterId: 'commit-subagent',
    decidePermission: decideReadOnlyCommitPermission,
  };

  private readonly resultStore = new CommitMessageResultStore();
  private readonly commitReportTool: CommitReportTool;

  public constructor(createReportProxy: CreateReportProxy) {
    this.commitReportTool = new CommitReportTool(createReportProxy);
    this.submissionTools = [this.resultStore.tool];
  }

  public async prepare(
    run: AgenticSession,
    payload: LocalCommitPromptPayload,
  ): Promise<PrepareResult<LocalCommitPromptPayload>> {
    return {
      payload: {
        ...payload,
        ...(run.services.length > 0 ? { services: run.services } : {}),
      },
    };
  }

  public buildPrompt(payload: LocalCommitPromptPayload): string {
    return buildCommitPrompt(payload as Prepared<LocalCommitPromptPayload>);
  }

  public async onSubagentComplete(ctx: OnSubagentCompleteContext): Promise<void> {
    await executeCanonicalCommit({
      run: ctx.run,
      payload: ctx.payload as LocalCommitPromptPayload,
      liveFiles: ctx.touchedFiles,
      message: this.resultStore.consume(ctx.run.runId),
      commitReportTool: this.commitReportTool,
      logger: ctx.logger,
    });
  }

  public addUserMessage(payload: LocalCommitPromptPayload): string | null {
    return defaultAddUserMessage(payload);
  }

  public buildStartingMessage(_payload: LocalCommitPromptPayload): string | null {
    return 'Generating commit message...';
  }
}
