import { describe, expect, it } from 'vitest';
import { extractReferencesFromText, parseReferenceToken } from '../index';

describe('file reference parser', () => {
  it('extracts @-prefixed references only', () => {
    const refs = extractReferencesFromText(
      'use @src/main.ts and @src/main.ts:10-20 but not src/other.ts',
    );

    expect(refs).toHaveLength(2);
    expect(refs[0]?.raw).toBe('@src/main.ts');
    expect(refs[1]?.lineRange).toEqual({ startLine: 10, endLine: 20 });
  });

  it('parses windows and relative forms', () => {
    const win = parseReferenceToken('@C:\\repo\\src\\main.ts:42');
    const rel = parseReferenceToken('@../shared/file.ts');

    expect(win?.pathText).toBe('C:\\repo\\src\\main.ts');
    expect(win?.lineRange?.startLine).toBe(42);
    expect(rel?.pathText).toBe('../shared/file.ts');
  });

  it('detects globs', () => {
    const parsed = parseReferenceToken('@src/**/*.ts');
    expect(parsed?.isGlob).toBe(true);
  });

  it('rejects non-prefixed references', () => {
    expect(parseReferenceToken('src/main.ts')).toBeNull();
  });
});
