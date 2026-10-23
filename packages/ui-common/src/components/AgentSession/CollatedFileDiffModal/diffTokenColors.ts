/**
 * Per-token color palettes for the diff viewer's inline syntax highlighting.
 * The two palettes target light and dark MUI modes and keep contrast readable
 * over the green/red row tints {@link resolveLineColors} paints behind insert
 * and delete rows. Token types absent from the palette fall through to
 * `inherit`, so the row's surrounding text color carries them.
 */

export type DiffTokenColorMap = Record<string, string>;

const LIGHT: DiffTokenColorMap = {
  keyword: "#0033b3",
  "class-name": "#0d5c5c",
  function: "#7a3e9d",
  "generic-function": "#7a3e9d",
  string: "#067d17",
  "attr-value": "#067d17",
  regex: "#067d17",
  number: "#1750eb",
  boolean: "#0033b3",
  constant: "#1750eb",
  comment: "#8c8c8c",
  operator: "#5c5c5c",
  punctuation: "#5c5c5c",
  tag: "#0033b3",
  "attr-name": "#7a3e9d",
  builtin: "#0d5c5c",
  property: "#7a3e9d",
  symbol: "#1750eb",
  decorator: "#7a3e9d",
  at: "#7a3e9d",
};

const DARK: DiffTokenColorMap = {
  keyword: "#cf8e6d",
  "class-name": "#bcbec4",
  function: "#56a8f5",
  "generic-function": "#56a8f5",
  string: "#6aab73",
  "attr-value": "#6aab73",
  regex: "#6aab73",
  number: "#2aacb8",
  boolean: "#cf8e6d",
  constant: "#2aacb8",
  comment: "#7a7e85",
  operator: "#bcbec4",
  punctuation: "#bcbec4",
  tag: "#cf8e6d",
  "attr-name": "#bcbec4",
  builtin: "#cf8e6d",
  property: "#c77dbb",
  symbol: "#2aacb8",
  decorator: "#b3ae60",
  at: "#b3ae60",
};

export const getDiffTokenColors = (
  paletteMode: "light" | "dark",
): DiffTokenColorMap => (paletteMode === "dark" ? DARK : LIGHT);
