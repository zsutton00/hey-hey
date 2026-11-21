import type { EvalRecordedFileChange } from "@hey-hey/contracts/api/models";

/** Quotes a value for a POSIX shell unless it is plainly safe to paste. */
export const shellQuote = (value: string): string =>
  /^[\w@%+=:,./~-]+$/u.test(value)
    ? value
    : `'${value.replace(/'/gu, "'\\''")}'`;

/**
 * What the person opens once the patch is applied, read from the saved paths
 * rather than guessed from the target's spelling.
 * - file: an output path (the exact target, or the attempt's only output)
 * - directory: a target that contains saved output
 * - unknown: a target the saved paths neither match nor contain
 */
export type OutputOpening =
  | { kind: "file"; path: string }
  | { kind: "directory"; path: string }
  | { kind: "unknown"; path: string }
  | null;

export const resolveOutputOpening = (
  targetPath: string | undefined,
  files: readonly Pick<EvalRecordedFileChange, "path" | "status">[],
): OutputOpening => {
  const outputPaths = files
    .filter((file) => file.status !== "deleted")
    .map((file) => file.path);
  const target = targetPath?.replace(/\/+$/u, "");

  if (!target) {
    const [only] = outputPaths;

    return outputPaths.length === 1 && only
      ? { kind: "file", path: only }
      : null;
  }
  if (outputPaths.includes(target)) {
    return { kind: "file", path: target };
  }
  if (outputPaths.some((path) => path.startsWith(`${target}/`))) {
    return { kind: "directory", path: target };
  }

  return { kind: "unknown", path: target };
};

/**
 * The commands that reproduce the output. Each step runs only if the one
 * before it succeeded, so a failed checkout can never lead to the patch being
 * applied in the person's own clone. No commands when there is no patch.
 */
export const buildOpenOutputCommands = (options: {
  attemptName: string;
  sha: string;
  patchPath: string;
  hasPatch: boolean;
  opening: OutputOpening;
}): string[] => {
  if (!options.hasPatch) {
    return [];
  }

  const directory = shellQuote(`../${options.attemptName}`);
  const steps = [
    `git worktree add ${directory} ${shellQuote(options.sha)}`,
    `cd ${directory}`,
    `git apply ${shellQuote(options.patchPath)}`,
    ...(options.opening?.kind === "directory"
      ? [`cd ${shellQuote(options.opening.path)}`]
      : []),
  ];

  return steps.map((step, index) =>
    index < steps.length - 1 ? `${step} &&` : step,
  );
};
