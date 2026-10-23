const FILE_EXTENSION_TO_CODE_LANGUAGE: Record<string, string> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  h: "c",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  md: "markdown",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  swift: "swift",
  ts: "typescript",
  tsx: "tsx",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

export const getCodeLanguageFromFilePath = (
  filePath: string | null
): string | undefined => {
  if (!filePath) {
    return undefined;
  }

  const extension = filePath.split(".").pop()?.trim().toLowerCase();
  if (!extension) {
    return undefined;
  }

  return FILE_EXTENSION_TO_CODE_LANGUAGE[extension];
};
