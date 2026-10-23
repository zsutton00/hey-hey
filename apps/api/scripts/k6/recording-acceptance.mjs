// Artifact acceptance is independent of workload exit status. These checks own
// the process/file boundary; downstream analysis consumes accepted evidence.
const services = [
  'api',
  'graph-service',
  'embeddings',
  'postgres',
  'neo4j',
  'vespa',
];
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const timestamp = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

export function validateCpuProfile(profile) {
  if (
    !profile ||
    !Array.isArray(profile.nodes) ||
    !profile.nodes.length ||
    !Array.isArray(profile.samples) ||
    !profile.samples.length ||
    !Array.isArray(profile.timeDeltas) ||
    profile.timeDeltas.length !== profile.samples.length ||
    !finite(profile.startTime) ||
    !finite(profile.endTime) ||
    profile.endTime <= profile.startTime
  )
    return 'CPU profile has no readable samples/timing';
  const ids = new Set(profile.nodes.map((n) => n.id));
  if (
    ids.size !== profile.nodes.length ||
    profile.nodes.some(
      (n) =>
        !Number.isInteger(n.id) ||
        !n.callFrame ||
        !(n.children ?? []).every((id) => ids.has(id)),
    ) ||
    !profile.samples.every((id) => ids.has(id)) ||
    !profile.timeDeltas.every((delta) => finite(delta) && delta >= 0)
  )
    return 'CPU profile contains invalid node relationships or sample references';
  const parents = new Map();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) {
      if (parents.has(child)) return 'CPU call tree has multiple parents';
      parents.set(child, node.id);
    }
  const roots = profile.nodes.filter((n) => !parents.has(n.id));
  if (roots.length !== 1) return 'CPU call tree has no unique root';
  const visited = new Set();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const pending = [roots[0].id];
  while (pending.length) {
    const id = pending.pop();
    if (visited.has(id)) return 'CPU call tree contains a cycle';
    visited.add(id);
    pending.push(...(byId.get(id).children ?? []));
  }
  if (visited.size !== ids.size) return 'CPU call tree is disconnected';
  return null;
}

export function acceptRuntimeRecording(recording, window) {
  const failures = [];
  if (
    recording?.schemaVersion !== 1 ||
    !recording.identities ||
    !recording.collectors
  )
    return {
      complete: false,
      failures: ['Runtime recording schema unavailable'],
    };
  for (const name of services) {
    const identity = recording.identities[name];
    if (
      !identity?.containerId ||
      !identity.imageId ||
      !Number.isInteger(identity.hostPid) ||
      identity.hostPid <= 0 ||
      !timestamp(identity.startedAt)
    )
      failures.push(`${name}: container/image/PID identity missing`);
  }
  if (
    !timestamp(recording.startedAt) ||
    !timestamp(recording.endedAt) ||
    Date.parse(recording.startedAt) > Date.parse(window.startAt) ||
    Date.parse(recording.endedAt) < Date.parse(window.endAt)
  )
    failures.push('Runtime recording does not contain the requested window');
  for (const name of ['api', 'graph-service', 'neo4j', 'embeddings']) {
    const collector = recording.collectors[name];
    if (collector?.complete !== true || !collector.data) {
      failures.push(
        `${name}: ${collector?.error ?? 'required recording incomplete'}`,
      );
      continue;
    }
    const data = collector.data;
    if (name === 'api') {
      const profiles = data.profiles;
      if (!Array.isArray(profiles) || !profiles.length) {
        failures.push('api: no call-tree profiles');
        continue;
      }
      let cursor = Date.parse(window.startAt);
      for (const row of [...profiles].sort(
        (a, b) =>
          Date.parse(a.intervalStartUtc) - Date.parse(b.intervalStartUtc),
      )) {
        const error = validateCpuProfile(row.profile);
        if (error) failures.push(`api: ${error}`);
        if (
          !timestamp(row.intervalStartUtc) ||
          !timestamp(row.intervalEndUtc) ||
          !Number.isInteger(row.pid)
        ) {
          failures.push('api: invalid profile identity/window');
          continue;
        }
        if (Date.parse(row.intervalStartUtc) > cursor + 1000)
          failures.push('api: profile coverage gap exceeds one second');
        cursor = Math.max(cursor, Date.parse(row.intervalEndUtc));
      }
      if (cursor < Date.parse(window.endAt))
        failures.push('api: final measured window is not recorded');
      if (new Set(profiles.map((p) => p.pid)).size !== 1)
        failures.push('api: process changed across captured profiles');
    } else {
      if (
        !timestamp(data.startedAt) ||
        !timestamp(data.endedAt) ||
        Date.parse(data.startedAt) > Date.parse(window.startAt) ||
        Date.parse(data.endedAt) < Date.parse(window.endAt) ||
        Date.parse(data.startedAt) + data.maximumSeconds * 1000 <
          Date.parse(window.endAt)
      )
        failures.push(`${name}: profile does not cover the requested window`);
      if (name === 'embeddings') {
        if (
          !Array.isArray(data.processes) ||
          !data.processes.length ||
          !Array.isArray(data.profiles) ||
          data.processes.some(
            (p) =>
              !data.profiles.some(
                (profile) =>
                  profile.pid === p.pid &&
                  profile.speedscope?.profiles?.some((s) => s.samples?.length),
              ),
          )
        )
          failures.push('embeddings: worker stack coverage unavailable');
      } else if (
        !data.process?.pid ||
        !Array.isArray(data.events) ||
        !data.events.some(
          (e) =>
            ['jdk.ExecutionSample', 'jdk.NativeMethodSample'].includes(
              e.type,
            ) &&
            data.enabledEvents?.includes(e.type) &&
            data.eventCounts?.[e.type] > 0 &&
            e.values?.stackTrace?.frames?.length,
        )
      )
        failures.push(`${name}: JFR execution stacks/events unavailable`);
    }
  }
  return { complete: failures.length === 0, failures };
}

