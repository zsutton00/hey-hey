import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { excerptEntity } from './excerpt';
import type { TitledRef } from './types';

/**
 * Real platform data, captured from the project the experiment runs against.
 *
 * `*.indexed.txt` and `spans.json` are the `text` and `matchSpans` that unified search returned for
 * the entity. `*.loaded.md` is the text the live reader built for the same entity during a real
 * gather (the saved gather output, after Implementation was left out). The feature's indexed text
 * is cut after its "Lifecycle initiation" section; every span in it lies before that cut.
 *
 * The two texts are different renderings of one entity. A test that builds both from one string
 * cannot show that, which is how excerpts silently fell back to full content on every entity.
 */
const dir = path.join(__dirname, '__fixtures__', 'real-hits');

type MatchSpan = NonNullable<TitledRef['matchSpans']>[number];

interface Captured {
  id: string;
  kind: string;
  title: string;
  matchSpans: MatchSpan[];
}

const captured: Record<string, Captured> = JSON.parse(
  readFileSync(path.join(dir, 'spans.json'), 'utf8'),
);

describe.each(Object.entries(captured))('real hit for %s', (name, hit) => {
  const indexedText = readFileSync(path.join(dir, `${name}.indexed.txt`), 'utf8');
  const loaded = readFileSync(path.join(dir, `${name}.loaded.md`), 'utf8');
  const entity = { id: hit.id, kind: hit.kind, title: hit.title, text: loaded };

  const result = excerptEntity(entity, { ...entity, indexedText, matchSpans: hit.matchSpans });

  it('is cut down from the matched spans, not returned in full', () => {
    expect(result.excerpt).toMatchObject({ partial: true, source: 'spans' });
    expect(result.excerpt?.fullReason).toBeUndefined();
    expect(result.text.length).toBeLessThan(loaded.length);
  });

  it('keeps the text each matched span points at', () => {
    for (const { start, end } of hit.matchSpans) {
      const matched = indexedText.slice(start, end).trim();
      expect(result.text).toContain(matched);
    }
  });
});
