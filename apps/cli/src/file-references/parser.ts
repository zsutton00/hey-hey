import type { ParsedFileReference } from './types';

const GLOB_CHARS = /[*?[\]{}]/u;
const LINE_RANGE_SUFFIX = /:(\d+)(?:-(\d+))?$/u;

const parseToken = (rawToken: string): ParsedFileReference | null => {
  if (!rawToken.startsWith('@')) {
    return null;
  }

  const raw = rawToken;
  const withoutPrefix = rawToken.slice(1);
  if (withoutPrefix.length === 0) {
    return null;
  }

  const lineMatch = withoutPrefix.match(LINE_RANGE_SUFFIX);
  if (!lineMatch) {
    return {
      raw,
      pathText: withoutPrefix,
      isGlob: GLOB_CHARS.test(withoutPrefix),
    };
  }

  const lineStart = Number(lineMatch[1]);
  const lineEnd = lineMatch[2] ? Number(lineMatch[2]) : undefined;
  const pathText = withoutPrefix.slice(0, withoutPrefix.length - lineMatch[0].length);

  if (pathText.length === 0) {
    return null;
  }

  return {
    raw,
    pathText,
    lineRange: {
      startLine: lineStart,
      ...(lineEnd !== undefined ? { endLine: lineEnd } : {}),
    },
    isGlob: GLOB_CHARS.test(pathText),
  };
};

export const extractReferencesFromText = (text: string): ParsedFileReference[] => {
  const matches = text.match(/(?:^|\s)(@[^\s]+)/gu) ?? [];

  return matches
    .map((entry) => entry.trim())
    .map((entry) => parseToken(entry))
    .filter((entry): entry is ParsedFileReference => entry !== null);
};

export const parseReferenceToken = (token: string): ParsedFileReference | null => parseToken(token);
