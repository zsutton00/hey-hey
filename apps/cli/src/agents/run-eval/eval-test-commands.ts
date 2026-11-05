import { spawn } from 'node:child_process';
import type { EvalTestCheck } from '@hey-hey/contracts/api/models';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_OUTPUT_CAP = 20_000;
/** How long to wait for output pipes to close after the command's own process has exited. */
const PIPE_CLOSE_GRACE_MS = 500;

export interface RunEvalTestCommandsOptions {
  /** The workspace directory the commands run in. */
  directory: string;
  /** The workspace's stripped environment. */
  environment: NodeJS.ProcessEnv;
  commands: readonly string[];
  timeoutMs?: number;
  outputCap?: number;
  /** A stop while commands run kills the current one and marks the rest as not run. */
  signal?: AbortSignal | undefined;
}

interface CommandOutcome {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  aborted: boolean;
}

/** Keeps the tail of the output, where a failing test reports its reason. */
const capOutput = (output: string, cap: number): { output: string; truncated: boolean } => {
  if (output.length <= cap) {
    return { output, truncated: false };
  }

  return { output: output.slice(output.length - cap), truncated: true };
};

const runCommand = (
  command: string,
  options: Required<Omit<RunEvalTestCommandsOptions, 'commands' | 'signal'>> & {
    signal: AbortSignal | undefined;
  },
): Promise<CommandOutcome> =>
  new Promise((resolve) => {
    let tail = '';
    let timedOut = false;
    let aborted = false;
    // Detached so the timeout can stop the whole process group, not just the shell.
    const child = spawn(command, {
      shell: true,
      cwd: options.directory,
      env: options.environment,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const collect = (chunk: Buffer): void => {
      // Only the tail can survive the cap, so never hold more than twice that.
      tail = (tail + chunk.toString('utf8')).slice(-options.outputCap * 2);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const killGroup = (): void => {
      if (child.pid === undefined) {
        return;
      }
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, options.timeoutMs);
    const onAbort = (): void => {
      aborted = true;
      killGroup();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    let finished = false;
    const finish = (outcome: CommandOutcome): void => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    child.on('error', (error) => {
      finish({ exitCode: null, output: error.message, timedOut, aborted });
    });
    child.on('exit', (code) => {
      // Background processes must not outlive the check. One that escaped the group and still
      // holds the output pipes would stall `close`, so stop waiting after a short grace.
      killGroup();
      setTimeout(
        () => finish({ exitCode: code, output: tail, timedOut, aborted }),
        PIPE_CLOSE_GRACE_MS,
      ).unref();
    });
    child.on('close', (code) => {
      finish({ exitCode: code, output: tail, timedOut, aborted });
    });
  });

/**
 * Runs the case's named test commands one after another in the attempt's
 * workspace. A failing or hanging command is recorded as a failed check and
 * never stops the ones after it. No commands means nothing runs.
 */
export const runEvalTestCommands = async (
  options: RunEvalTestCommandsOptions,
): Promise<EvalTestCheck[]> => {
  const resolved = {
    directory: options.directory,
    environment: options.environment,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    outputCap: options.outputCap ?? DEFAULT_OUTPUT_CAP,
    signal: options.signal,
  };
  const checks: EvalTestCheck[] = [];

  for (const command of options.commands) {
    if (options.signal?.aborted) {
      // Never reported as passed: a command that did not run proves nothing.
      checks.push({
        command,
        passed: false,
        exitCode: null,
        output: '[Not run: the evaluation was stopped.]',
        truncated: false,
        elapsedMs: 0,
      });
      continue;
    }

    const startedAt = Date.now();
    const outcome = await runCommand(command, resolved);
    let output = outcome.output;
    if (outcome.timedOut) {
      output = `${output}\n[Stopped: the command exceeded its ${resolved.timeoutMs} ms timeout.]`;
    } else if (outcome.aborted) {
      output = `${output}\n[Stopped: the evaluation was stopped while this command ran.]`;
    }
    const capped = capOutput(output, resolved.outputCap);
    checks.push({
      command,
      passed: !outcome.timedOut && !outcome.aborted && outcome.exitCode === 0,
      exitCode: outcome.timedOut || outcome.aborted ? null : outcome.exitCode,
      output: capped.output,
      truncated: capped.truncated,
      elapsedMs: Date.now() - startedAt,
    });
  }

  return checks;
};
