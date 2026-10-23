/**
 * Resolve a Prism language id for a file path so the diff viewer can render
 * syntax-highlighted tokens for a known set of source extensions. The map is
 * intentionally narrow — it covers only the languages the diff viewer expects
 * to encounter in this product surface. Unknown extensions return `null` so
 * the caller can fall back to plain text rather than guessing.
 *
 * Grammars are imported statically here so prismjs is bundled by tsup at
 * build time. Imports are ordered to satisfy Prism's grammar dependencies:
 * `tsx` extends `jsx` and `typescript`; `jsx` extends `markup` and
 * `javascript`; `typescript` extends `javascript`; `markdown` extends
 * `markup`. `markup`, `css`, and `javascript` are part of Prism's core
 * bundle, so they do not need a separate import — but `markup` is loaded
 * before `jsx`/`markdown` in the natural import order below.
 */

import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";

import { getFileExtension } from "./fileProcessing";

// Tell Prism not to attach DOMContentLoaded listeners or try to highlight
// the page automatically — we only use it as a tokenizer.
Prism.manual = true;

/**
 * Lower-cased file extension → Prism language id. Keys do not include the
 * leading dot. The mapped value is the string id Prism uses to key its
 * `Prism.languages` registry, suitable for use as a memoization key.
 */
const EXTENSION_TO_PRISM_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  css: "css",
  md: "markdown",
  markdown: "markdown",
};

/**
 * Resolve the Prism language id for a file path, or `null` when the
 * extension is not in the supported set. Callers should treat `null` as the
 * signal to render the file as plain text rather than picking a fallback
 * grammar.
 */
export const resolvePrismLanguage = (filePath: string): string | null => {
  const raw = getFileExtension(filePath);
  if (raw === "") return null;
  // `getFileExtension` returns the extension with its leading dot, e.g.
  // `.ts`. Strip the dot so the map keys read naturally.
  const ext = raw.startsWith(".") ? raw.slice(1) : raw;
  return EXTENSION_TO_PRISM_LANGUAGE[ext] ?? null;
};
