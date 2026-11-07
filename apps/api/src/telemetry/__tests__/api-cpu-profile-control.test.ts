import { createConnection } from 'node:net';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startApiCpuProfileControl } from '../api-cpu-profile-control';

function command(path: string, line: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let data = '';
    socket.setTimeout(3000, () =>
      socket.destroy(new Error('Control timed out')),
    );
    socket.on('connect', () => socket.write(line + '\n'));
    socket.on('data', (chunk) => {
      data += chunk;
    });
    socket.on('error', reject);
    socket.on('end', () => {
      resolve(JSON.parse(data));
    });
  });
}

it('stays idle, bounds a capture without its caller, and allows later captures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'api-capture-'));
  const directory = join(root, 'control');
  const artifacts = join(root, 'profiles');
  const path = join(directory, 'control.sock');
  const stop = await startApiCpuProfileControl(() => {}, directory, artifacts);
  try {
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect(await command(path, 'status')).toEqual({ ok: true, active: false });
    await expect(readdir(artifacts)).rejects.toMatchObject({ code: 'ENOENT' });
    const started = await command(path, 'start first 1');
    expect(started).toMatchObject({ ok: true, active: true, token: 'first' });
    expect(await command(path, 'start first 900')).toEqual(started);
    expect(await command(path, 'start other 1')).toEqual({ ok: false });
    await delay(1200);
    expect(await command(path, 'status')).toEqual({ ok: true, active: false });
    const files = await readdir(artifacts);
    expect(files).toHaveLength(1);
    const profile = JSON.parse(
      await readFile(join(artifacts, files[0]!), 'utf8'),
    );
    expect(profile.profile.samples.length).toBeGreaterThan(0);
    expect((await stat(join(artifacts, files[0]!))).mode & 0o777).toBe(0o600);
    expect(await command(path, 'start later 30')).toMatchObject({
      ok: true,
      active: true,
    });
    expect(await command(path, 'stop first')).toEqual({ ok: false });
    await delay(25);
    expect(await command(path, 'stop later')).toEqual({
      ok: true,
      active: false,
    });
    expect(await readdir(artifacts)).toHaveLength(2);
    for (const invalid of [
      'start bad 0',
      'start bad 901',
      'start bad 999999',
      'start invalid/token 1',
      'x'.repeat(257),
    ]) {
      expect(await command(path, invalid)).toEqual({ ok: false });
    }
    expect(await command(path, 'status')).toEqual({ ok: true, active: false });
  } finally {
    await stop();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

it('stops an active capture during API shutdown and releases the private socket', async () => {
  const root = await mkdtemp(join(tmpdir(), 'api-capture-shutdown-'));
  const directory = join(root, 'control');
  const artifacts = join(root, 'profiles');
  const path = join(directory, 'control.sock');
  const stop = await startApiCpuProfileControl(() => {}, directory, artifacts);
  try {
    expect(await command(path, 'start shutdown 900')).toMatchObject({
      ok: true,
      active: true,
    });
    await delay(25);
    await stop();
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(artifacts)).toHaveLength(1);
  } finally {
    await stop();
    await rm(root, { recursive: true, force: true });
  }
});
