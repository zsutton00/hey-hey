import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { ReportAgentSessionServicePlacesDto } from '@hey-hey/contracts/api/models';
import { resolveRunWorkspace, type ResolvedRunWorkspace } from '../../agents/run-scope';
import type { SubmissionToolAuth } from '../../agents/submission-tools/submission-tool-auth';
import type { KeyPairStore } from '../../credentials/keypair';
import type { RepoMappingStore } from '../../repo/index';
import { RunStore } from '../../run-store/run-store';
import { NOOP_LOGGER, type ServerLogger } from '../../server/logger';
import type { AgenticSession } from '../../session/types';
import { ServicePlaceReporter } from '../service-place-reporter';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

const makeTempDir = async (prefix: string): Promise<string> => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  tempDirectories.push(directory);

  return directory;
};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const makeRepo = async (branch: string): Promise<string> => {
  const repo = await makeTempDir('place-repo-');
  git(repo, 'init', '-q', '-b', branch);
  git(
    repo,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '--allow-empty',
    '-q',
    '-m',
    'init',
  );

  return repo;
};

const workspaceFor = (
  cwd: string,
  worktree?: ResolvedRunWorkspace['worktree'],
): ResolvedRunWorkspace => ({
  ok: true,
  runMode: 'default',
  repositoryPathForRunStarted: cwd,
  cwd,
  allowedRepositoryRoots: [cwd],
  bindingRepositoryPath: cwd,
  workspaceRoot: null,
  ...(worktree ? { worktree } : {}),
});

type Outcome = 'RECORDED' | 'ALREADY_RECORDED' | 'CONFLICT' | 'NOT_MEMBER';

