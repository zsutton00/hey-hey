import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

import type {
  LocalCodingAgentAvailability,
  LocalCodingAgentDetectionDto,
} from '../shared/api/index';

const EXECUTABLES = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
} as const satisfies Record<keyof LocalCodingAgentDetectionDto, string>;

const DEFAULT_WINDOWS_EXTENSIONS = '.COM;.EXE;.BAT;.CMD';

/**
 * Finds which coding agents are installed on this computer by looking for their
 * executables on PATH. It reports availability only: never paths, credentials,
 * provider output, login state or model readiness.
 */
export class CodingAgentDetector {
  public constructor(
    private readonly searchPath: string = process.env['PATH'] ?? '',
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly pathExtensions: string = process.env['PATHEXT'] ?? DEFAULT_WINDOWS_EXTENSIONS,
  ) {}

  public async detect(): Promise<LocalCodingAgentDetectionDto> {
    const [claude, codex, opencode] = await Promise.all([
      this.availability(EXECUTABLES.claude),
      this.availability(EXECUTABLES.codex),
      this.availability(EXECUTABLES.opencode),
    ]);

    return { claude, codex, opencode };
  }

  /** Windows launches `claude.cmd` or `codex.exe` from the bare name, using PATHEXT. */
  private fileNames(executable: string): string[] {
    if (this.platform !== 'win32') {
      return [executable];
    }

    const extensions = this.pathExtensions
      .split(';')
      .filter((extension) => extension !== '')
      .map((extension) => extension.toLowerCase());

    return extensions.map((extension) => `${executable}${extension}`);
  }

  /** Each agent is checked independently so one failure never hides the others. */
  private async availability(executable: string): Promise<LocalCodingAgentAvailability> {
    const directories = this.searchPath.split(delimiter).filter((directory) => directory !== '');
    const fileNames = this.fileNames(executable);
    let failed = false;

    for (const directory of directories) {
      for (const fileName of fileNames) {
        try {
          await access(join(directory, fileName), constants.X_OK);
          return 'installed';
        } catch (error) {
          if (!isMissing(error)) {
            failed = true;
          }
        }
      }
    }

    return failed ? 'check-failed' : 'not-found';
  }
}

const isMissing = (error: unknown): boolean =>
  error instanceof Error &&
  'code' in error &&
  (error.code === 'ENOENT' || error.code === 'ENOTDIR');
