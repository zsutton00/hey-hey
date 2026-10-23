import { createTwoFilesPatch, diffLines } from "diff";

export interface FeatureDiffContent {
  description: string;
  requirements: string;
}

type FeatureDiffSectionKey = keyof FeatureDiffContent;

const FEATURE_DIFF_SECTIONS: ReadonlyArray<{
  key: FeatureDiffSectionKey;
  label: string;
}> = [
  { key: "description", label: "Description" },
  { key: "requirements", label: "Requirements" },
];

// When the volume of changed lines (added + removed character count) divided
// by the length of the updated section exceeds this ratio, a unified diff is
// dominated by changes and offers little signal — emit the whole updated
// section instead so the agent reads the new content directly.
const FULL_CONTENT_FALLBACK_RATIO = 0.5;

const computeChangeRatio = (before: string, after: string): number => {
  const afterLength = after.length;
  if (afterLength === 0) {
    return before.length === 0 ? 0 : 1;
  }
  const changes = diffLines(before, after);
  let changedVolume = 0;
  for (const change of changes) {
    if (change.added || change.removed) {
      changedVolume += change.value.length;
    }
  }
  return changedVolume / afterLength;
};

const buildSectionPatch = (
  label: string,
  before: string,
  after: string
): string => {
  const patch = createTwoFilesPatch(
    label,
    label,
    before,
    after,
    undefined,
    undefined,
    { context: 3 }
  );
  return patch.trimEnd();
};

/**
 * Composes the synthetic first message handed to the feature's
 * entity-conversation when the user chooses "Submit and Create Task". For
 * each section that changed it emits either a standard unified diff or, when
 * the change is dense enough that the diff would be noisier than the new
 * content itself, the full updated section text. The agent is already
 * directed to load the current entity, so the fallback path does not repeat
 * the prior content.
 */
export const buildFeatureDiffMessage = (
  before: FeatureDiffContent,
  after: FeatureDiffContent
): string => {
  const sectionBlocks: string[] = [];

  for (const { key, label } of FEATURE_DIFF_SECTIONS) {
    const beforeValue = before[key];
    const afterValue = after[key];
    if (beforeValue === afterValue) {
      continue;
    }

    const ratio = computeChangeRatio(beforeValue, afterValue);
    if (ratio > FULL_CONTENT_FALLBACK_RATIO) {
      sectionBlocks.push(
        [`### ${label} (updated content)`, "", afterValue].join("\n")
      );
    } else {
      sectionBlocks.push(
        [
          `### ${label}`,
          "",
          buildSectionPatch(label, beforeValue, afterValue),
        ].join("\n")
      );
    }
  }

  return [
    "I just updated this feature. Here's what changed:",
    "",
    sectionBlocks.join("\n\n"),
    "",
    "Please draft a task to implement these changes.",
  ].join("\n");
};
