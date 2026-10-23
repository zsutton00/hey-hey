import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgenticSession } from '../../session/types';
import type { ProjectReportRequestProjection } from '../project-report/project-report-request-reader';
import { ProjectReportRequestReader } from '../project-report/project-report-request-reader';
import { ProjectReportEvidenceReader } from '../project-report/project-report-evidence-reader';
import {
  createPromptTypeHandlerTestAuth,
  createPromptTypeHandlerTestDeps,
} from '../prompt-type-handler.test-support';
import { ReleaseNotesHandler } from './release-notes.handler';
import * as history from './release-notes-git';
import { NOOP_LOGGER } from '../../server/logger';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const attemptId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const runId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const serviceId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const payload = {
  promptType: LocalPromptType.ReleaseNotes,
  request: { projectId, requestId, attemptId },
};
const request: ProjectReportRequestProjection = {
  id: requestId,
  projectId,
  kind: 'RELEASE_NOTES',
  status: 'RUNNING',
  submission: {
    kind: 'RELEASE_NOTES',
    serviceIds: [serviceId],
    question: 'What shipped?',
    scope: {
      projectId,
      windowStart: '2026-09-01T00:00:00Z',
      windowEnd: '2026-10-01T00:00:00Z',
      timeZone: 'UTC',
    },
    exclusions: [],
    launch: { machineId: 'machine', provider: 'codex', model: 'model', effort: 'high' },
    idempotencyKey: 'key',
  },
  attempts: [
    {
      id: attemptId,
      attemptNumber: 1,
      status: 'RUNNING',
      agentSessionId: runId,
      idempotencyKey: 'key',
      createdAt: '2026-09-01T00:00:00Z',
    },
  ],
};
const run = {
  agentic_session_id: runId,
  provider: 'codex',
  model: 'model',
  services: [{ id: serviceId, path: '/selected' }],
  launchServiceId: serviceId,
  contextMetadata: { projectId },
  config: {
    type: 'PROJECT_REPORT',
    version: 'v1',
    requestId,
    attemptId,
    model: 'model',
    effort: 'high',
  },
} as AgenticSession;

afterEach(() => vi.restoreAllMocks());

describe('ReleaseNotesHandler accepted repository coverage', () => {
  const prepare = async (activeRun = run) => {
    vi.spyOn(ProjectReportRequestReader.prototype, 'read').mockResolvedValue(request);
    vi.spyOn(ProjectReportEvidenceReader.prototype, 'read').mockResolvedValue({
      subjects: [],
      evidenceReferences: [],
      evidenceReadStartedAt: '2026-10-01T00:00:00Z',
      evidenceReadCompletedAt: '2026-10-01T00:00:01Z',
      coverage: {
        status: 'COMPLETE',
        matchingActivityCount: 0,
        processedActivityCount: 0,
        pagesRead: 1,
        limitations: [],
      },
    });
    const token =
      'header.' +
      Buffer.from(JSON.stringify({ orgId: projectId })).toString('base64url') +
      '.signature';
    return new ReleaseNotesHandler().prepare(
      activeRun,
      payload,
      createPromptTypeHandlerTestDeps({ auth: createPromptTypeHandlerTestAuth(token) }),
      {
        runId,
        logger: NOOP_LOGGER,
        recentUserReplies: [],
        triggerParentMessageId: null,
        repositorySnapshotDirectory: '/snapshots',
      },
    );
  };

  it('reads only the accepted subset and stamps stale coverage when refresh fails', async () => {
    const read = vi.spyOn(history, 'readReleaseNotesRepository').mockResolvedValue({
      serviceId,
      repositoryName: 'selected',
      repositoryPath: '/selected',
      status: 'READ',
      defaultBranch: 'origin/main',
      defaultBranchHead: 'cached',
      codeDirectory: `/snapshots/${serviceId}`,
      commits: [],
      commitsTruncated: false,
      refresh: {
        status: 'FAILED',
        reason:
          'Refreshing origin/main from origin failed (timed out); selected was read from the last fetched origin/main, so its coverage may be stale.',
      },
    });
    const result = await prepare();
    expect(read).toHaveBeenCalledExactlyOnceWith({
      serviceId,
      repositoryPath: '/selected',
      windowStart: request.submission.scope.windowStart,
      windowEnd: request.submission.scope.windowEnd,
      snapshotRoot: '/snapshots',
      logger: expect.anything() as unknown,
    });
    expect(result.payload._releaseNotes?.evidence.coverage.status).toBe('INCOMPLETE');
    expect(result.payload._releaseNotes?.evidence.coverage.limitations[0]).toContain(
      'selected was read from the last fetched origin/main, so its coverage may be stale',
    );
    expect(new ReleaseNotesHandler().readOnlyFilesystem).toBe(true);
  });

  it('rejects expanded repository scope before reading any history', async () => {
    const read = vi.spyOn(history, 'readReleaseNotesRepository');
    await expect(
      prepare({ ...run, services: [...run.services, { id: projectId, path: '/selected' }] }),
    ).rejects.toThrow('durable request');
    expect(read).not.toHaveBeenCalled();
  });
});