const makeHarness = async (
  services: Array<{ id: string; path: string }>,
  extra: { bindings?: Record<string, string>; requestTimeoutMs?: number } = {},
) => {
  const baseDir = await makeTempDir('place-store-');
  const runStore = new RunStore({
    paths: {
      baseDir,
      runsDir: path.join(baseDir, 'runs'),
      indexPath: path.join(baseDir, 'runs', 'run-index.json'),
      preferencesPath: path.join(baseDir, 'preferences.json'),
    },
  });
  await runStore.initialize();
  const launchServiceId = services[0]?.id;
  if (!launchServiceId) {
    throw new Error('harness needs a Service');
  }
  let session = await runStore.createRun({
    entity: null,
    agentic_session_id: RUN_ID,
    services,
    launchServiceId: launchServiceId,
    provider: 'codex',
    provider_session_id: 'provider',
    provider_conversation_id: 'conversation',
    conversationId: 'conversation',
    status: 'idle',
    contextMetadata: {
      capturedAt: '2026-07-20T00:00:00.000Z',
      organizationId: 'org',
      projectId: 'project',
      agentSessionId: RUN_ID,
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    },
  });

  const requests: ReportAgentSessionServicePlacesDto[] = [];
  const behavior = {
    outcomes: {} as Record<string, Outcome>,
    rawResults: undefined as unknown[] | undefined,
    recordedPlaces: [] as unknown[],
    fail: false,
    hold: false,
  };
  const warnings: Array<{ event: string; fields: unknown }> = [];
  const logger = Object.assign(Object.create(NOOP_LOGGER) as ServerLogger, {
    warn: (event: string, fields: unknown) => {
      warnings.push({ event, fields });
    },
  });
  const repoStore = {
    getBinding: (serviceId: string) => {
      const repositoryPath = extra.bindings?.[serviceId];

      return Promise.resolve(repositoryPath ? { repositoryPath } : null);
    },
  } as unknown as RepoMappingStore;
  const fetchImpl: typeof fetch = (_url, init) => {
    const body = JSON.parse(init?.body as string) as ReportAgentSessionServicePlacesDto;
    requests.push(body);
    if (behavior.hold) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }
    if (behavior.fail) {
      return Promise.resolve(new Response('boom', { status: 500 }));
    }
    const results = body.places.map((place) => ({
      serviceId: place.serviceId,
      outcome: behavior.outcomes[place.serviceId] ?? 'RECORDED',
    }));

    return Promise.resolve(
      Response.json({
        data: {
          session: { servicePlaces: behavior.recordedPlaces },
          results: behavior.rawResults ?? results,
        },
      }),
    );
  };

  const makeReporter = (initial: AgenticSession) => {
    session = initial;

    return new ServicePlaceReporter({
      runId: RUN_ID,
      organizationId: 'org',
      projectId: 'project',
      apiBaseUrl: 'http://api.test',
      auth: { getAccessToken: () => Promise.resolve('token') } as SubmissionToolAuth,
      fetchImpl,
      keyPairStore: { loadCurrentMachineId: () => Promise.resolve('machine-1') } as KeyPairStore,
      runStore,
      logger,
      ...(extra.requestTimeoutMs ? { requestTimeoutMs: extra.requestTimeoutMs } : {}),
      session: () => session,
      patchSession: (patch) => {
        session = { ...session, ...patch };
      },
    });
  };

  // Stands in for the resolver: the folder each Service resolved to at resolution time.
  const withFolders = (workspace: ResolvedRunWorkspace): ResolvedRunWorkspace => ({
    ...workspace,
    servicePaths: Object.fromEntries(
      session.services.map((service) => [
        service.id,
        service.path === '' ? (extra.bindings?.[service.id] ?? '') : service.path,
      ]),
    ),
  });
  const first = makeReporter(session);
  const startOn = (reporter: ServicePlaceReporter) => (workspace: ResolvedRunWorkspace) =>
    reporter.report(withFolders(workspace));
  // Reports and waits for the background delivery to finish.
  const settledOn = (reporter: ServicePlaceReporter) => async (workspace: ResolvedRunWorkspace) => {
    await startOn(reporter)(workspace);
    await reporter.whenIdle();
  };

  const appendSavedObservations = async (entries: unknown[]): Promise<void> => {
    const runsDir = path.join(baseDir, 'runs');
    const manifest = JSON.parse(
      await fs.readFile(path.join(runsDir, `${RUN_ID}.family.json`), 'utf8'),
    ) as { members: { metadata: { relativePath: string } } };
    const metadataPath = path.join(runsDir, manifest.members.metadata.relativePath);
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as {
      capturedServicePlaces?: unknown[];
    };
    metadata.capturedServicePlaces = [...(metadata.capturedServicePlaces ?? []), ...entries];
    await fs.writeFile(metadataPath, JSON.stringify(metadata), 'utf8');
  };

  return {
    runStore,
    appendSavedObservations,
    requests,
    warnings,
    behavior,
    repoStore,
    reporter: first,
    start: startOn(first),
    report: settledOn(first),
    resume: async () => {
      const stored = await runStore.getRun(RUN_ID);
      if (!stored) {
        throw new Error('run missing');
      }

      return settledOn(makeReporter(stored));
    },
    addServices: async (added: Array<{ id: string; path: string }>) => {
      const next = [...session.services, ...added];
      await runStore.updateRunServices(RUN_ID, {
        services: next,
        launchServiceId: launchServiceId,
      });
      session = { ...session, services: next };
    },
  };
};

