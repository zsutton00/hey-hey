/** Shared traversal of the canonical entity collections, without selection policy. */
export function* entityEntriesOf<H, R>(context: {
  featureHierarchy?: H[] | undefined;
  relatedEntities?: R[] | undefined;
}): Generator<
  | { section: 'featureHierarchy'; position: number; entry: H }
  | { section: 'relatedEntities'; position: number; entry: R }
> {
  for (const [position, entry] of (context.featureHierarchy ?? []).entries()) {
    yield { section: 'featureHierarchy', position, entry };
  }

  for (const [position, entry] of (context.relatedEntities ?? []).entries()) {
    yield { section: 'relatedEntities', position, entry };
  }
}
