import { Configuration } from '@hey-hey/contracts/agent-bridge/configuration';
import { createAgentBridgeRuntimeValidator } from '../shared/agent-bridge-contract/runtime-schema-validator';
import { localLifecycleRuntimeSchema } from '@hey-hey/contracts/agent-bridge/local-lifecycle-runtime-schema';
import { StructuredServerLogger } from '../server/logger';
import { createServer, type Server } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod/v4';
import { LocalLifecycleApi, type LocalLifecycleWork } from '@hey-hey/contracts/agent-bridge';
import type { LocalAgentServerRuntime } from '../server/local-agent-server-runtime';
import { InstallationStore } from './installation-store';

const validateWork = createAgentBridgeRuntimeValidator<LocalLifecycleWork>(
  'LocalLifecycleWork',
  localLifecycleRuntimeSchema,
);
function readWork(value: unknown): LocalLifecycleWork {
  if (!validateWork(value)) {
    throw new Error('Local lifecycle work is invalid. Keep running and retry.');
  }
  return value;
}
const ownerSchema = z.strictObject({
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65535),
});
type Owner = z.infer<typeof ownerSchema>;
export type DisclosedOwner = { file: string; owner: Owner; work: LocalLifecycleWork };

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return false;
    }
    throw error;
  }
}

/** Serializes bridge registration, update and shutdown across terminals. Never steals a live lock. */
export class LocalLifecycleOwners {
  private readonly logger = new StructuredServerLogger({}, { component: 'local-lifecycle' });
  constructor(readonly storage: InstallationStore) {}

  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.storage.directory, { recursive: true, mode: 0o700 });
    const path = join(this.storage.directory, 'lifecycle.lock');
    let handle;
    try {
      handle = await open(path, 'wx', 0o600);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
        throw error;
      }
      const pid = z
        .number()
        .int()
        .positive()
        .parse(JSON.parse(await readFile(path, 'utf8')));
      if (alive(pid)) {
        throw new Error(
          'Another terminal is changing the local application. Retry when it finishes.',
        );
      }
      throw new Error(
        `A previous terminal ended during a local lifecycle operation. Remove only ${path}, then retry. Your application data is preserved.`,
      );
    }
    try {
      await handle.writeFile(JSON.stringify(process.pid));
      return await operation();
    } finally {
      await handle.close();
      await unlink(path);
    }
  }

  private get directory(): string {
    return join(this.storage.directory, 'bridges');
  }

  async inspect(): Promise<DisclosedOwner[]> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const result: DisclosedOwner[] = [];
    for (const name of await readdir(this.directory)) {
      const file = join(this.directory, name);
      const owner = ownerSchema.parse(JSON.parse(await readFile(file, 'utf8')));
      if (!alive(owner.pid)) {
        await unlink(file);
        continue;
      }
      const response = await this.client(owner).inspectLocalWork(
        { xHeyHeyLocalSecret: (await this.storage.secrets()).admin },
        { timeout: 120_000, proxy: false, validateStatus: () => true },
      );
      if (response.status !== 200) {
        throw new Error('A terminal owner could not report active work. Keep running and retry.');
      }
      result.push({ file, owner, work: readWork(response.data) });
    }
    this.logger.debug('local.lifecycle.work.inspected', {
      ownerCount: result.length,
      activeCount: result.reduce((sum, item) => sum + item.work.runIds.length, 0),
    });
    return result;
  }

  private client(owner: Owner): LocalLifecycleApi {
    return new LocalLifecycleApi(new Configuration({ basePath: `http://127.0.0.1:${owner.port}` }));
  }

  async stop(disclosed: DisclosedOwner[]): Promise<boolean> {
    this.logger.debug('local.lifecycle.stop.rechecking', { disclosedOwners: disclosed.length });
    const current = await this.inspect();
    // Recheck every owner before interrupting any of them.
    if (
      current.some((item) =>
        item.work.runIds.some(
          (id) => !disclosed.find((old) => old.file === item.file)?.work.runIds.includes(id),
        ),
      )
    ) {
      return false;
    }
    for (const item of current) {
      const response = await this.client(item.owner).stopLocalBridge(
        { xHeyHeyLocalSecret: (await this.storage.secrets()).admin, localLifecycleWork: item.work },
        { timeout: 120_000, proxy: false, validateStatus: () => true },
      );
      if (response.status === 409) {
        return false;
      }
      if (response.status !== 204) {
        throw new Error(
          'A session owner could not finish shutdown. Containers remain running; retry.',
        );
      }
    }
    return (await this.inspect()).length === 0;
  }

  async register(
    runtime: LocalAgentServerRuntime,
    onStopping?: () => void,
  ): Promise<LocalBridgeLifecycle> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const bridge = new LocalBridgeLifecycle(
      this.storage,
      runtime,
      join(this.directory, `${randomUUID()}.json`),
      onStopping,
    );
    try {
      await bridge.start();
      this.logger.debug('local.lifecycle.bridge.registered');
      return bridge;
    } catch (error) {
      await bridge.close();
      throw error;
    }
  }
}

/** Separate loopback listener keeps lifecycle authority out of browser-facing bridge routes. */
export class LocalBridgeLifecycle {
  private readonly logger = new StructuredServerLogger({}, { component: 'local-lifecycle' });
  private server: Server | undefined;
  private pendingWork: string[] = [];
  constructor(
    private readonly storage: InstallationStore,
    private readonly runtime: LocalAgentServerRuntime,
    private readonly file: string,
    private readonly onStopping: () => void = () => undefined,
  ) {}

  async start(): Promise<void> {
    const secret = Buffer.from((await this.storage.secrets()).admin);
    const server = createServer(async (request, response) => {
      try {
        const value = request.headers['x-heyhey-local-secret'];
        const supplied = Buffer.from(typeof value === 'string' ? value : '');
        if (
          request.headers.origin ||
          supplied.length !== secret.length ||
          !timingSafeEqual(supplied, secret)
        ) {
          response.writeHead(403).end();
          return;
        }
        const active = () => this.activeRunIds();
        if (request.url === '/local-lifecycle/work' && request.method === 'GET') {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ runIds: active() } satisfies LocalLifecycleWork));
          return;
        }
        if (request.url !== '/local-lifecycle/stop' || request.method !== 'POST') {
          response.writeHead(404).end();
          return;
        }
        let body = '';
        for await (const chunk of request) {
          body += String(chunk);
          if (body.length > 65536) {
            response.writeHead(413).end();
            return;
          }
        }
        const disclosed = readWork(JSON.parse(body));
        if (active().some((id) => !disclosed.runIds.includes(id))) {
          response.writeHead(409).end();
          return;
        }
        this.onStopping();
        await this.stop();
        response.writeHead(204).end();
      } catch (error) {
        this.logger.error('local.lifecycle.stop.failed', { error });
        response.writeHead(503).end();
      }
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Lifecycle listener has no port.');
    }
    await writeFile(
      this.file,
      JSON.stringify({ pid: process.pid, port: address.port } satisfies Owner),
      { mode: 0o600, flag: 'wx' },
    );
  }

  private activeRunIds(): string[] {
    return [
      ...new Set([
        ...this.pendingWork,
        ...this.runtime.presentationSources.sessions.activeRunIds(),
      ]),
    ];
  }

  async stop(): Promise<void> {
    this.pendingWork = this.activeRunIds();
    await this.runtime.close();
    await this.close();
  }

  async close(): Promise<void> {
    this.server?.close();
    await unlink(this.file).catch((error) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });
  }
}
