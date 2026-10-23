/**
 * One fixed, provider-independent size budget for MCP read results. It sits
 * below the approximately 10,000-token display cap of the most restrictive
 * provider so no provider cuts or spills a result the tool already bounded.
 * Tokens are estimated from characters.
 */
export const RESPONSE_TOKEN_BUDGET = 8_000;
export const CHARACTERS_PER_TOKEN = 4;
export const RESPONSE_CHARACTER_BUDGET =
  RESPONSE_TOKEN_BUDGET * CHARACTERS_PER_TOKEN;

export const SIZE_BUDGET_REASON = 'SIZE_BUDGET';

/**
 * Room reserved for the response envelope (wrapper keys, braces) and the
 * per-entry separators that entry sizes do not include.
 */
export const ENVELOPE_ALLOWANCE = 256;

/**
 * Admit whole records in request order until the next one would push the
 * serialized response over the budget. The record that does not fit and every
 * record after it are replaced by their omission marker. The first record is
 * always admitted whole, even when it alone exceeds the budget.
 *
 * `sizeOf` returns the serialized length of one entry in its final position
 * in the response. Each record is measured once, and the space the omission
 * markers of the remaining records need is reserved before a record is admitted.
 * `envelope` is the serialized length the entries do not account for; the
 * default is a generous allowance, and a caller that serializes in a fixed
 * shape can pass the exact value.
 */
export function admitWholeRecords<T, O>(
  records: readonly T[],
  omissionFor: (record: T, index: number) => O,
  sizeOf: (entry: T | O, index: number) => number,
  envelope: number = ENVELOPE_ALLOWANCE,
): (T | O)[] {
  const omissions = records.map(omissionFor);
  const entries: (T | O)[] = [...omissions];
  const omissionSizes = omissions.map(sizeOf);
  let total = envelope + omissionSizes.reduce((sum, size) => sum + size, 0);
  for (const [index, record] of records.entries()) {
    const growth = sizeOf(record, index) - omissionSizes[index]!;
    if (index > 0 && total + growth > RESPONSE_CHARACTER_BUDGET) break;
    entries[index] = record;
    total += growth;
  }
  return entries;
}
