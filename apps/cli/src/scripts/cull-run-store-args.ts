export interface CullRunStoreArguments {
  readonly apply: boolean;
  readonly verbose: boolean;
  readonly completedBefore?: Date;
  readonly keepRecentCompleted: number;
}

const parseDate = (value: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error('--completed-before must use YYYY-MM-DD.');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('--completed-before must be a valid calendar date.');
  }
  return parsed;
};

const parseKeepRecentCompleted = (value: string): number => {
  if (!/^\d+$/u.test(value)) {
    throw new Error('--keep-recent-completed must be a non-negative integer.');
  }
  return Number.parseInt(value, 10);
};

export const parseCullRunStoreArguments = (rawArguments: string[]): CullRunStoreArguments => {
  const args = rawArguments.filter((argument) => argument !== '--');
  let completedBefore: Date | undefined;
  let keepRecentCompleted = 0;
  for (const argument of args) {
    if (argument === '--apply' || argument === '--verbose') continue;
    if (argument.startsWith('--completed-before=')) {
      completedBefore = parseDate(argument.slice('--completed-before='.length));
      continue;
    }
    if (argument.startsWith('--keep-recent-completed=')) {
      keepRecentCompleted = parseKeepRecentCompleted(
        argument.slice('--keep-recent-completed='.length),
      );
      continue;
    }
    throw new Error(`Unsupported argument: ${argument}`);
  }
  if (keepRecentCompleted > 0 && !completedBefore) {
    throw new Error('--keep-recent-completed requires --completed-before.');
  }
  return {
    apply: args.includes('--apply'),
    verbose: args.includes('--verbose'),
    ...(completedBefore ? { completedBefore } : {}),
    keepRecentCompleted,
  };
};
