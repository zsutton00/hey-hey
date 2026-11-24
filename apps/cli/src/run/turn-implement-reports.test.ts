import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalPromptType } from '@hey-hey/contracts/agent-bridge';
import type { ImplementReportPayload } from '@hey-hey/contracts/api/models';
import { ExecutionRecorder } from '../agents/providers/execution-recorder/execution-recorder';
import { CreateReportTool } from '../agents/submission-tools/create-report-tool';
import { makeCreateReportProxy } from '../agents/submission-tools/create-report-proxy.test-support';
import { NOOP_LOGGER } from '../server/logger';
import { TurnChangeRecord, type HeldImplementReport } from '../turn/turn-change-record';
import type { Turn } from '../turn/turn';
import { captureFileChangeEvidence, type CanonicalFileChangeFact } from './file-change-facts';
import type { Run } from './run';
import { createTestRun } from './run.test-support';
import { emitTurnImplementReports } from './turn-implement-reports';

const repos: string[] = [];

afterEach(() => {
  for (const repo of repos.splice(0)) {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

const git = (repo: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

const makeRepo = (files: Record<string, string>): string => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'turn-implement-')));
  repos.push(repo);
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), content);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'initial');
  return repo;
};

const lines = (...values: string[]): string => `${values.join('\n')}\n`;

interface Harness {
  run: Run;
  tool: CreateReportTool;
  create: ReturnType<typeof vi.fn>;
  facts: CanonicalFileChangeFact[];
  repos: Record<string, string>;
}

const makeHarness = (services: Record<string, string>): Harness => {
  const run = createTestRun({ runId: 'run-1' });
  Object.assign(run.session, {
    entity: { entityType: 'TASK', entityId: 'task-1' },
    agentic_session_id: 'session-1',
    promptType: LocalPromptType.Implement,
    services: Object.entries(services).map(([id, repo]) => ({ id, path: repo })),
    worktreeState: null,
  });
  const proxy = makeCreateReportProxy();
  vi.mocked(proxy.create).mockImplementation(async () => {
    const reportId = randomUUID();
    return { reportId, content: [{ type: 'text', text: reportId }] };
  });
  return {
    run,
    tool: new CreateReportTool(proxy),
    create: vi.mocked(proxy.create),
    facts: [],
    repos: services,
  };
};

const makeTurn = (
  promptType: string,
  options: { turnId?: string; requiresChangedFileReporting?: boolean } = {},
): Turn => {
  const turnId = options.turnId ?? 'turn-1';
  return {
    turnId,
    handler: {
      promptType,
      requiresChangedFileReporting: options.requiresChangedFileReporting ?? true,
    },
    changeRecord: new TurnChangeRecord(turnId, NOOP_LOGGER),
  } as unknown as Turn;
};

/** Edits a file on disk and records the canonical fact the Run would persist for it. */
const edit = async (
  harness: Harness,
  turn: Turn,
  serviceId: string,
  file: string,
  content: string | null,
  attributionSource: CanonicalFileChangeFact['attributionSource'] = 'provider_event',
): Promise<void> => {
  const repositoryRoot = harness.repos[serviceId]!;
  const absolutePath = path.join(repositoryRoot, file);
  if (content === null) {
    fs.rmSync(absolutePath);
  } else {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  }
  const capture = await captureFileChangeEvidence(
    { serviceId, repositoryRoot, absolutePath, repoRelativePath: file },
    null,
  );
  harness.facts.push({
    attributionSource,
    executionRoot: repositoryRoot,
    factId: randomUUID(),
    runId: 'run-1',
    turnId: turn.turnId,
    provider: 'claude',
    providerSessionId: 'provider-session-1',
    providerThreadId: null,
    providerTurnId: null,
    serviceId,
    repoRelativePath: file,
    occurredAt: new Date(Date.now() + harness.facts.length).toISOString(),
    evidence: capture.evidence,
    place: capture.place,
  });
};

const emit = (harness: Harness, turn: Turn, capturedVersions: ExecutionRecorder | null = null) =>
  emitTurnImplementReports({
    run: harness.run,
    turn,
    logger: NOOP_LOGGER,
    facts: harness.facts,
    capturedVersions,
    reportsSinceTurnStart: harness.run.readReportChain(),
    createReportTool: harness.tool,
  });

