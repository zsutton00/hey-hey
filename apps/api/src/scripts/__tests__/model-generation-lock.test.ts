import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const { LOCK_TOKEN_ENV, acquireModelGenerationLock, withModelGenerationLock } =
  require('../../../scripts/model-generation-lock.js') as {
    LOCK_TOKEN_ENV: string;
    acquireModelGenerationLock(options: Record<string, unknown>): Promise<{
      acquired: boolean;
      lockPath: string;
      token: string;
      release: () => void;
    }>;
    withModelGenerationLock<T>(
      operation: (context: {
        environment: NodeJS.ProcessEnv;
      }) => T | Promise<T>,
      options?: Record<string, unknown>,
    ): Promise<T>;
  };

describe('model-generation-lock', () => {
  let checkout: string;

  beforeEach(() => {
    checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'api-model-generation-'));
  });

  afterEach(() => {
    fs.rmSync(checkout, { recursive: true, force: true });
  });

  it('serializes acquisition and releases only its own lock', async () => {
    let runningChecks = 0;
    const sleep = jest.fn(async () => undefined);
    const output = jest.fn();
    const lockPath = path.join(checkout, '.tmp', 'model-generation.lock');

    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(
      lockPath,
      `${JSON.stringify({ pid: 1234, token: 'active-owner' })}\n`,
    );

    const lock = await acquireModelGenerationLock({
      projectRoot: checkout,
      isRunning: () => runningChecks++ === 0,
      sleep,
      output,
    });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(output).toHaveBeenCalledWith(
      'Waiting for another model generation to finish (PID 1234)...',
    );
    expect(lock.acquired).toBe(true);

    const owner = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as {
      pid: number;
      token: string;
    };
    expect(owner.pid).toBe(process.pid);
    expect(owner.token).toBe(lock.token);

    fs.writeFileSync(
      lockPath,
      `${JSON.stringify({ pid: 5678, token: 'new-owner' })}\n`,
    );
    lock.release();
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it('reclaims a lock whose owner process is no longer running', async () => {
    const lockPath = path.join(checkout, '.tmp', 'model-generation.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(
      lockPath,
      `${JSON.stringify({ pid: 1234, token: 'stale-owner' })}\n`,
    );

    const lock = await acquireModelGenerationLock({
      projectRoot: checkout,
      isRunning: () => false,
      output: jest.fn(),
    });

    expect(lock.acquired).toBe(true);
    lock.release();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('surfaces malformed lock metadata instead of ignoring it', async () => {
    const lockPath = path.join(checkout, '.tmp', 'model-generation.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, '{not-json}\n');

    await expect(
      acquireModelGenerationLock({
        projectRoot: checkout,
        output: jest.fn(),
      }),
    ).rejects.toThrow(`Unable to read model generation lock at ${lockPath}.`);
  });

  it('reuses the parent lock for nested generation commands', async () => {
    let nestedEnvironment: NodeJS.ProcessEnv | undefined;

    await withModelGenerationLock(
      async ({ environment }) => {
        await withModelGenerationLock(
          ({ environment: childEnvironment }) => {
            nestedEnvironment = childEnvironment;
          },
          { projectRoot: checkout, environment },
        );
      },
      { projectRoot: checkout },
    );

    expect(nestedEnvironment?.[LOCK_TOKEN_ENV]).toBeDefined();
    expect(
      fs.existsSync(path.join(checkout, '.tmp', 'model-generation.lock')),
    ).toBe(false);
  });
});
