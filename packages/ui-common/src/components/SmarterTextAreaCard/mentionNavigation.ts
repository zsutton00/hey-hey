export const computeNextMentionIndex = (
  direction: "up" | "down",
  prev: number,
  length: number
): number => {
  if (length === 0) return -1;
  if (direction === "down") {
    return prev < 0 ? 0 : (prev + 1) % length;
  }
  return prev < 0 ? length - 1 : (prev - 1 + length) % length;
};
