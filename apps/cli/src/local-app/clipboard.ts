import { spawn } from 'node:child_process';

interface ClipboardTool {
  command: string;
  args: string[];
}

const TOOLS: Record<'darwin' | 'win32' | 'linux', ClipboardTool[]> = {
  darwin: [{ command: 'pbcopy', args: [] }],
  win32: [{ command: 'clip', args: [] }],
  linux: [
    { command: 'wl-copy', args: [] },
    { command: 'xclip', args: ['-selection', 'clipboard'] },
    { command: 'xsel', args: ['--clipboard', '--input'] },
  ],
};

export type ClipboardResult = { copied: true; tool: string } | { copied: false; cause: string };

/**
 * Copies through the platform's clipboard program. Success is the program's own exit status,
 * which is why terminal escape sequences (no confirmation) are not used.
 */
export class Clipboard {
  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly timeoutMs = 3000,
    private readonly tools?: ClipboardTool[],
  ) {}

  async copy(text: string): Promise<ClipboardResult> {
    const candidates =
      this.tools ??
      TOOLS[this.platform === 'darwin' || this.platform === 'win32' ? this.platform : 'linux'];
    const failures: string[] = [];
    for (const tool of candidates) {
      const outcome = await this.run(tool, text);
      if (outcome === 'ok') {
        return { copied: true, tool: tool.command };
      }
      failures.push(`${tool.command}: ${outcome}`);
    }
    return { copied: false, cause: failures.join('; ') };
  }

  private run(tool: ClipboardTool, text: string): Promise<string> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (outcome: string) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(outcome);
        }
      };
      const child = spawn(tool.command, tool.args, { stdio: ['pipe', 'ignore', 'ignore'] });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(`timed out after ${String(this.timeoutMs)} ms`);
      }, this.timeoutMs);
      child.on('error', (error: NodeJS.ErrnoException) =>
        finish(
          error.code === 'ENOENT'
            ? 'not installed'
            : `failed to start (${error.code ?? 'unknown'})`,
        ),
      );
      child.on('exit', (code, signal) =>
        finish(code === 0 ? 'ok' : `exited with ${signal ?? `code ${String(code)}`}`),
      );
      // A tool that exits before reading stdin reports through its exit status instead.
      child.stdin.on('error', () => undefined);
      child.stdin.end(text);
    });
  }
}
