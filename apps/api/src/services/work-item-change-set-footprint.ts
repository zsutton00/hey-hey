/**
 * Resolves the identity keys a projection held to persisted ids. Every item a
 * rule or consumer view read is in the footprint, so concurrent intents
 * contend only when they write or validate against the same items.
 */
export function projectionFootprintIds(
  identityKeys: readonly string[],
  mappings: Readonly<Record<string, string>>,
): string[] {
  const ids = new Set<string>();
  for (const key of identityKeys) {
    if (key.startsWith('existing:')) {
      ids.add(key.slice('existing:'.length));
      continue;
    }
    const id = mappings[key];
    if (!id) {
      throw new Error('Projection footprint is missing an identity mapping.');
    }
    ids.add(id);
  }
  return [...ids].sort();
}
