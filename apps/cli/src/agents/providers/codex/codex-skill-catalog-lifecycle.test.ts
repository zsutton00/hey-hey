import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { CodexSkillCatalogReader } from './codex-skill-catalog';

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}));

class CatalogProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly requests: string[] = [];
  readonly stdin = new Writable({
    write: (chunk, _encoding, done) => {
      const request = JSON.parse(String(chunk));
      this.requests.push(request.method);
      if (this.failWrite) return done(new Error('write failed'));
      if (request.method === 'initialize') this.reply(request.id, {});
      if (request.method === 'skills/list') {
        if (this.malformed) this.stdout.write('invalid JSON\n');
        else if (!this.silent) this.reply(request.id, { data: [] });
      }
      done();
    },
    final: (done) => {
      done();
      if (!this.ignoreShutdown) queueMicrotask(() => this.emit('close', 0, null));
    },
  });
  silent = false;
  malformed = false;
  failWrite = false;
  ignoreShutdown = false;
  readonly kill = vi.fn(() => {
    queueMicrotask(() => this.emit('close', null, 'SIGKILL'));
    return true;
  });

  private reply(id: number, result: object): void {
    this.stdout.write(`${JSON.stringify({ id, result })}\n`);
  }
}

const useProcess = (child: CatalogProcess): void => {
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
};

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('catalog read lifecycle', () => {
  it('coalesces matching reads, serializes other directories, and refreshes after completion', async () => {
    const first = new CatalogProcess();
    const second = new CatalogProcess();
    const third = new CatalogProcess();
    useProcess(first);
    useProcess(second);
    useProcess(third);
    const reader = new CodexSkillCatalogReader();
    const a = reader.listSkills('/a');
    expect(reader.listSkills('/a')).toBe(a);
    const b = reader.listSkills('/b');
    await Promise.all([a, b]);
    expect(first.stdin.destroyed).toBe(true);
    expect(second.requests).toEqual(['initialize', 'initialized', 'skills/list']);
    await reader.listSkills('/a');
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(vi.mocked(spawn).mock.calls.map((call) => call[2]?.cwd)).toEqual(['/a', '/b', '/a']);
  });

  it.each(['malformed', 'failWrite'] as const)('releases a %s failure for retry', async (mode) => {
    const broken = new CatalogProcess();
    broken[mode] = true;
    useProcess(broken);
    useProcess(new CatalogProcess());
    const reader = new CodexSkillCatalogReader();
    await expect(reader.listSkills('/a')).rejects.toThrow();
    await expect(reader.listSkills('/a')).resolves.toEqual({ data: [] });
    expect(broken.stdout.destroyed).toBe(true);
  });

  it('recovers from a synchronous spawn failure', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    useProcess(new CatalogProcess());
    const reader = new CodexSkillCatalogReader();
    await expect(reader.listSkills('/a')).rejects.toThrow('spawn failed');
    await expect(reader.listSkills('/a')).resolves.toEqual({ data: [] });
  });

  it('bounds requests and shutdown, and ignores events from the old child', async () => {
    vi.useFakeTimers();
    const old = new CatalogProcess();
    old.silent = true;
    old.ignoreShutdown = true;
    useProcess(old);
    const next = new CatalogProcess();
    useProcess(next);
    const reader = new CodexSkillCatalogReader(20);
    const failed = expect(reader.listSkills('/a')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(1_100);
    await failed;
    expect(old.kill).toHaveBeenCalledWith('SIGKILL');
    const retry = reader.listSkills('/a');
    old.emit('error', new Error('late failure'));
    old.emit('close', 1, null);
    await expect(retry).resolves.toEqual({ data: [] });
    expect(vi.getTimerCount()).toBe(0);
  });
});
