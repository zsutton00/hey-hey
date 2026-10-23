/**
 * Creates a shallow copy of an object, excluding any properties with undefined values
 * @param obj The object to copy
 * @returns A new object with all properties except those with undefined values
 */
export function removeUndefined<T extends object>(obj: T): Partial<T> {
  const result = {} as Partial<T>;

  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }

  return result;
}