export function acceptDatabasePlans(plans) {
  const failures = [];
  const outcome = plans?.collectors?.postgres;
  if (outcome?.complete !== true || !outcome.data?.entries?.length) {
    return {
      complete: false,
      failures: [
        `postgres: ${outcome?.error ?? 'query mapping/plans unavailable'}`,
      ],
    };
  }
  if (
    outcome.data.entries.some(
      (entry) =>
        !entry.ownerOperation ||
        !entry.source ||
        !timestamp(entry.startedAt) ||
        !timestamp(entry.endedAt),
    )
  )
    failures.push('postgres: plan owner/window missing');
  if (
    !outcome.data.entries.some(
      (entry) =>
        entry.fingerprints?.length &&
        entry.targetedPlan?.length &&
        entry.inSituPlans?.length,
    )
  )
    failures.push(
      'postgres: fingerprint mapping and both targeted/sampled plans are required',
    );
  if (
    !outcome.data.selectedExpensive?.length ||
    outcome.data.selectedExpensive.some((entry) => !entry.mapped)
  )
    failures.push('postgres: selected expensive fingerprints remain unmapped');
  return { complete: failures.length === 0, failures };
}

export function diagnosticStatus(workloadSucceeded, recordingAcceptance) {
  if (!recordingAcceptance.complete) return 'recording-incomplete';
  return workloadSucceeded ? 'completed' : 'failed';
}

export function acceptResourceCounters(cpu) {
  const failures = [];
  if (!cpu?.measuredSamples || cpu.errors?.length)
    failures.push('Six-service resource sampling incomplete');
  for (const name of services) {
    const counter =
      cpu?.measuredCounters?.containers?.[`hey-hey-staging-${name}-1`];
    if (!counter?.samples || !counter.intervals?.length || counter.gaps?.length)
      failures.push(`${name}: cumulative resource/process counters incomplete`);
  }
  const slice = cpu?.measuredCounters?.slice;
  if (!slice?.samples || !slice.intervals?.length || slice.gaps?.length)
    failures.push('Shared staging slice CPU/throttling counters incomplete');
  return { complete: failures.length === 0, failures };
}

export function acceptCollectors({
  evidence,
  cpu,
  postgresWaits,
  snapshots,
  runtime,
  plans,
  window,
}) {
  const failures = [];
  for (const name of [
    'api',
    'graph',
    'embeddings',
    'database',
    'traceVolume',
    'droppedTelemetry',
  ]) {
    const result = evidence[name];
    if (!result?.succeeded || !result.outputRecorded || result.parseError)
      failures.push(`${name}: required collector failed, empty or unparsable`);
  }
  failures.push(...acceptResourceCounters(cpu).failures);
  if (!postgresWaits?.samples || postgresWaits.errors?.length)
    failures.push('PostgreSQL wait sampling incomplete');
  if (snapshots.some((s) => !s?.available))
    failures.push('PostgreSQL before/warmup/after snapshots incomplete');
  failures.push(
    ...acceptRuntimeRecording(runtime, window).failures,
    ...acceptDatabasePlans(plans).failures,
  );
  return { complete: failures.length === 0, failures };
}
