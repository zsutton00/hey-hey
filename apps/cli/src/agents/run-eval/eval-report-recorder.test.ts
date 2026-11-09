import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';
import type { EvalRunReportPayload } from '@hey-hey/contracts/api/models';
import { EvalReportRecorder } from './eval-report-recorder';

const RUN_ID = 'run-1';

interface UpdateRequest {
  updateReportDto: { payload: unknown; expectedVersion?: number };
}

/** A report store that, like the platform, refuses an update based on an old version. */
const fakePlatform = () => {
  const stored = {
    payload: {
      reportType: 'EVAL_RUN',
      evalId: 'eval-1',
      status: 'QUEUED',
      cases: [],
      configurations: [],
      settings: { maxConcurrentAttempts: 1 },
    } as unknown as EvalRunReportPayload,
    version: 1,
  };
  // Runs once, between the runner's read and its write.
  const beforeNextUpdate: Array<() => void> = [];

  const client = {
    getReport: async () => ({
      data: { data: { id: RUN_ID, payload: stored.payload, version: stored.version } },
    }),
    updateReport: async ({ updateReportDto }: UpdateRequest) => {
      beforeNextUpdate.shift()?.();
      if (updateReportDto.expectedVersion !== stored.version) {
        throw new AxiosError('conflict', '409', undefined, undefined, {
          status: 409,
        } as never);
      }
      stored.payload = updateReportDto.payload as EvalRunReportPayload;
      stored.version += 1;
    },
  };
  const rename = (name: string) => {
    stored.payload = { ...stored.payload, name };
    stored.version += 1;
  };
  return { stored, client, rename, beforeNextUpdate };
};

describe('EvalReportRecorder', () => {
  it('keeps a name given to the run while it was going', async () => {
    const platform = fakePlatform();
    const recorder = new EvalReportRecorder(platform.client as never, 'org-1', RUN_ID);

    await recorder.setRunStatus('RUNNING');
    platform.rename('Renamed mid-run');
    await recorder.setRunStatus('FINISHED');

    expect(platform.stored.payload).toMatchObject({
      status: 'FINISHED',
      name: 'Renamed mid-run',
    });
  });

  it('does not overwrite a rename saved after the runner read the run', async () => {
    const platform = fakePlatform();
    const recorder = new EvalReportRecorder(platform.client as never, 'org-1', RUN_ID);
    platform.beforeNextUpdate.push(() => platform.rename('Saved during the write'));

    await recorder.setRunStatus('FINISHED');

    expect(platform.stored.payload).toMatchObject({
      status: 'FINISHED',
      name: 'Saved during the write',
    });
    expect(platform.stored.payload).toHaveProperty('completedAt');
  });
});
