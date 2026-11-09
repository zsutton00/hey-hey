import { createServer, Socket } from 'node:net';
import { chmod, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { startBoundedApiCpuProfiling } from './api-cpu-profiling';

export const API_CPU_CONTROL_DIRECTORY = '/tmp/heyhey-api-profiler';
export const API_CPU_CONTROL_SOCKET = join(
  API_CPU_CONTROL_DIRECTORY,
  'control.sock',
);

// Private container-local operator control. No HTTP route or debugger listener.
export async function startApiCpuProfileControl(
  emit: (record: Record<string, unknown>) => void,
  directory = API_CPU_CONTROL_DIRECTORY,
  artifactDirectory?: string,
): Promise<() => Promise<void>> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = join(directory, 'control.sock');
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  });
  let active:
    | { token: string; expiresAt: number; stop: () => Promise<void> }
    | undefined;
  let deadline: NodeJS.Timeout | undefined;
  let queue = Promise.resolve();
  let closing = false;
  const connections = new Set<Socket>();
  const stop = async () => {
    clearTimeout(deadline);
    const capture = active;
    active = undefined;
    await capture?.stop();
  };
  const status = () => ({
    active: Boolean(active),
    token: active?.token,
    expiresAt: active?.expiresAt,
  });
  const command = async (line: string) => {
    if (closing) {
      throw new Error('Control is shutting down');
    }
    if (active && Date.now() >= active.expiresAt) {
      await stop();
    }
    if (line === 'status') {
      return status();
    }
    const start = /^start ([a-zA-Z0-9_-]{1,64}) ([0-9]{1,3})$/.exec(line);
    if (start) {
      const token = start[1]!;
      const seconds = Number(start[2]);
      if (seconds < 1 || seconds > 900) {
        throw new Error('Invalid duration');
      }
      if (active) {
        if (active.token !== token) {
          throw new Error('A capture is already active');
        }
        return status(); // Retry never extends the original deadline.
      }
      const finish = await startBoundedApiCpuProfiling(
        emit,
        seconds,
        artifactDirectory,
      );
      active = { token, expiresAt: Date.now() + seconds * 1000, stop: finish };
      deadline = setTimeout(() => {
        queue = queue.then(stop).catch(() => {
          active = undefined;
        });
      }, seconds * 1000);
      deadline.unref();
      return status();
    }
    const end = /^stop ([a-zA-Z0-9_-]{1,64})$/.exec(line);
    if (!end || (active && active.token !== end[1])) {
      throw new Error('Invalid command or capture owner');
    }
    await stop();
    return status();
  };
  const server = createServer((socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(5000, () => socket.destroy());
    socket.setEncoding('utf8');
    let input = '';
    let submitted = false;
    socket.on('data', (chunk: string) => {
      if (submitted) {
        return;
      }
      input += chunk;
      if (Buffer.byteLength(input) > 256) {
        submitted = true;
        socket.end('{"ok":false}\n');
        return;
      }
      if (!input.includes('\n')) {
        return;
      }
      submitted = true;
      queue = queue.then(async () => {
        try {
          const result = await command(input.trim());
          socket.end(JSON.stringify({ ok: true, ...result }) + '\n');
        } catch {
          socket.end('{"ok":false}\n');
        }
      });
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(path, resolve);
    });
    await chmod(path, 0o600);
    server.unref(); // Operator control must not keep a stopped API process alive.
  } catch (error) {
    server.close();
    throw error;
  }
  return async () => {
    closing = true;
    for (const socket of connections) {
      socket.destroy();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await queue;
    await stop(); // net.Server removes its Unix socket when closed.
  };
}
