import { Session, Profiler } from 'node:inspector/promises';
import { mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SAMPLE_INTERVAL_US = 10_000;
const WINDOW_MS = 30_000;

// Private rolling artifacts avoid Loki line-size limits. Deployment collection
// consumes this fixed path; general telemetry retains only flat summaries.
export const API_CPU_PROFILE_DIRECTORY = '/tmp/heyhey-api-cpu-profiles';
const RETAINED_WINDOWS = 40;

export function sanitizeCpuProfile(
  profile: Profiler.Profile,
): Profiler.Profile {
  return {
    startTime: profile.startTime,
    endTime: profile.endTime,
    samples: profile.samples,
    timeDeltas: profile.timeDeltas,
    nodes: profile.nodes.map((node) => {
      const frame = node.callFrame;
      const match = frame.url.match(
        /^(?:file:\/\/)?\/app\/(dist|node_modules)\/([A-Za-z0-9_./@+-]+)$/,
      );
      const builtin = [
        '(idle)',
        '(garbage collector)',
        '(program)',
        '(root)',
      ].includes(frame.functionName);
      return {
        id: node.id,
        children: node.children,
        hitCount: node.hitCount,
        callFrame: {
          functionName: builtin ? frame.functionName : '[code]',
          scriptId: '0',
          url: match ? `${match[1]}/${match[2]}` : '',
          lineNumber: match ? frame.lineNumber : -1,
          columnNumber: match ? frame.columnNumber : -1,
        },
      };
    }),
  };
}

export async function persistCpuProfile(
  profile: Profiler.Profile,
  intervalStartUtc: string,
  intervalEndUtc: string,
  directory = API_CPU_PROFILE_DIRECTORY,
) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const name = `cpu-${process.pid}-${Date.parse(intervalEndUtc)}.json`;
  const path = join(directory, name);
  await writeFile(
    `${path}.pending`,
    JSON.stringify({
      schemaVersion: 1,
      service: 'api',
      pid: process.pid,
      intervalStartUtc,
      intervalEndUtc,
      samplingIntervalUs: SAMPLE_INTERVAL_US,
      profile: sanitizeCpuProfile(profile),
    }),
    { mode: 0o600 },
  );
  await rename(`${path}.pending`, path);
  const names = (await readdir(directory)).filter((entry) =>
    /^cpu-\d+-\d+\.json$/.test(entry),
  );
  names.sort(
    (a, b) =>
      Number(a.split('-')[2]!.split('.')[0]) -
      Number(b.split('-')[2]!.split('.')[0]),
  );
  await Promise.all(
    names
      .slice(0, Math.max(0, names.length - RETAINED_WINDOWS))
      .map((entry) => unlink(join(directory, entry))),
  );
  return name;
}

// Emit code locations and aggregate sample counts only, never heap, arguments,
// script source, raw profiles or arbitrary script URLs.
export function summarizeCpuProfile(profile: Profiler.Profile) {
  const counts = new Map<number, number>();
  for (const id of profile.samples ?? [])
    counts.set(id, (counts.get(id) ?? 0) + 1);
  const frames = profile.nodes.map((node) => {
    const frame = node.callFrame;
    const match = frame.url.match(
      /^(?:file:\/\/)?\/app\/(dist|node_modules)\/([A-Za-z0-9_./@+-]+)$/,
    );
    const builtin = [
      '(idle)',
      '(garbage collector)',
      '(program)',
      '(root)',
    ].includes(frame.functionName);
    return {
      location: match
        ? `${match[1]}/${match[2]}:${frame.lineNumber + 1}`
        : builtin
          ? frame.functionName
          : '[unattributed]',
      samples: counts.get(node.id) ?? 0,
    };
  });
  const totals = new Map<string, number>();
  for (const frame of frames)
    totals.set(
      frame.location,
      (totals.get(frame.location) ?? 0) + frame.samples,
    );
  const ranked = [...totals]
    .map(([location, samples]) => ({ location, samples }))
    .sort((a, b) => b.samples - a.samples);
  return {
    sampleCount: profile.samples?.length ?? 0,
    profileDurationMs: (profile.endTime - profile.startTime) / 1000,
    topFrames: ranked.slice(0, 20),
    omittedSamples: ranked
      .slice(20)
      .reduce((sum, frame) => sum + frame.samples, 0),
  };
}

export async function startApiCpuProfiling(
  emit: (record: Record<string, unknown>) => void,
  environment: NodeJS.ProcessEnv = process.env,
  artifactDirectory = API_CPU_PROFILE_DIRECTORY,
): Promise<() => Promise<void>> {
  if (
    environment.DEPLOYMENT_ENVIRONMENT !== 'staging' ||
    environment.API_DIAGNOSTIC_CPU_PROFILE_ENABLED !== 'true'
  )
    return async () => {};
  const session = new Session();
  session.connect(); // In-process inspector; no listening debug port.
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let pending = Promise.resolve();
  const send = (record: Record<string, unknown>) => {
    try {
      emit(record);
    } catch {
      /* Diagnostic output cannot fail application work. */
    }
  };
  try {
    await session.post('Profiler.enable');
    await session.post('Profiler.setSamplingInterval', {
      interval: SAMPLE_INTERVAL_US,
    });
    await session.post('Profiler.start');
  } catch (error) {
    session.disconnect();
    throw error;
  }
  let start = new Date().toISOString();
  const schedule = () => {
    timer = setTimeout(() => {
      pending = (async () => {
        try {
          const { profile } = await session.post('Profiler.stop');
          const end = new Date().toISOString();
          const artifact = await persistCpuProfile(
            profile,
            start,
            end,
            artifactDirectory,
          );
          send({
            message: 'API diagnostic CPU profile interval',
            artifact,
            pid: process.pid,
            intervalStartUtc: start,
            intervalEndUtc: end,
            profilingEnabled: true,
            samplingIntervalUs: SAMPLE_INTERVAL_US,
            ...summarizeCpuProfile(profile),
            coverage:
              'Main V8 isolate sampled stacks; includes idle and GC. Not per-request CPU, native worker CPU or an isolated profiler-overhead measurement.',
          });
          if (!stopped) {
            await session.post('Profiler.start');
            start = new Date().toISOString();
            schedule();
          }
        } catch {
          stopped = true;
          session.disconnect();
          send({
            message: 'API diagnostic CPU profile unavailable',
            profilingEnabled: true,
          });
        }
      })();
    }, WINDOW_MS);
    timer.unref();
  };
  schedule();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await pending;
    session.disconnect();
  };
}
