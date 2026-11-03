import { Profiler, Session } from 'node:inspector/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  startApiCpuProfiling,
  summarizeCpuProfile,
  sanitizeCpuProfile,
} from '../api-cpu-profiling';

describe('bounded CPU profile evidence', () => {
  it.each([
    [
      '/node_modules/@prisma/client/runtime/library.js',
      'node_modules/@prisma/client/runtime/library.js',
    ],
    [
      'file:///node_modules/rxjs/dist/cjs/index.js',
      'node_modules/rxjs/dist/cjs/index.js',
    ],
    [
      '/app/node_modules/winston/lib/winston.js',
      'node_modules/winston/lib/winston.js',
    ],
    ['/home/private/source.js', ''],
    ['https://private/node_modules/source.js', ''],
  ])(
    'preserves deployed code locations without exposing arbitrary paths: %s',
    (url, expected) => {
      const profile: Profiler.Profile = {
        startTime: 0,
        endTime: 10000,
        samples: [1],
        timeDeltas: [10000],
        nodes: [
          {
            id: 1,
            callFrame: {
              functionName: 'private function',
              scriptId: '1',
              url,
              lineNumber: 4,
              columnNumber: 0,
            },
          },
        ],
      };
      expect(sanitizeCpuProfile(profile).nodes[0]!.callFrame.url).toBe(
        expected,
      );
      expect(summarizeCpuProfile(profile).topFrames).toContainEqual({
        location: expected ? `${expected}:5` : '[unattributed]',
        samples: 1,
      });
      expect(JSON.stringify(sanitizeCpuProfile(profile))).not.toContain(
        'private',
      );
    },
  );

  it('counts code locations but removes arbitrary URLs, function names and payloads', () => {
    const profile: Profiler.Profile = {
      startTime: 0,
      endTime: 30000,
      nodes: [
        {
          id: 1,
          callFrame: {
            functionName: 'private payload',
            scriptId: '1',
            url: '/app/dist/edit.js',
            lineNumber: 7,
            columnNumber: 0,
          },
        },
        {
          id: 2,
          callFrame: {
            functionName: 'secret',
            scriptId: '2',
            url: 'https://private/dist/secret.js',
            lineNumber: 0,
            columnNumber: 0,
          },
        },
        {
          id: 3,
          callFrame: {
            functionName: '(idle)',
            scriptId: '0',
            url: '',
            lineNumber: -1,
            columnNumber: -1,
          },
        },
      ],
      samples: [1, 1, 2, 3],
      timeDeltas: [10000, 10000, 10000, 10000],
    };
    const summary = summarizeCpuProfile(profile);
    profile.nodes[0]!.children = [2, 3];
    const safeProfile = sanitizeCpuProfile(profile);
    expect(safeProfile.nodes[0]!.children).toEqual([2, 3]);
    expect(safeProfile.samples).toEqual(profile.samples);
    expect(safeProfile.timeDeltas).toEqual(profile.timeDeltas);
    expect(safeProfile.nodes[0]!.callFrame.url).toBe('dist/edit.js');
    expect(JSON.stringify(safeProfile)).not.toMatch(/secret|private|payload/);
    expect(summary.sampleCount).toBe(4);
    expect(summary.topFrames).toContainEqual({
      location: 'dist/edit.js:8',
      samples: 2,
    });
    expect(summary.topFrames).toContainEqual({
      location: '[unattributed]',
      samples: 1,
    });
    expect(JSON.stringify(summary)).not.toMatch(
      /secret|private|token|functionName/,
    );
  });

  it('does nothing outside explicitly enabled staging', async () => {
    const emit = jest.fn();
    await (
      await startApiCpuProfiling(emit, {
        DEPLOYMENT_ENVIRONMENT: 'production',
        API_DIAGNOSTIC_CPU_PROFILE_ENABLED: 'true',
      })
    )();
    await (
      await startApiCpuProfiling(emit, { DEPLOYMENT_ENVIRONMENT: 'staging' })
    )();
    expect(emit).not.toHaveBeenCalled();
  });

  it('captures a real interval and releases the inspector on stop', async () => {
    // Advance only the diagnostic window; keep inspector scheduling real.
    const schedule = jest.spyOn(global, 'setTimeout');
    const disconnect = jest.spyOn(Session.prototype, 'disconnect');
    let stop: (() => Promise<void>) | undefined;
    const records: Record<string, unknown>[] = [];
    const directory = mkdtempSync(join(process.cwd(), '.cpu-profile-test-'));
    try {
      stop = await startApiCpuProfiling(
        (record) => records.push(record),
        {
          DEPLOYMENT_ENVIRONMENT: 'staging',
          API_DIAGNOSTIC_CPU_PROFILE_ENABLED: 'true',
        },
        directory,
      );
      expect(schedule).toHaveBeenCalledWith(expect.any(Function), 30000);
      const [finishWindow] = schedule.mock.calls[0]!;
      await delay(25);
      finishWindow(undefined);
      // Stop awaits the in-flight profile before disconnecting the session.
      await stop();
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        message: 'API diagnostic CPU profile interval',
        samplingIntervalUs: 10000,
      });
      expect(records[0]).toHaveProperty('topFrames');
      expect(records[0]!.profileDurationMs).toBeGreaterThan(0);
      const path = join(directory, records[0]!.artifact as string);
      const artifact = JSON.parse(readFileSync(path, 'utf8'));
      expect(artifact.pid).toBe(process.pid);
      expect(artifact.profile.nodes.length).toBeGreaterThan(0);
      expect(artifact.profile.timeDeltas.length).toBe(
        artifact.profile.samples.length,
      );
      expect(statSync(path).mode & 0o777).toBe(0o600);
    } finally {
      await stop?.();
      schedule.mockRestore();
      disconnect.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
