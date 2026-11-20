import type { EvalRecordedFileChange } from "@hey-hey/contracts/api/models";

export interface JoinedSavedPatch {
  /** One patch `git apply` can take; empty when no file could be included. */
  patch: string;
  /** Paths left out because git saved no content for them (binary changes). */
  binaryPaths: string[];
}

const BINARY_DIFF_LINE = /^Binary files .* differ$/mu;

/**
 * Joins an attempt's saved per-file patches into the one patch a person
 * downloads. Files whose patch is empty (an empty new file) or binary carry no
 * text git can apply, so they are left out and the binary ones are named.
 */
export const joinSavedPatch = (
  files: readonly Pick<EvalRecordedFileChange, "path" | "patch">[],
): JoinedSavedPatch => {
  const binaryPaths: string[] = [];
  const parts: string[] = [];

  for (const file of files) {
    if (BINARY_DIFF_LINE.test(file.patch)) {
      binaryPaths.push(file.path);
      continue;
    }
    if (file.patch.trim() === "") {
      continue;
    }

    parts.push(file.patch.endsWith("\n") ? file.patch : `${file.patch}\n`);
  }

  return { patch: parts.join(""), binaryPaths };
};
