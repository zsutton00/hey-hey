import { describe, expect, it, vi } from 'vitest';

import { createTestRun } from '../../run/run.test-support';
import { CommitReportTool } from './create-commit-report-tool';
import { makeCreateReportProxy } from './create-report-proxy.test-support';

const makeRun = (entity: { entityType: 'TASK' | 'SERVICE'; entityId: string }) => {
  const run = createTestRun({
    runId: 'session-1',
    conversationId: 'conversation-1',
    projectId: 'project-1',
  });
  run.session.entity = entity;
  run.session.promptType = 'commit';
  vi.spyOn(run, 'appendReportChainEntry').mockImplementation(() => undefined);
  vi.spyOn(run, 'recordPreviousProviderSession').mockImplementation(() => undefined);
  return run;
};

const commitArgs = {
  summary: 'fix: commit canonical files',
  files: ['src/a.ts'],
  hashes: [
    { service: 'service-1', hash: 'abc1234' },
    { service: 'service-2', hash: 'def5678' },
  ],
};

describe('CommitReportTool', () => {
  it('keeps task-backed COMMIT evidence primary on the task', async () => {
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({ content: [], reportId: 'report-1' });
    const run = makeRun({ entityType: 'TASK', entityId: 'task-1' });

    await new CommitReportTool(proxy).execute({ runId: 'session-1', run, args: commitArgs });

    expect(proxy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          entities: [{ entityType: 'TASK', entityId: 'task-1', relation: 'PRIMARY' }],
        }),
      }),
    );
  });

  it('attaches taskless COMMIT evidence to the Agent Session and committed Services', async () => {
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({ content: [], reportId: 'report-1' });
    const run = makeRun({ entityType: 'SERVICE', entityId: 'service-1' });

    await new CommitReportTool(proxy).execute({ runId: 'session-1', run, args: commitArgs });

    expect(proxy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          entities: [
            { entityType: 'AGENT_SESSION', entityId: 'session-1', relation: 'PRIMARY' },
            { entityType: 'SERVICE', entityId: 'service-1', relation: 'CONTEXT' },
            { entityType: 'SERVICE', entityId: 'service-2', relation: 'CONTEXT' },
          ],
        }),
      }),
    );
  });
});
