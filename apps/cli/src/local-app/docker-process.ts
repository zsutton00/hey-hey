import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { sanitize } from '../tui/text';

export interface DockerFailureRecord {
  operation: string;
  service?: string;
  outcome: 'spawn' | 'exit' | 'signal' | 'timeout' | 'output-limit' | 'inspection';
  code: string;
  exitCode: number | null;
  signal: string | null;
  detail: string;
  truncated: boolean;
}

export class DockerProcessError extends Error {
  override readonly name = 'DockerProcessError';
  readonly code: string;
  constructor(readonly diagnostic: DockerFailureRecord) {
    super(
      `${diagnostic.operation}${diagnostic.service ? ` (${diagnostic.service})` : ''}: ${diagnostic.detail} [${diagnostic.code}]${diagnostic.truncated ? ' (output truncated)' : ''}`,
    );
    this.code = diagnostic.code;
  }
}

/** Process output is held until complete so secrets split across chunks cannot escape. */
export class DockerProcess {
  private readonly secrets = new Set<string>();
  constructor(
    readonly env: NodeJS.ProcessEnv = { ...process.env },
    readonly timeoutMs = 600_000,
  ) {
    for (const [key, value] of Object.entries(env)) {
      if (
        value &&
        (value.length >= 4 || /secret|token|password|credential|key/iu.test(key)) &&
        !/^(HOME|USER|LOGNAME|PATH|SHELL|PWD|OLDPWD|TMPDIR|COLIMA_HOME|DOCKER_HOST|DOCKER_CONTEXT|DOCKER_CONFIG)$/u.test(
          key,
        )
      ) {
        const safeValue = sanitize(value);
        if (safeValue) {
          this.secrets.add(safeValue);
        }
      }
    }
  }

  protect(values: string[]): void {
    for (const value of values) {
      if (value) {
        const safeValue = sanitize(value);
        if (safeValue) {
          this.secrets.add(safeValue);
        }
      }
    }
  }

  safe(text: string): string {
    let result = sanitize(text);
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length)) {
      result = result.split(secret).join('[redacted]');
    }
    return result
      .replace(
        /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/gu,
        '[redacted key]',
      )
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s/@]*)?@/giu, '$1[redacted]@')
      .replace(/([?&][^=\s&]+)=([^\s&#]*)/gu, '$1=[redacted]')
      .replace(/\b(Bearer|Basic)\s+[^\s,;]+/giu, '$1 [redacted]')
      .replace(
        /["']?\b([A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?)["']?\s*[=:]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gu,
        (match, key: string) => {
          return /(?:token|password|passwd|secret|credential|authorization|api.?key|private.?key)/iu.test(
            key,
          ) || /^[A-Z_][A-Z0-9_]*$/u.test(key)
            ? `${key}=[redacted]`
            : match;
        },
      )
      .replace(
        /\b(?:gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/gu,
        '[redacted]',
      );
  }

  inspectionError(cause: unknown): DockerProcessError {
    if (cause instanceof DockerProcessError) {
      return cause;
    }
    return new DockerProcessError({
      operation: 'runtime-inspection',
      outcome: 'inspection',
      code: 'DOCKER_INSPECTION',
      exitCode: null,
      signal: null,
      detail: this.safe(
        cause instanceof Error ? cause.message : 'Inspection failed without an error object',
      ).slice(0, 8192),
      truncated: false,
    });
  }

  async run(
    binary: string,
    args: string[],
    operation: string,
    input?: string,
    service?: string,
    timeoutMs = this.timeoutMs,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, { env: this.env, stdio: ['pipe', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outBytes = 0;
      let errBytes = 0;
      let truncated = false;
      let settled = false;
      const finish = (
        outcome: DockerFailureRecord['outcome'],
        code: string,
        exitCode: number | null,
        signal: string | null,
        fallback: string,
      ) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        const decoder = new StringDecoder('utf8');
        let raw = decoder.write(Buffer.concat(stderr));
        // Drop an incomplete final line at the capture boundary, including partial secrets.
        if (truncated) {
          raw = raw.slice(0, Math.max(0, raw.lastIndexOf('\n')));
        }
        const detail = this.safe(
          raw.trim() ||
            (truncated ? '' : Buffer.concat(stdout).toString('utf8').trim()) ||
            fallback,
        ).slice(0, 8192);
        reject(
          new DockerProcessError({
            operation,
            ...(service ? { service } : {}),
            outcome,
            code,
            exitCode,
            signal,
            detail,
            truncated: truncated || raw.length > 8192,
          }),
        );
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish('timeout', 'DOCKER_TIMEOUT', null, 'SIGKILL', 'Process exceeded its time limit');
      }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        outBytes += chunk.length;
        if (outBytes > 4 * 1024 * 1024) {
          truncated = true;
          child.kill('SIGKILL');
          finish(
            'output-limit',
            'DOCKER_OUTPUT_LIMIT',
            null,
            'SIGKILL',
            'Process output exceeded the capture limit',
          );
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        const remaining = 32768 - errBytes;
        if (remaining > 0) {
          stderr.push(chunk.subarray(0, remaining));
          errBytes += Math.min(chunk.length, remaining);
        }
        truncated ||= chunk.length > remaining;
      });
      child.on('error', (error: NodeJS.ErrnoException) => {
        finish(
          'spawn',
          'DOCKER_UNAVAILABLE',
          null,
          null,
          `${error.code ?? 'SPAWN_FAILED'}: ${error.message}`,
        );
      });
      child.on('close', (code, signal) => {
        if (settled) {
          return;
        }
        if (code === 0) {
          settled = true;
          clearTimeout(timer);
          resolve(Buffer.concat(stdout).toString('utf8'));
          return;
        }
        finish(
          signal ? 'signal' : 'exit',
          'DOCKER_EXIT',
          code,
          signal,
          signal ? `Process terminated by ${signal}` : `Process exited with status ${code}`,
        );
      });
      child.stdin.on('error', () => {
        // The process outcome is reported by close/error/timeout.
      });
      child.stdin.end(input);
    });
  }
}
