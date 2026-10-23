export const FEATURE_REFERENCE_DISCOVERY_TAG =
  "feature-reference-discovery" as const;

const COMPLETION_BOUNDARY_PATTERN = /[\s\p{P}\p{S}]/u;

function getInsertedText(previousText: string, currentText: string): string {
  let prefixLength = 0;
  const sharedLength = Math.min(previousText.length, currentText.length);
  while (
    prefixLength < sharedLength &&
    previousText[prefixLength] === currentText[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < sharedLength - prefixLength &&
    previousText[previousText.length - suffixLength - 1] ===
      currentText[currentText.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  return currentText.slice(prefixLength, currentText.length - suffixLength);
}

export function didInsertFeatureReferenceCompletionBoundary(
  previousText: string,
  currentText: string,
): boolean {
  const insertedText = getInsertedText(previousText, currentText);
  const finalInsertedCharacter = Array.from(insertedText).at(-1);
  return finalInsertedCharacter
    ? COMPLETION_BOUNDARY_PATTERN.test(finalInsertedCharacter)
    : false;
}