const persistedReports = (harness: Harness) =>
  harness.create.mock.calls.map(([request]) => {
    const args = request.args as {
      payload: ImplementReportPayload;
      entities: Array<{ entityType: string; entityId: string }>;
    };
    return {
      payload: args.payload,
      entities: args.entities,
      serviceId: args.entities.find((entity) => entity.entityType === 'SERVICE')!.entityId,
    };
  });

const HELD: HeldImplementReport = {
  summary: 'Agent handoff summary for the next phase.',
  decisions: [
    { topic: 'Located in A', choice: 'a', location: { file: 'src/a.ts', startLine: 2 } },
    { topic: 'Cross-cutting', choice: 'everywhere' },
    { topic: 'Unedited file', choice: 'kept', location: { file: 'src/never.ts' } },
  ],
};

describe('emitTurnImplementReports edit places', () => {
  it('records the branch and worktree active when each edit was made', async () => {
    const mainRepo = makeRepo({ 'src/a.ts': lines('one', 'two') });
    git(mainRepo, 'branch', '-M', 'main');
    const worktree = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'turn-worktree-')));
    repos.push(worktree);
    fs.rmSync(worktree, { recursive: true });
    git(mainRepo, 'worktree', 'add', '-q', '-b', 'feature/change-place', worktree);
    const harness = makeHarness({ 'svc-a': mainRepo, 'svc-w': worktree });
    const turn = makeTurn(LocalPromptType.FreeForm);

    await edit(harness, turn, 'svc-a', 'src/a.ts', lines('one', 'TWO'));
    git(mainRepo, 'checkout', '-q', '-b', 'other');
    await edit(harness, turn, 'svc-a', 'src/b.ts', lines('new'));
    git(mainRepo, 'checkout', '-q', '--detach');
    await edit(harness, turn, 'svc-a', 'src/c.ts', lines('detached'));
    await edit(harness, turn, 'svc-w', 'src/a.ts', lines('in worktree'));
    await emit(harness, turn);

    const [mainReport, worktreeReport] = persistedReports(harness).map((report) => report.payload);
    expect(mainReport!.edits!.map((e) => e.place)).toEqual([
      { kind: 'MAIN_FOLDER', branch: 'main' },
      { kind: 'MAIN_FOLDER', branch: 'other' },
      { kind: 'MAIN_FOLDER', branch: null },
    ]);
    expect(worktreeReport!.edits!.map((e) => e.place)).toEqual([
      { kind: 'WORKTREE', branch: 'feature/change-place', worktreePath: worktree },
    ]);
  });

  it('still records an edit, without a place, when git cannot be read', async () => {
    const repo = makeRepo({ 'src/a.ts': lines('one') });
    const harness = makeHarness({ 'svc-a': repo });
    const turn = makeTurn(LocalPromptType.FreeForm);
    await edit(harness, turn, 'svc-a', 'src/a.ts', lines('two'));
    delete harness.facts[0]!.place;

    const plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'turn-plain-')));
    repos.push(plain);
    fs.writeFileSync(path.join(plain, 'x.txt'), 'x');
    const capture = await captureFileChangeEvidence(
      {
        serviceId: 'svc-x',
        repositoryRoot: plain,
        absolutePath: path.join(plain, 'x.txt'),
        repoRelativePath: 'x.txt',
      },
      null,
    );
    expect(capture.place).toBeUndefined();
    expect(capture.placeError).toBeDefined();

    await emit(harness, turn);

    const [report] = persistedReports(harness);
    expect(report!.payload.edits).toHaveLength(1);
    expect(report!.payload.edits![0]).not.toHaveProperty('place');
  });
});

