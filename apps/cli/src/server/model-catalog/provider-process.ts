import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

/** The provider's executable does not exist on this machine, so it is not a provider here. */
export class ProviderNotInstalledError extends Error {
  public constructor(
    public readonly provider: string,
    public readonly command: string,
  ) {
    super(`${provider} is not installed: \`${command}\` was not found.`);
    this.name = 'ProviderNotInstalledError';
  }
}

export const isMissingExecutable = (error: unknown): boolean =>
  error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';

interface PendingExpectation {
  readonly accept: (message: unknown) => boolean;
  readonly resolve: (message: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * A short-lived provider process that speaks one JSON object per line on
 * stdin/stdout. Used to ask a provider what it offers and then stop it.
 */
export class JsonLineProcess {
  private readonly child: ChildProcess;
  private readonly pending = new Set<PendingExpectation>();
  private stderrTail = '';
  private failure: Error | null = null;

  public constructor(
    private readonly provider: string,
    command: string,
    args: readonly string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ) {
    this.child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString('utf8')).slice(-500);
    });
    // A broken stdin only follows the process dying; `error` and `close` report why.
    this.child.stdin?.on('error', () => undefined);
    this.child.on('error', (error) =>
      this.fail(
        isMissingExecutable(error) ? new ProviderNotInstalledError(provider, command) : error,
      ),
    );
    this.child.on('close', (code, signal) =>
      this.fail(
        new Error(
          `${provider} exited before reporting its models (code=${String(code)}, signal=${String(signal)}).${
            this.stderrTail ? ` stderr: ${this.stderrTail}` : ''
          }`,
        ),
      ),
    );
    if (!this.child.stdout) {
      throw new Error(`${provider} stdout is unavailable.`);
    }
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) =>
      this.handleLine(line),
    );
  }

  public send(message: unknown): void {
    if (this.failure) throw this.failure;
    this.child.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  /** Resolves with the first message `accept` returns true for. */
  public expect(
    description: string,
    accept: (message: unknown) => boolean,
    timeoutMs: number,
  ): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const expectation: PendingExpectation = {
        accept,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.pending.delete(expectation);
          reject(
            new Error(
              `${this.provider} did not answer ${description} within ${String(timeoutMs)}ms.`,
            ),
          );
        }, timeoutMs),
      };
      this.pending.add(expectation);
    });
  }

  public async dispose(): Promise<void> {
    for (const expectation of this.pending) clearTimeout(expectation.timer);
    this.pending.clear();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const closed = new Promise<void>((resolve) => this.child.once('close', () => resolve()));
    this.child.stdin?.end();
    this.child.kill('SIGTERM');
    const forced = setTimeout(() => this.child.kill('SIGKILL'), 2_000);
    await closed;
    clearTimeout(forced);
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      this.fail(
        new Error(`${this.provider} wrote a line that was not JSON: ${trimmed.slice(0, 200)}`),
      );
      return;
    }
    for (const expectation of this.pending) {
      if (expectation.accept(message)) {
        this.pending.delete(expectation);
        clearTimeout(expectation.timer);
        expectation.resolve(message);
        return;
      }
    }
  }

  private fail(error: Error): void {
    this.failure ??= error;
    for (const expectation of this.pending) {
      clearTimeout(expectation.timer);
      expectation.reject(this.failure);
    }
    this.pending.clear();
  }
}
