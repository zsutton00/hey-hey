export interface MigrateRunStoreArguments {
  readonly apply: boolean;
  readonly verbose: boolean;
}

export const parseMigrateRunStoreArguments = (rawArguments: string[]): MigrateRunStoreArguments => {
  const args = rawArguments.filter((argument) => argument !== '--');
  for (const argument of args) {
    if (argument === '--apply' || argument === '--verbose') continue;
    throw new Error(`Unsupported argument: ${argument}`);
  }
  return {
    apply: args.includes('--apply'),
    verbose: args.includes('--verbose'),
  };
};