describe('emitTurnImplementReports', () => {
  it.each([
    { promptType: LocalPromptType.Implement, held: HELD },
    { promptType: LocalPromptType.FreeForm, held: null },
  ])(
    'writes exactly one report per changed Service for a $promptType turn',
    async ({ promptType, held }) => {
      const harness = makeHarness({
        'svc-a': makeRepo({ 'src/a.ts': lines('one', 'two', 'three') }),
        'svc-b': makeRepo({ 'src/b.ts': lines('alpha') }),
      });
      const turn = makeTurn(promptType);
      if (held) {
        turn.changeRecord.hold(held);
      }

      await edit(harness, turn, 'svc-a', 'src/a.ts', lines('one', 'TWO', 'three'));
      await edit(harness, turn, 'svc-b', 'src/b.ts', lines('alpha', 'beta'));
      await edit(harness, turn, 'svc-b', 'src/new.ts', lines('created'));

      const result = await emit(harness, turn);

      expect(result.status).toBe('emitted');
      const reports = persistedReports(harness);
      expect(reports.map((report) => report.serviceId)).toEqual(['svc-a', 'svc-b']);
      for (const report of reports) {
        expect(report.entities).toEqual([
          { entityType: 'TASK', entityId: 'task-1', relation: 'PRIMARY' },
          { entityType: 'AGENT_SESSION', entityId: 'session-1', relation: 'CONTEXT' },
          { entityType: 'SERVICE', entityId: report.serviceId, relation: 'CONTEXT' },
        ]);
      }

      const [a, b] = reports.map((report) => report.payload);
      expect(a!.filesChanged).toEqual(['src/a.ts']);
      expect(b!.filesChanged).toEqual(['src/b.ts', 'src/new.ts']);
      expect(a!.edits).toEqual([
        {
          path: 'src/a.ts',
          occurredAt: expect.any(String),
          turnId: 'turn-1',
          beforeObjectId: git(harness.repos['svc-a']!, 'rev-parse', 'HEAD:src/a.ts').trim(),
          afterObjectId: expect.stringMatching(/^[0-9a-f]{40}$/u),
          beforeRanges: [{ startLine: 2, endLine: 2 }],
          afterRanges: [{ startLine: 2, endLine: 2 }],
          approximate: true,
          versionsRecorded: true,
        },
      ]);
      expect(b!.edits?.find((entry) => entry.path === 'src/new.ts')).toMatchObject({
        versionsRecorded: true,
        beforeObjectId: null,
        beforeRanges: [],
        afterRanges: [{ startLine: 1, endLine: 1 }],
      });

      // No file content leaves the machine.
      const serialized = JSON.stringify(reports.map((report) => report.payload));
      expect(serialized).not.toContain('TWO');
      expect(serialized).not.toContain('beta');
      expect(serialized).not.toContain('created');

      if (held) {
        expect(a!.summary).toBe(held.summary);
        expect(b!.summary).toBe(held.summary);
        expect(a!.decisions).toEqual([
          held.decisions[0],
          held.decisions[1],
          { topic: 'Unedited file', choice: 'kept' },
        ]);
        expect(b!.decisions).toEqual([
          held.decisions[1],
          { topic: 'Unedited file', choice: 'kept' },
        ]);
      } else {
        expect(a!.summary).toContain('Open completed the requested work');
        expect(a!.decisions).toEqual([]);
      }
    },
  );

  it('writes no report when the Turn recorded no file changes, even with an agent summary', async () => {
    const harness = makeHarness({ 'svc-a': makeRepo({ 'src/a.ts': lines('one') }) });
    const turn = makeTurn(LocalPromptType.Implement);
    turn.changeRecord.hold(HELD);

    expect(await emit(harness, turn)).toEqual({ status: 'skipped', reason: 'no-files-changed' });
    expect(harness.create).not.toHaveBeenCalled();
  });

  it('writes no report for a Turn that does not report changed files', async () => {
    const harness = makeHarness({ 'svc-a': makeRepo({ 'src/a.ts': lines('one') }) });
    const turn = makeTurn(LocalPromptType.Commit, {
      requiresChangedFileReporting: false,
    });
    await edit(harness, turn, 'svc-a', 'src/a.ts', lines('two'));

    expect(await emit(harness, turn)).toEqual({ status: 'skipped', reason: 'not-coding-turn' });
    expect(harness.create).not.toHaveBeenCalled();
  });

  it('chains edits to one file by version and covers only each edit’s own lines', async () => {
    const harness = makeHarness({
      'svc-a': makeRepo({ 'src/a.ts': lines('1', '2', '3', '4', '5'), 'gen/api.ts': lines('x') }),
    });
    const turn = makeTurn(LocalPromptType.Implement);

    await edit(harness, turn, 'svc-a', 'src/a.ts', lines('ONE', '2', '3', '4', '5'));
    await edit(harness, turn, 'svc-a', 'src/a.ts', lines('ONE', '2', '3', '4', 'FIVE'));
    // A shell or codegen edit known only from the changed-files report.
    await edit(harness, turn, 'svc-a', 'gen/api.ts', lines('y'.repeat(50_000)), 'agent_report');

    await emit(harness, turn);

    const [report] = persistedReports(harness);
    const [first, second, reported] = report!.payload.edits!;
    expect(second!.beforeObjectId).toBe(first!.afterObjectId);
    expect(first!.afterRanges).toEqual([{ startLine: 1, endLine: 1 }]);
    expect(second!.beforeRanges).toEqual([{ startLine: 5, endLine: 5 }]);
    expect(second!.afterRanges).toEqual([{ startLine: 5, endLine: 5 }]);
    expect(reported).toMatchObject({ path: 'gen/api.ts' });
    expect(report!.payload.filesChanged).toEqual(['gen/api.ts', 'src/a.ts']);
    expect(JSON.stringify(report!.payload).length).toBeLessThan(5_000);
  });

  it('marks an edit approximate when another change to the file landed before it', async () => {
    const repo = makeRepo({ 'src/a.ts': lines('1', '2', '3') });
    const harness = makeHarness({ 'svc-a': repo });
    const turn = makeTurn(LocalPromptType.Quick);

    await edit(harness, turn, 'svc-a', 'src/a.ts', lines('ONE', '2', '3'));
    // Another session or the person's editor changes the file between our edits.
    fs.writeFileSync(path.join(repo, 'src/a.ts'), lines('ONE', 'theirs', '3'));
    await edit(harness, turn, 'svc-a', 'src/a.ts', lines('ONE', 'theirs', 'THREE'));
    await emit(harness, turn);

    const [report] = persistedReports(harness);
    const [, later] = report!.payload.edits!;
    // The CLI cannot tell their line 2 from our line 3, so it must not claim exact ownership.
    expect(later).toMatchObject({
      approximate: true,
      afterRanges: [{ startLine: 2, endLine: 3 }],
    });
    expect(report!.payload.edits!.every((entry) => entry.approximate)).toBe(true);
    expect(report!.payload.summary).toContain('Task Only completed the requested work');
  });

  it('still writes the other Services’ reports when one Service’s report fails to save', async () => {
    const harness = makeHarness({
      'svc-a': makeRepo({ 'a.ts': lines('a') }),
      'svc-b': makeRepo({ 'b.ts': lines('b') }),
    });
    harness.create.mockRejectedValueOnce(new Error('platform unavailable'));
    const turn = makeTurn(LocalPromptType.Implement);
    await edit(harness, turn, 'svc-a', 'a.ts', lines('A'));
    await edit(harness, turn, 'svc-b', 'b.ts', lines('B'));

    const result = await emit(harness, turn);

    expect(result).toMatchObject({ status: 'emitted', failedServiceIds: ['svc-a'] });
    expect(harness.run.readReportChain().map((entry) => entry.serviceId)).toEqual(['svc-b']);
  });

  it('tells an edit whose versions could not be kept apart from a created file', async () => {
    const harness = makeHarness({ 'svc-a': makeRepo({ 'image.bin': 'old\u0000bytes' }) });
    const turn = makeTurn(LocalPromptType.Implement);
    await edit(harness, turn, 'svc-a', 'image.bin', 'new\u0000bytes');
    await edit(harness, turn, 'svc-a', 'created.ts', lines('new file'));

    await emit(harness, turn);

    const [report] = persistedReports(harness);
    expect(report!.payload.filesChanged).toEqual(['created.ts', 'image.bin']);
    expect(report!.payload.edits!.find((entry) => entry.path === 'image.bin')).toMatchObject({
      versionsRecorded: false,
      beforeObjectId: null,
      afterObjectId: null,
      beforeRanges: [],
      afterRanges: [],
      approximate: true,
    });
    expect(report!.payload.edits!.find((entry) => entry.path === 'created.ts')).toMatchObject({
      versionsRecorded: true,
      beforeObjectId: null,
      afterObjectId: expect.stringMatching(/^[0-9a-f]{40}$/u),
    });
  });

  it('keeps both versions readable after git gc', async () => {
    const harness = makeHarness({ 'svc-a': makeRepo({ 'src/a.ts': lines('before') }) });
    const turn = makeTurn(LocalPromptType.Implement);
    await edit(harness, turn, 'svc-a', 'src/a.ts', lines('after'));

    await emit(harness, turn);

    const repo = harness.repos['svc-a']!;
    const [edited] = persistedReports(harness)[0]!.payload.edits!;
    git(repo, 'checkout', '-q', '--', 'src/a.ts');
    git(repo, 'gc', '-q', '--prune=now');
    expect(git(repo, 'cat-file', '-p', edited!.beforeObjectId!)).toBe(lines('before'));
    expect(git(repo, 'cat-file', '-p', edited!.afterObjectId!)).toBe(lines('after'));
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('keeps same-named files in separate Services and does not write a second report when turn completion runs again', async () => {
    const harness = makeHarness({
      'svc-a': makeRepo({ 'src/shared.ts': lines('a') }),
      'svc-b': makeRepo({ 'src/shared.ts': lines('b') }),
    });
    const turn = makeTurn(LocalPromptType.Implement);
    await edit(harness, turn, 'svc-a', 'src/shared.ts', lines('A'));
    await edit(harness, turn, 'svc-b', 'src/shared.ts', lines('B'));

    await emit(harness, turn);
    const repeated = await emit(harness, turn);

    expect(repeated).toEqual({ status: 'skipped', reason: 'already-emitted' });
    expect(harness.create).toHaveBeenCalledTimes(2);
    expect(persistedReports(harness).map((report) => report.payload.filesChanged)).toEqual([
      ['src/shared.ts'],
      ['src/shared.ts'],
    ]);
    expect(harness.run.readReportChain().map((entry) => entry.serviceId)).toEqual([
      'svc-a',
      'svc-b',
    ]);
  });

  describe('with hook-captured versions (precise file change tracking on)', () => {
    let toolSeq = 0;

    /** Plays what the provider hooks do around a tool: a before read, the tool's change, an after read. */
    const hooked = async (
      harness: Harness,
      recorder: ExecutionRecorder,
      turn: Turn,
      tool: { name: string; paths?: string[] },
      act: () => Promise<void>,
    ): Promise<void> => {
      toolSeq += 1;
      const identity = {
        sessionId: 'session-1',
        runId: 'run-1',
        turnId: turn.turnId,
        provider: 'claude' as const,
        providerSessionId: 'provider-session-1',
        providerTurnId: null,
        toolCallId: `tool-${toolSeq}`,
        toolName: tool.name,
      };
      const roots = Object.entries(harness.repos).map(([serviceId, root]) => ({
        serviceId,
        root,
        ...(tool.paths ? { paths: tool.paths } : {}),
      }));
      await recorder.begin(identity, roots, 'test');
      await act();
      await recorder.finish(identity, roots, 'test', 'success', tool.name !== 'Bash');
    };

    const makeRecorder = (): ExecutionRecorder => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-implement-evidence-'));
      repos.push(directory);
      return new ExecutionRecorder(directory, NOOP_LOGGER);
    };

    it('marks an edit exact when nobody else touched the file, with ranges covering only that edit', async () => {
      const harness = makeHarness({ 'svc-a': makeRepo({ 'src/a.ts': lines('1', '2', '3') }) });
      const recorder = makeRecorder();
      const turn = makeTurn(LocalPromptType.Implement);

      await hooked(harness, recorder, turn, { name: 'Edit', paths: ['src/a.ts'] }, () =>
        edit(harness, turn, 'svc-a', 'src/a.ts', lines('ONE', '2', '3')),
      );
      await hooked(harness, recorder, turn, { name: 'Edit', paths: ['src/a.ts'] }, () =>
        edit(harness, turn, 'svc-a', 'src/a.ts', lines('ONE', '2', 'THREE')),
      );
      await emit(harness, turn, recorder);

      const [report] = persistedReports(harness);
      const [first, second] = report!.payload.edits!;
      expect(first).toMatchObject({
        approximate: false,
        afterRanges: [{ startLine: 1, endLine: 1 }],
      });
      expect(second).toMatchObject({
        approximate: false,
        beforeObjectId: first!.afterObjectId,
        afterRanges: [{ startLine: 3, endLine: 3 }],
      });
    });

    it('marks the later edit approximate when someone else changed the file between two edits', async () => {
      const repo = makeRepo({ 'src/a.ts': lines('1', '2', '3') });
      const harness = makeHarness({ 'svc-a': repo });
      const recorder = makeRecorder();
      const turn = makeTurn(LocalPromptType.Implement);

      await hooked(harness, recorder, turn, { name: 'Edit', paths: ['src/a.ts'] }, () =>
        edit(harness, turn, 'svc-a', 'src/a.ts', lines('ONE', '2', '3')),
      );
      fs.writeFileSync(path.join(repo, 'src/a.ts'), lines('ONE', 'theirs', '3'));
      await hooked(harness, recorder, turn, { name: 'Edit', paths: ['src/a.ts'] }, () =>
        edit(harness, turn, 'svc-a', 'src/a.ts', lines('ONE', 'theirs', 'THREE')),
      );
      await emit(harness, turn, recorder);

      const [first, later] = persistedReports(harness)[0]!.payload.edits!;
      expect(first!.approximate).toBe(false);
      expect(later!.approximate).toBe(true);
      // Their line 2 is in the captured before-version, so the ranges cover only our line 3.
      expect(later!.afterRanges).toEqual([{ startLine: 3, endLine: 3 }]);
      expect(later!.beforeObjectId).not.toBe(first!.afterObjectId);
    });

    it('marks a first edit approximate when the file already differed from HEAD', async () => {
      const repo = makeRepo({ 'src/a.ts': lines('1', '2', '3') });
      fs.writeFileSync(path.join(repo, 'src/a.ts'), lines('1', 'dirty', '3'));
      const harness = makeHarness({ 'svc-a': repo });
      const recorder = makeRecorder();
      const turn = makeTurn(LocalPromptType.Implement);

      await hooked(harness, recorder, turn, { name: 'Edit', paths: ['src/a.ts'] }, () =>
        edit(harness, turn, 'svc-a', 'src/a.ts', lines('1', 'dirty', 'THREE')),
      );
      await emit(harness, turn, recorder);

      const [recorded] = persistedReports(harness)[0]!.payload.edits!;
      expect(recorded!.approximate).toBe(true);
      // The person's uncommitted line 2 is part of the real before-version, not of this edit.
      expect(recorded!.afterRanges).toEqual([{ startLine: 3, endLine: 3 }]);
    });

    it('records a shell command’s real before and after versions and skips git-ignored files', async () => {
      const harness = makeHarness({
        'svc-a': makeRepo({ '.gitignore': 'cache/\n', 'gen/api.ts': lines('x') }),
      });
      const recorder = makeRecorder();
      const turn = makeTurn(LocalPromptType.Implement);
      const root = harness.repos['svc-a']!;
      fs.mkdirSync(path.join(root, 'cache'));

      await hooked(harness, recorder, turn, { name: 'Bash' }, async () => {
        fs.writeFileSync(path.join(root, 'cache/big.bin'), 'ignored');
        await edit(harness, turn, 'svc-a', 'gen/api.ts', lines('y'), 'agent_report');
      });
      await emit(harness, turn, recorder);

      expect(persistedReports(harness)[0]!.payload.edits).toEqual([
        expect.objectContaining({ path: 'gen/api.ts', approximate: false, versionsRecorded: true }),
      ]);
      expect(recorder.capturedFileChanges('run-1', turn.turnId, 'svc-a', 'cache/big.bin')).toEqual(
        [],
      );
    });

    it('leaves the edit approximate when a hook never ran', async () => {
      const harness = makeHarness({ 'svc-a': makeRepo({ 'src/a.ts': lines('1') }) });
      const turn = makeTurn(LocalPromptType.Implement);

      await edit(harness, turn, 'svc-a', 'src/a.ts', lines('2'));
      await emit(harness, turn, makeRecorder());

      expect(persistedReports(harness)[0]!.payload.edits![0]!.approximate).toBe(true);
    });
  });
});
