/**
 * @license
 * Copyright Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/// <reference types="jest" />

import {
  JsonTokenType,
  TokenHandler,
  tokenize as rawTokenize,
} from '../tokenize';
import { makeStream, toArray } from './utils';

async function toFlatArray<T>(iter: AsyncIterable<T[]>): Promise<T[]> {
  return (await toArray(iter)).flat();
}

async function* tokenize(stream: AsyncIterable<string>): AsyncIterable<
  Array<{
    type: JsonTokenType;
    value: string | number | boolean | undefined;
  }>
> {
  class Handler implements TokenHandler {
    tokens: Array<{
      type: JsonTokenType;
      value: string | number | boolean | undefined;
    }> = [];

    handleNull(): void {
      this.tokens.push({ type: JsonTokenType.Null, value: undefined });
    }
    handleBoolean(value: boolean): void {
      this.tokens.push({ type: JsonTokenType.Boolean, value });
    }
    handleNumber(value: number): void {
      this.tokens.push({ type: JsonTokenType.Number, value });
    }
    handleStringStart(): void {
      this.tokens.push({ type: JsonTokenType.StringStart, value: undefined });
    }
    handleStringMiddle(value: string): void {
      this.tokens.push({ type: JsonTokenType.StringMiddle, value });
    }
    handleStringEnd(): void {
      this.tokens.push({ type: JsonTokenType.StringEnd, value: undefined });
    }
    handleArrayStart(): void {
      this.tokens.push({ type: JsonTokenType.ArrayStart, value: undefined });
    }
    handleArrayEnd(): void {
      this.tokens.push({ type: JsonTokenType.ArrayEnd, value: undefined });
    }
    handleObjectStart(): void {
      this.tokens.push({ type: JsonTokenType.ObjectStart, value: undefined });
    }
    handleObjectEnd(): void {
      this.tokens.push({ type: JsonTokenType.ObjectEnd, value: undefined });
    }
  }
  const handler = new Handler();
  const tokenizer = rawTokenize(stream, handler);
  while (!tokenizer.isDone()) {
    await tokenizer.pump();
  }
  yield handler.tokens;
}

describe('tokenizeJsonStream', () => {
  it('tokenizes null', async () => {
    const tokens = tokenize(makeStream('null'));
    await expect(toFlatArray(tokens)).resolves.toEqual([
      { type: JsonTokenType.Null, value: undefined },
    ]);
  });

  it('tokenizes empty arrays', async () => {
    const tokens = tokenize(makeStream('[]'));
    await expect(toFlatArray(tokens)).resolves.toEqual([
      { type: JsonTokenType.ArrayStart, value: undefined },
      { type: JsonTokenType.ArrayEnd, value: undefined },
    ]);
  });

  it('tokenizes arrays with one element', async () => {
    const tokens = tokenize(makeStream('[null]'));
    await expect(toFlatArray(tokens)).resolves.toEqual([
      { type: JsonTokenType.ArrayStart, value: undefined },
      { type: JsonTokenType.Null, value: undefined },
      { type: JsonTokenType.ArrayEnd, value: undefined },
    ]);
  });

  it('tokenizes arrays with multiple elements', async () => {
    const tokens = tokenize(makeStream('[null, true]'));
    await expect(toFlatArray(tokens)).resolves.toEqual([
      { type: JsonTokenType.ArrayStart, value: undefined },
      { type: JsonTokenType.Null, value: undefined },
      { type: JsonTokenType.Boolean, value: true },
      { type: JsonTokenType.ArrayEnd, value: undefined },
    ]);
  });

  it('tokenizes empty strings', async () => {
    const tokens = tokenize(makeStream('""'));
    await expect(toFlatArray(tokens)).resolves.toEqual([
      { type: JsonTokenType.StringStart, value: undefined },
      { type: JsonTokenType.StringEnd, value: undefined },
    ]);
  });

  it('tokenizes strings with characters', async () => {
    const tokens = tokenize(makeStream('"a"'));
    await expect(toFlatArray(tokens)).resolves.toEqual([
      { type: JsonTokenType.StringStart, value: undefined },
      { type: JsonTokenType.StringMiddle, value: 'a' },
      { type: JsonTokenType.StringEnd, value: undefined },
    ]);
  });

  it('tokenizes chunked strings', async () => {
    const tokens = tokenize(makeStream('"', 'a', '"'));
    await expect(toFlatArray(tokens)).resolves.toEqual([
      { type: JsonTokenType.StringStart, value: undefined },
      { type: JsonTokenType.StringMiddle, value: 'a' },
      { type: JsonTokenType.StringEnd, value: undefined },
    ]);
  });

  it('tokenizes strings with multiple characters', async () => {
    const tokens = tokenize(makeStream('"', 'a', 'b', '"'));
    await expect(toFlatArray(tokens)).resolves.toEqual([
      { type: JsonTokenType.StringStart, value: undefined },
      { type: JsonTokenType.StringMiddle, value: 'a' },
      { type: JsonTokenType.StringMiddle, value: 'b' },
      { type: JsonTokenType.StringEnd, value: undefined },
    ]);
  });

  it('tokenizes strings with escapes', async () => {
    const tokens = tokenize(makeStream(JSON.stringify('"\\\n\u2028\t')));
    await expect(toFlatArray(tokens)).resolves.toEqual([
      { type: JsonTokenType.StringStart, value: undefined },
      { type: JsonTokenType.StringMiddle, value: '"' },
      { type: JsonTokenType.StringMiddle, value: '\\' },
      { type: JsonTokenType.StringMiddle, value: '\n' },
      { type: JsonTokenType.StringMiddle, value: '\u2028' },
      { type: JsonTokenType.StringMiddle, value: '\t' },
      { type: JsonTokenType.StringEnd, value: undefined },
    ]);
  });

  it('tokenizes empty objects', async () => {
    const tokens = tokenize(makeStream('{}'));
    await expect(toFlatArray(tokens)).resolves.toEqual([
      { type: JsonTokenType.ObjectStart, value: undefined },
      { type: JsonTokenType.ObjectEnd, value: undefined },
    ]);
  });

  it('tokenizes objects with one key-value pair', async () => {
    const tokens = tokenize(makeStream('{"a": null}'));
    await expect(toFlatArray(tokens)).resolves.toEqual([
      { type: JsonTokenType.ObjectStart, value: undefined },
      { type: JsonTokenType.StringStart, value: undefined },
      { type: JsonTokenType.StringMiddle, value: 'a' },
      { type: JsonTokenType.StringEnd, value: undefined },
      { type: JsonTokenType.Null, value: undefined },
      { type: JsonTokenType.ObjectEnd, value: undefined },
    ]);
  });

  it('tokenizes objects with multiple key-value pairs', async () => {
    const tokens = tokenize(makeStream('{"a": null, "b": true}'));
    await expect(toFlatArray(tokens)).resolves.toEqual([
      { type: JsonTokenType.ObjectStart, value: undefined },
      { type: JsonTokenType.StringStart, value: undefined },
      { type: JsonTokenType.StringMiddle, value: 'a' },
      { type: JsonTokenType.StringEnd, value: undefined },
      { type: JsonTokenType.Null, value: undefined },
      { type: JsonTokenType.StringStart, value: undefined },
      { type: JsonTokenType.StringMiddle, value: 'b' },
      { type: JsonTokenType.StringEnd, value: undefined },
      { type: JsonTokenType.Boolean, value: true },
      { type: JsonTokenType.ObjectEnd, value: undefined },
    ]);
  });

  it('tokenizes numbers', async () => {
    const tokens = tokenize(makeStream('123'));
    await expect(toFlatArray(tokens)).resolves.toEqual([
      { type: JsonTokenType.Number, value: 123 },
    ]);
  });

  it('tokenizes numbers split across chunks', async () => {
    const tokens = tokenize(makeStream('1', '23'));
    await expect(toFlatArray(tokens)).resolves.toEqual([
      { type: JsonTokenType.Number, value: 123 },
    ]);
  });

  it('tokenizes decimal numbers split across chunks', async () => {
    const tokens = tokenize(makeStream('3.', '14'));
    await expect(toFlatArray(tokens)).resolves.toEqual([
      { type: JsonTokenType.Number, value: 3.14 },
    ]);
  });

  it('tokenizes negative numbers', async () => {
    const tokens = tokenize(makeStream('-42'));
    await expect(toFlatArray(tokens)).resolves.toEqual([
      { type: JsonTokenType.Number, value: -42 },
    ]);
  });

  it('tokenizes floating point numbers', async () => {
    const tokens = tokenize(makeStream('-3.14'));
    await expect(toFlatArray(tokens)).resolves.toEqual([
      { type: JsonTokenType.Number, value: -3.14 },
    ]);
  });

  it('tokenizes numbers with exponents', async () => {
    const tokens = tokenize(makeStream('1e+2'));
    await expect(toFlatArray(tokens)).resolves.toEqual([
      { type: JsonTokenType.Number, value: 100 },
    ]);
  });

  it('tokenizes chunked numbers with exponents', async () => {
    const tokens = tokenize(makeStream('1e', '+', '2'));
    await expect(toFlatArray(tokens)).resolves.toEqual([
      { type: JsonTokenType.Number, value: 100 },
    ]);
  });
});