describe('ServicePlaceReporter', () => {
  it('reports the branch checked out in the main folder without switching it', async () => {
    const repo = await makeRepo('feature/launch');
    const h = await makeHarness([{ id: 'svc-a', path: repo }]);

    await h.report(workspaceFor(repo));

    expect(h.requests).toEqual([
      {
        machineId: 'machine-1',
        places: [{ serviceId: 'svc-a', kind: 'MAIN_FOLDER', branch: 'feature/launch' }],
      },
    ]);
    expect(git(repo, 'branch', '--show-current')).toBe('feature/launch');
  });

  it('reports a null branch for a detached main folder', async () => {
    const repo = await makeRepo('main');
    git(repo, 'checkout', '-q', '--detach');
    const h = await makeHarness([{ id: 'svc-a', path: repo }]);

    await h.report(workspaceFor(repo));

    expect(h.requests[0]?.places).toEqual([
      { serviceId: 'svc-a', kind: 'MAIN_FOLDER', branch: null },
    ]);
  });

  it('reports a worktree Service with its branch and folder', async () => {
    const repo = await makeRepo('main');
    const worktreePath = path.join(await makeTempDir('place-wt-'), 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'work/a', worktreePath);
    const h = await makeHarness([{ id: 'svc-a', path: repo }]);

    await h.report(
      workspaceFor(worktreePath, { 'svc-a': { worktreePath, branch: 'work/a', repoPath: repo } }),
    );

    expect(h.requests[0]?.places).toEqual([
      { serviceId: 'svc-a', kind: 'WORKTREE', branch: 'work/a', worktreePath },
    ]);
  });

  it('reports only the Service added by an approval, and not again on resume', async () => {
    const repoA = await makeRepo('main');
    const repoB = await makeRepo('develop');
    const h = await makeHarness([{ id: 'svc-a', path: repoA }]);
    await h.report(workspaceFor(repoA));

    await h.addServices([{ id: 'svc-b', path: repoB }]);
    await h.report(workspaceFor(repoA));

    expect(h.requests.map((r) => r.places.map((p) => p.serviceId))).toEqual([['svc-a'], ['svc-b']]);

    const resumed = await h.resume();
    await resumed(workspaceFor(repoA));

    expect(h.requests).toHaveLength(2);
  });

  it('retries only a Service the server says is not a member', async () => {
    const repoA = await makeRepo('main');
    const repoB = await makeRepo('develop');
    const h = await makeHarness([
      { id: 'svc-a', path: repoA },
      { id: 'svc-b', path: repoB },
    ]);
    h.behavior.outcomes['svc-b'] = 'NOT_MEMBER';

    await h.report(workspaceFor(repoA));
    h.behavior.outcomes['svc-b'] = 'RECORDED';
    await h.report(workspaceFor(repoA));

    expect(h.requests.map((r) => r.places.map((p) => p.serviceId))).toEqual([
      ['svc-a', 'svc-b'],
      ['svc-b'],
    ]);
  });

  it('treats a conflicting record as reported', async () => {
    const repo = await makeRepo('main');
    const h = await makeHarness([{ id: 'svc-a', path: repo }]);
    h.behavior.outcomes['svc-a'] = 'CONFLICT';

    await h.report(workspaceFor(repo));
    await h.report(workspaceFor(repo));

    expect(h.requests).toHaveLength(1);
  });

  it('never throws on a failed report and retries it on the next resolution', async () => {
    const repo = await makeRepo('main');
    const h = await makeHarness([{ id: 'svc-a', path: repo }]);
    h.behavior.fail = true;

    await expect(h.start(workspaceFor(repo))).resolves.toBeUndefined();
    await h.reporter.whenIdle();
    h.behavior.fail = false;
    await h.report(workspaceFor(repo));

    expect(h.requests).toHaveLength(2);
    expect((await h.runStore.getRun(RUN_ID))?.reportedServicePlaceServiceIds).toEqual(['svc-a']);
  });

  it('resends the branch seen at launch after a failed report, a checkout and a resume', async () => {
    const repo = await makeRepo('dev');
    git(repo, 'branch', 'release');
    const h = await makeHarness([{ id: 'svc-a', path: repo }]);
    h.behavior.fail = true;

    await h.report(workspaceFor(repo));
    git(repo, 'switch', '-q', 'release');
    h.behavior.fail = false;
    const resumed = await h.resume();
    await resumed(workspaceFor(repo));

    expect(h.requests.map((request) => request.places)).toEqual([
      [{ serviceId: 'svc-a', kind: 'MAIN_FOLDER', branch: 'dev' }],
      [{ serviceId: 'svc-a', kind: 'MAIN_FOLDER', branch: 'dev' }],
    ]);
    const stored = await h.runStore.getRun(RUN_ID);
    expect(stored?.reportedServicePlaceServiceIds).toEqual(['svc-a']);
    expect(stored?.capturedServicePlaces).toEqual([]);
  });

  it('resends a detached launch checkout as detached after it moves onto a branch', async () => {
    const repo = await makeRepo('main');
    git(repo, 'checkout', '-q', '--detach');
    const h = await makeHarness([{ id: 'svc-a', path: repo }]);
    h.behavior.fail = true;

    await h.report(workspaceFor(repo));
    git(repo, 'switch', '-q', 'main');
    h.behavior.fail = false;
    await h.report(workspaceFor(repo));

    expect(h.requests[1]?.places).toEqual([
      { serviceId: 'svc-a', kind: 'MAIN_FOLDER', branch: null },
    ]);
  });

  it('resends the place captured when an approval added a Service', async () => {
    const repoA = await makeRepo('main');
    const repoB = await makeRepo('dev');
    git(repoB, 'branch', 'release');
    const h = await makeHarness([{ id: 'svc-a', path: repoA }]);
    await h.report(workspaceFor(repoA));

    await h.addServices([{ id: 'svc-b', path: repoB }]);
    h.behavior.fail = true;
    await h.report(workspaceFor(repoA));
    git(repoB, 'switch', '-q', 'release');
    h.behavior.fail = false;
    const resumed = await h.resume();
    await resumed(workspaceFor(repoA));

    expect(h.requests.at(-1)?.places).toEqual([
      { serviceId: 'svc-b', kind: 'MAIN_FOLDER', branch: 'dev' },
    ]);
  });

  it('resumes and resends the valid launch places when a saved observation is malformed', async () => {
    const repoA = await makeRepo('dev');
    const repoB = await makeRepo('main');
    git(repoA, 'branch', 'release');
    const h = await makeHarness([
      { id: 'svc-a', path: repoA },
      { id: 'svc-b', path: repoB },
    ]);
    h.behavior.fail = true;
    await h.report(workspaceFor(repoA));
    // Neither added entry is a usable place: one is null, one lacks its folder.
    await h.appendSavedObservations([
      null,
      { serviceId: 'svc-c', kind: 'WORKTREE', branch: 'work/c' },
    ]);
    git(repoA, 'switch', '-q', 'release');
    h.behavior.fail = false;

    const resumed = await h.resume();
    await resumed(workspaceFor(repoA));

    expect(h.requests.at(-1)?.places).toEqual([
      { serviceId: 'svc-a', kind: 'MAIN_FOLDER', branch: 'dev' },
      { serviceId: 'svc-b', kind: 'MAIN_FOLDER', branch: 'main' },
    ]);
  });

  it('skips a Service whose branch cannot be read and still reports the others', async () => {
    const repo = await makeRepo('main');
    const missing = path.join(await makeTempDir('place-missing-'), 'gone');
    const h = await makeHarness([
      { id: 'svc-bad', path: missing },
      { id: 'svc-a', path: repo },
    ]);

    await h.report(workspaceFor(repo));

    expect(h.requests[0]?.places.map((p) => p.serviceId)).toEqual(['svc-a']);
  });

  it('reports the folders the Run resolved even if a repository binding changes afterwards', async () => {
    const repoA = await makeRepo('branch-a');
    const repoB = await makeRepo('branch-b');
    const repoC = await makeRepo('branch-c');
    const bindings: Record<string, string> = { 'svc-b': repoB, 'svc-c': repoC };
    const h = await makeHarness(
      [
        { id: 'svc-a', path: repoA },
        { id: 'svc-b', path: '' },
        { id: 'svc-c', path: '' },
      ],
      { bindings },
    );
    const stored = await h.runStore.getRun(RUN_ID);
    if (!stored) {
      throw new Error('run missing');
    }
    const workspace = await resolveRunWorkspace({
      session: stored,
      repoStore: h.repoStore,
    });
    if (!workspace.ok) {
      throw new Error(workspace.message);
    }

    // The bindings now point at each other's checkouts.
    bindings['svc-b'] = repoC;
    bindings['svc-c'] = repoB;
    await h.reporter.report(workspace);
    await h.reporter.whenIdle();

    expect(h.requests[0]?.places).toEqual([
      { serviceId: 'svc-a', kind: 'MAIN_FOLDER', branch: 'branch-a' },
      { serviceId: 'svc-b', kind: 'MAIN_FOLDER', branch: 'branch-b' },
      { serviceId: 'svc-c', kind: 'MAIN_FOLDER', branch: 'branch-c' },
    ]);
  });

  it('sends a Service once when two reports start before either finishes capturing', async () => {
    const repo = await makeRepo('main');
    const h = await makeHarness([{ id: 'svc-a', path: repo }]);

    await Promise.all([h.start(workspaceFor(repo)), h.start(workspaceFor(repo))]);
    await h.reporter.whenIdle();

    expect(h.requests).toHaveLength(1);
  });

  it('does not wait on a report the server is holding open, and does not overlap sends', async () => {
    const repo = await makeRepo('main');
    const h = await makeHarness([{ id: 'svc-a', path: repo }]);
    h.behavior.hold = true;

    await h.start(workspaceFor(repo));
    await h.start(workspaceFor(repo));

    expect(h.requests).toHaveLength(1);
  });

  it('gives up on a stalled report at the deadline and retries the Service later', async () => {
    const repo = await makeRepo('main');
    const h = await makeHarness([{ id: 'svc-a', path: repo }], { requestTimeoutMs: 20 });
    h.behavior.hold = true;

    await h.report(workspaceFor(repo));
    expect(h.warnings.map((w) => w.event)).toContain('local.run.service_places.report_failed');

    h.behavior.hold = false;
    await h.report(workspaceFor(repo));

    expect(h.requests).toHaveLength(2);
    expect((await h.runStore.getRun(RUN_ID))?.reportedServicePlaceServiceIds).toEqual(['svc-a']);
  });

  it('acknowledges valid results beside a malformed one and retries only the malformed one', async () => {
    const repoA = await makeRepo('main');
    const repoB = await makeRepo('develop');
    const h = await makeHarness([
      { id: 'svc-a', path: repoA },
      { id: 'svc-b', path: repoB },
    ]);
    h.behavior.rawResults = [
      { serviceId: 'svc-a', outcome: 'RECORDED' },
      { serviceId: 'svc-b', outcome: 'SOMETHING_NEW' },
    ];

    await h.report(workspaceFor(repoA));
    h.behavior.rawResults = undefined;
    await h.report(workspaceFor(repoA));

    expect(h.requests.map((r) => r.places.map((p) => p.serviceId))).toEqual([
      ['svc-a', 'svc-b'],
      ['svc-b'],
    ]);
    const invalid = h.warnings.find((w) => w.event === 'local.run.service_places.result_invalid');
    expect(invalid?.fields).toMatchObject({ serviceId: 'svc-b' });
  });

  it('logs the place that already exists when the server reports a conflict', async () => {
    const repo = await makeRepo('feature/new');
    const h = await makeHarness([{ id: 'svc-a', path: repo }]);
    h.behavior.outcomes['svc-a'] = 'CONFLICT';
    h.behavior.recordedPlaces = [
      { serviceId: 'svc-other', kind: 'MAIN_FOLDER', branch: 'nope', recordedAt: 'x' },
      { serviceId: 'svc-a', kind: 'MAIN_FOLDER', branch: 'feature/old', recordedAt: 'x' },
    ];

    await h.report(workspaceFor(repo));

    const conflict = h.warnings.find((w) => w.event === 'local.run.service_places.conflict');
    expect(conflict?.fields).toMatchObject({
      serviceId: 'svc-a',
      reportedPlace: { kind: 'MAIN_FOLDER', branch: 'feature/new' },
      existingPlace: { kind: 'MAIN_FOLDER', branch: 'feature/old' },
    });
  });
});
