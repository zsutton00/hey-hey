/**
 * @license
 * Copyright Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/// <reference types="jest" />

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { parse } from '../index';
import { JsonObject, JsonValue } from '../parse';
import { assertRoundTrips, assertSameAsJsonParse } from './utils';

describe('parse', () => {
  it('round trips a variety of JSON values', async () => {
    const jsonValues: ReadonlyArray<unknown> = [
      {
        a: [{ b: '' }],
        c: '',
      },

      // null
      null,
      // booleans
      true,
      false,
      // numbers
      0,
      1,
      -1,
      123,
      100e100,

      // strings
      '',
      'a',
      'ab',
      'a\nb',
      // arrays
      [],
      [null],
      [null, true],
      [null, true, 'a b c d e\n]["\\"] f g'],
      // objects
      {},
      { a: null },
      { a: null, b: true },
      { a: null, b: true, c: 'a b c d e\n]["\\"] f g' },
      // // nested arrays and objects
      [[], {}],
      [{}, []],
      { a: [] },
      { a: [], b: {} },
      { a: {}, b: [] },
      {
        a: [null, true, 'a b c d e\n]["\\"]}{}}{{}} f g'],
        b: { c: 'a b c d e\n]["\\"] f g' },
      },
      {
        a: [{ b: '' }],
        c: '',
      },
      {
        a: {
          b: {
            c: {
              d: {
                e: {
                  f: {
                    v: { w: { x: { y: { z: null } } } },
                  },
                },
              },
            },
          },
        },
      },
    ];

    for (const jsonValue of jsonValues) {
      await assertRoundTrips(jsonValue);
    }
  });

  it('handles the first 64k characters', async () => {
    for (let i = 0; i <= 0xffff; i++) {
      const charcodeStr = String.fromCharCode(i);
      const hex = i.toString(16).padStart(4, '0');
      await assertSameAsJsonParse(
        `literal U+${hex}`,
        `"${charcodeStr}"`,
        undefined,
      );
      await assertSameAsJsonParse(
        `\\u escape U+${hex}`,
        `"\\u${hex}"`,
        undefined,
      );
    }
  });

  it('matches JSON.parse for the first 64k values', async () => {
    const jsonVals = readFileSync(
      path.join(__dirname, 'jsonhead.jsonl'),
      'utf-8',
    )
      .trim()
      .split('\n');
    for (const [i, str] of jsonVals.entries()) {
      await assertSameAsJsonParse(`value ${i}`, str, true);
    }
  });

  async function collectSnapshots(chunks: string[]): Promise<{
    references: JsonValue[];
    snapshots: string[];
  }> {
    const references: JsonValue[] = [];
    const snapshots: string[] = [];
    async function* stream() {
      for (const chunk of chunks) {
        yield chunk;
      }
    }
    for await (const value of parse(stream())) {
      references.push(value);
      snapshots.push(JSON.stringify(value));
    }
    return { references, snapshots };
  }

  async function expectParseError(
    chunks: string[],
    message: string,
  ): Promise<void> {
    async function* stream() {
      for (const chunk of chunks) {
        yield chunk;
      }
    }
    await expect(async () => {
      for await (const _ of parse(stream())) {
        // Exhaust iterator to surface the failure
      }
    }).rejects.toThrow(message);
  }

  it('yields incremental updates when parsing objects', async () => {
    const { references, snapshots } = await collectSnapshots([
      '{"foo":',
      ' "bar", "baz":',
      ' "qux"}',
    ]);

    expect(snapshots).toEqual([
      '{}',
      '{"foo":"bar"}',
      '{"foo":"bar","baz":"qux"}',
    ]);
    expect(references).toHaveLength(3);
    expect(references[0]).toBe(references[1]);
    expect(references[1]).toBe(references[2]);
  });

  it('yields intermediate string values as more content arrives', async () => {
    const { snapshots } = await collectSnapshots(['"he', 'llo"']);

    expect(snapshots).toEqual(['"he"', '"hello"']);
  });

  it('does not append array elements until they are complete', async () => {
    const { references, snapshots } = await collectSnapshots([
      '[{"a":1}',
      ',{"b"',
      ':2}]',
    ]);

    expect(snapshots).toEqual(['[{"a":1}]', '[{"a":1}]', '[{"a":1},{"b":2}]']);
    expect(references[0]).toBe(references[1]);
  });

  it('reuses array and nested object references during streaming updates', async () => {
    const { references, snapshots } = await collectSnapshots([
      '[{"nested":{"value":1}}',
      ',{"nested":{"value":2}}]',
    ]);

    expect(snapshots).toEqual([
      '[{"nested":{"value":1}}]',
      '[{"nested":{"value":1}},{"nested":{"value":2}}]',
    ]);

    const firstArray = references[0] as JsonValue[];
    const secondArray = references[1] as JsonValue[];
    expect(secondArray).toBe(firstArray);

    const firstNested = (firstArray[0] as JsonObject).nested as JsonObject;
    const secondNested = (secondArray[0] as JsonObject).nested as JsonObject;
    expect(secondNested).toBe(firstNested);
  });

  it('defers nested array additions until the inner collection is complete', async () => {
    const { snapshots } = await collectSnapshots(['[[1,2]', ',[3,4]]']);

    expect(snapshots).toEqual(['[[1,2]]', '[[1,2],[3,4]]']);
  });

  it.each([
    ['number', ['1'], '1'],
    ['boolean', ['true'], 'true'],
    ['null', ['null'], 'null'],
  ])(
    'emits a single value for atomic primitives (%s)',
    async (_, chunks, value) => {
      const { snapshots } = await collectSnapshots(chunks);
      expect(snapshots).toEqual([value]);
    },
  );

  it('allows trailing whitespace without emitting new snapshots', async () => {
    const { snapshots } = await collectSnapshots(['{"a":1}', '   ']);
    expect(snapshots).toEqual(['{"a":1}']);
  });

  it('throws an error when JSON is invalid', async () => {
    await expectParseError(['{'], 'Unexpected end of content');
  });

  it('throws when trailing non-whitespace content remains', async () => {
    await expectParseError(['{"a":1}x'], 'Unexpected trailing content "x"');
  });
});
