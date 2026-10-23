/**
 * Sørensen–Dice coefficient for bigram-based string similarity.
 * Returns a value between 0 (no overlap) and 1 (identical).
 */
export function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;

  const bigrams = (input: string): string[] => {
    const padded = ` ${input} `;
    const grams: string[] = [];
    for (let i = 0; i < padded.length - 1; i++) {
      grams.push(padded.slice(i, i + 2));
    }
    return grams;
  };

  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  if (!aGrams.length || !bGrams.length) return 0;

  const intersection = aGrams.filter((gram) => bGrams.includes(gram)).length;
  return (2 * intersection) / (aGrams.length + bGrams.length);
}
