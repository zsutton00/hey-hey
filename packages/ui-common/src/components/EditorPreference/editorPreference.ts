export interface SourceReference {
  path: string;
  line: number;
  column: number;
}

export type ExternalEditorPreference =
  | { kind: "preset"; editor: "vscode" }
  | { kind: "custom"; urlTemplate: string };

export const EXTERNAL_EDITOR_PREFERENCE_STORAGE_KEY =
  "hey-hey.external-editor-preference.v1";

const SOURCE_LOCATION_PATTERN = /^(.*?):(\d+)(?::(\d+))?$/;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const URI_SCHEME_PATTERN = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const UNSAFE_OR_BROWSER_SCHEMES = new Set([
  "blob",
  "data",
  "file",
  "http",
  "https",
  "javascript",
  "vbscript",
]);

const isPositiveInteger = (value: string): boolean => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0;
};

const isAbsolutePath = (path: string): boolean =>
  path.startsWith("/") || WINDOWS_ABSOLUTE_PATH_PATTERN.test(path);

const decodeMarkdownDestinationPath = (path: string): string => {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
};

export const parseSourceReference = (
  destination: string | undefined
): SourceReference | null => {
  if (!destination) return null;

  const match = SOURCE_LOCATION_PATTERN.exec(destination);
  if (match) {
    const [, path = "", line = "", column] = match;
    if (
      !isAbsolutePath(path) ||
      !isPositiveInteger(line) ||
      (column !== undefined && !isPositiveInteger(column))
    ) {
      return null;
    }

    return {
      path: decodeMarkdownDestinationPath(path),
      line: Number(line),
      column: column === undefined ? 1 : Number(column),
    };
  }

  if (!isAbsolutePath(destination)) return null;

  return {
    path: decodeMarkdownDestinationPath(destination),
    line: 1,
    column: 1,
  };
};

const isExternalEditorPreference = (
  value: unknown
): value is ExternalEditorPreference => {
  if (typeof value !== "object" || value === null) return false;

  if (
    "kind" in value &&
    value.kind === "preset" &&
    "editor" in value &&
    value.editor === "vscode"
  ) {
    return true;
  }

  return (
    "kind" in value &&
    value.kind === "custom" &&
    "urlTemplate" in value &&
    typeof value.urlTemplate === "string" &&
    validateExternalEditorUrlTemplate(value.urlTemplate) === null
  );
};

const getStorage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export const readExternalEditorPreference =
  (): ExternalEditorPreference | null => {
    try {
      const raw = getStorage()?.getItem(EXTERNAL_EDITOR_PREFERENCE_STORAGE_KEY);
      if (!raw) return null;

      const parsed: unknown = JSON.parse(raw);
      return isExternalEditorPreference(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

export const writeExternalEditorPreference = (
  preference: ExternalEditorPreference
): boolean => {
  if (!isExternalEditorPreference(preference)) return false;

  try {
    const storage = getStorage();
    if (!storage) return false;

    storage.setItem(
      EXTERNAL_EDITOR_PREFERENCE_STORAGE_KEY,
      JSON.stringify(preference)
    );
    return true;
  } catch {
    return false;
  }
};

export const resetExternalEditorPreference = (): boolean => {
  try {
    const storage = getStorage();
    if (!storage) return false;

    storage.removeItem(EXTERNAL_EDITOR_PREFERENCE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
};

export const validateExternalEditorUrlTemplate = (
  urlTemplate: string
): string | null => {
  const trimmedTemplate = urlTemplate.trim();
  if (!trimmedTemplate.includes("{path}")) {
    return "Custom templates must include {path}.";
  }

  const scheme = URI_SCHEME_PATTERN.exec(trimmedTemplate)?.[1]?.toLowerCase();
  if (!scheme || UNSAFE_OR_BROWSER_SCHEMES.has(scheme)) {
    return "Use a registered editor URI scheme, such as cursor: or idea:.";
  }

  return null;
};

const encodePathPreservingSeparators = (path: string): string =>
  path
    .split(/([\\/])/)
    .map((part) =>
      part === "/" || part === "\\" ? part : encodeURIComponent(part)
    )
    .join("");

const expandTemplate = (
  template: string,
  sourceReference: SourceReference
): string => {
  const replacements: ReadonlyArray<readonly [string, string]> = [
    ["{path}", encodePathPreservingSeparators(sourceReference.path)],
    ["{line}", String(sourceReference.line)],
    ["{column}", String(sourceReference.column)],
  ];

  return replacements.reduce(
    (expanded, [placeholder, value]) => expanded.split(placeholder).join(value),
    template
  );
};

export const buildExternalEditorUrl = (
  preference: ExternalEditorPreference,
  sourceReference: SourceReference
): string => {
  if (preference.kind === "custom") {
    return expandTemplate(preference.urlTemplate, sourceReference);
  }

  const encodedPath = encodePathPreservingSeparators(sourceReference.path);
  const pathWithSingleLeadingSlash = encodedPath.startsWith("/")
    ? encodedPath
    : `/${encodedPath}`;
  return `vscode://file${pathWithSingleLeadingSlash}:${sourceReference.line}:${sourceReference.column}`;
};
