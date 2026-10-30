import { describe, expect, it, vi } from 'vitest';

import { ReportAudience, ReportType } from '../../shared/api/index';
import type { AgenticSession } from '../../session/types';
import type { LocalCodeReviewPromptPayload } from '../../shared/agent-bridge-contract/index';
import type { PromptTypeHandlerContext, PromptTypeHandlerDeps } from '../prompt-type-handler';
import { REVIEW_SUBAGENT_MCP_ALLOWED_TOOLS, reviewHandler } from './review.handler';
import { ReviewIntegrationContextResolver } from './review-integration-context';

const logger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
});

const contextWithReplies = (
  recentUserReplies: PromptTypeHandlerContext['recentUserReplies'],
): PromptTypeHandlerContext => ({
  recentUserReplies,
  triggerParentMessageId: null,
});

describe('reviewHandler', () => {
  it('has no individual-file approval tool', () => {
    expect(reviewHandler.submissionTools?.map((tool) => tool.name)).toEqual([]);
  });
  it('requires the change walkthrough and keeps REVIEW as optional evidence', () => {
    expect(reviewHandler.reports).toEqual([
      {
        reportType: ReportType.ChangeWalkthrough,
        audience: ReportAudience.ProjectVisible,
        required: true,
      },
      { reportType: ReportType.Review, audience: ReportAudience.ProjectVisible, required: false },
    ]);
    expect(REVIEW_SUBAGENT_MCP_ALLOWED_TOOLS).toContain('get_report_schema');
    expect(reviewHandler.onSubagentComplete).toBeUndefined();
  });

  it('accepts an empty Review payload scoped by the selected Agent Session', async () => {
    const reviewLogger = logger();
    const payload = {};

    await expect(
      reviewHandler.prepare!(
        { agentic_session_id: '55555555-5555-4555-8555-555555555555' } as AgenticSession,
        payload,
        { logger: reviewLogger } as unknown as PromptTypeHandlerDeps,
        contextWithReplies([]),
      ),
    ).resolves.toEqual({ payload: { _recentUserReplies: [] } });
    expect(reviewLogger.debug).toHaveBeenCalledWith('local.review.prepare.session_scoped', {
      runId: '55555555-5555-4555-8555-555555555555',
      hasFocusMessage: false,
      recentUserReplyCount: 0,
      serviceCount: 0,
      hasLaunchServiceId: false,
      worktreeServiceCount: 0,
      integrationTrigger: null,
    });
  });

  it('retains every recent user reply on the prepared payload for the subagent prompt', async () => {
    const recentUserReplies = [
      {
        messageId: 'message-later',
        text: 'Keep the renamed command.',
        createdAt: '2026-09-16T05:10:00.000Z',
      },
      {
        messageId: 'message-earlier',
        text: 'Rename the command.',
        createdAt: '2026-09-16T05:00:00.000Z',
      },
    ];
    const reviewLogger = logger();

    const prepared = await reviewHandler.prepare!(
      { agentic_session_id: '55555555-5555-4555-8555-555555555555' } as AgenticSession,
      {},
      { logger: reviewLogger } as unknown as PromptTypeHandlerDeps,
      contextWithReplies(recentUserReplies),
    );

    expect(prepared.payload).toMatchObject({ _recentUserReplies: recentUserReplies });
    const prompt = reviewHandler.buildPrompt(prepared.payload);
    expect(prompt.indexOf('Rename the command.')).toBeLessThan(
      prompt.indexOf('Keep the renamed command.'),
    );
    expect(reviewLogger.debug).toHaveBeenCalledWith(
      'local.review.prepare.session_scoped',
      expect.objectContaining({ recentUserReplyCount: 2 }),
    );
  });

  it('projects every selected Service onto its resolved worktree for Review', async () => {
    const payload = {};
    const prepared = await reviewHandler.prepare!(
      {
        agentic_session_id: '55555555-5555-4555-8555-555555555555',
        services: [
          { id: 'service-a', path: '/repos/service-a' },
          { id: 'service-b', path: '/repos/service-b' },
        ],
        launchServiceId: 'service-a',
        worktreeState: {
          'service-a': {
            repoPath: '/repos/service-a',
            worktreePath: '/worktrees/service-a',
            branch: 'review-branch',
          },
          'service-b': {
            repoPath: '/repos/service-b',
            worktreePath: '/worktrees/service-b',
            branch: 'review-branch',
          },
        },
      } as unknown as AgenticSession,
      payload,
      { logger: logger() } as unknown as PromptTypeHandlerDeps,
    );

    const prompt = reviewHandler.buildPrompt(prepared.payload);

    expect(prompt).toContain(
      '- Launch service `service-a` at `/worktrees/service-a` — this is the launch Service workspace and working directory for the session.',
    );
    expect(prompt).toContain('- `service-b` at `/worktrees/service-b`');
    expect(prompt).toContain("Host checkouts are outside this session's working context");
    expect(prompt).not.toContain('/repos/service-a');
    expect(prompt).not.toContain('/repos/service-b');
    expect(prompt).toContain('## Cross-Service Integration Verification');
  });

  it('retains dependency-derived integration context on the prepared payload', async () => {
    const resolve = vi
      .spyOn(ReviewIntegrationContextResolver.prototype, 'resolve')
      .mockResolvedValueOnce({
        trigger: 'cross_service_dependency',
        selectedServiceIds: ['service-a'],
        originatingTaskId: 'task-a',
        originatingTaskServiceIds: ['service-a'],
        dependencyTaskIds: ['task-b'],
        dependencyServiceIds: ['service-b'],
      });

    const prepared = await reviewHandler.prepare!(
      {
        agentic_session_id: '55555555-5555-4555-8555-555555555555',
        services: [{ id: 'service-a', path: '/repos/service-a' }],
      } as unknown as AgenticSession,
      {},
      { logger: logger() } as unknown as PromptTypeHandlerDeps,
    );

    expect(prepared.payload).toMatchObject({
      _integrationContext: { trigger: 'cross_service_dependency' },
    });
    expect(reviewHandler.buildPrompt(prepared.payload)).toContain(
      '## Cross-Service Integration Verification',
    );
    resolve.mockRestore();
  });

  it('uses the same prompt path for an optional empty focus message', () => {
    const prompt = reviewHandler.buildPrompt({ userMessage: '' });
    expect(prompt).toContain('# Review');
    expect(prompt).not.toContain('Terminal Policy Context');
    expect(prompt).not.toContain('## User Focus');
  });

  it('ignores legacy file decisions when rendering current Service authority', () => {
    const prompt = reviewHandler.buildPrompt({
      _reviewFileScopeDecision: {
        requestId: 'request-1',
        decision: 'approve',
        files: [
          {
            serviceId: 'service-cli',
            filePath: 'src/run/run.ts',
            reason: 'Required repair.',
          },
        ],
      },
    } as LocalCodeReviewPromptPayload & {
      _reviewFileScopeDecision: {
        requestId: string;
        decision: 'approve';
        files: Array<{ serviceId: string; filePath: string; reason: string }>;
      };
    });

    expect(prompt).not.toContain('The user approved this one request');
    expect(prompt).toContain('neither this list nor approved Service workspace roots authorize edits');
  });
});
