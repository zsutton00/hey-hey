export interface DeleteInvalidRunsArguments {
  apply: boolean;
  verbose: boolean;
}

const supportedArguments = new Set(['--apply', '--verbose']);

export const parseDeleteInvalidRunsArguments = (
  rawArguments: string[],
): DeleteInvalidRunsArguments => {
  const argumentsWithoutSeparator = rawArguments.filter((argument) => argument !== '--');
  const unsupportedArguments = argumentsWithoutSeparator.filter(
    (argument) => !supportedArguments.has(argument),
  );
  if (unsupportedArguments.length > 0) {
    throw new Error(`Unsupported argument(s): ${unsupportedArguments.join(', ')}`);
  }

  return {
    apply: argumentsWithoutSeparator.includes('--apply'),
    verbose: argumentsWithoutSeparator.includes('--verbose'),
  };
};
