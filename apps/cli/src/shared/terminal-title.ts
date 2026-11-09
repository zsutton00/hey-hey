export type TerminalEnvironment = 'production' | 'staging' | 'local';

export const formatTerminalTitle = (environment: TerminalEnvironment, profile?: string): string => {
  const context = [environment === 'production' ? undefined : environment, profile]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  return context ? `Hey Hey (${context})` : 'Hey Hey';
};

export const setTerminalTitle = (
  environment: TerminalEnvironment,
  profile: string | undefined,
  stdout: Pick<NodeJS.WriteStream, 'isTTY' | 'write'> = process.stdout,
  registerExit: (handler: () => void) => void = (handler) => process.once('exit', handler),
): void => {
  if (!stdout.isTTY) {
    return;
  }

  stdout.write(`\u001B]0;${formatTerminalTitle(environment, profile)}\u0007`);
  registerExit(() => stdout.write('\u001B]0;\u0007'));
};
