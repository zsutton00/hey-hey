import { ServerCommand, type ServerCommandOptions } from '../commands/server';

/** Which standard streams are attached to a terminal. */
export interface TerminalStreamFlags {
  stdin: boolean;
  stdout: boolean;
  stderr: boolean;
}

export const terminalStreamFlags = (): TerminalStreamFlags => ({
  stdin: process.stdin.isTTY === true,
  stdout: process.stdout.isTTY === true,
  stderr: process.stderr.isTTY === true,
});

/**
 * The menu needs keyboard input and a screen to draw on, so it mounts only
 * when both stdin and stdout are terminals. A terminal on stderr alone (for
 * example `heyhey > out.log`) or piped stdin keeps line output.
 */
export const shouldMountMenu = (flags: TerminalStreamFlags): boolean => flags.stdin && flags.stdout;

/** Runs the default command; the menu module is loaded only when it mounts. */
export const runDefaultServer = async (
  flags: TerminalStreamFlags,
  options: ServerCommandOptions,
): Promise<boolean> =>
  shouldMountMenu(flags)
    ? (await import('./launch')).runInteractiveServer(options)
    : new ServerCommand().run(options);
