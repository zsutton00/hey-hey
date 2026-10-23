export type RunAttachmentImageMime = "image/png" | "image/jpeg" | "image/webp";

export const RUN_ATTACHMENT_FORMAT_HELP =
  "Attach UTF-8 text/code files or PNG, JPEG and WebP images. PDFs, Office documents and other binary formats are unsupported.";

const textExtensions = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "csv",
  "tsv",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "html",
  "css",
  "scss",
  "xml",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "swift",
  "kt",
  "kts",
  "sh",
  "bash",
  "zsh",
  "sql",
  "toml",
  "ini",
  "conf",
  "log",
  "diff",
  "patch",
  "svg",
  "vue",
  "svelte",
  "graphql",
  "gql",
  "tf",
  "proto",
]);

export function runAttachmentFormat(
  fileName: string
): "text" | RunAttachmentImageMime | null {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  return extension && textExtensions.has(extension) ? "text" : null;
}

/** Transient provider input only; never put these values in platform messages or Run records. */
export type RunAttachmentContent =
  | { kind: "text"; fileName: string; text: string }
  | {
      kind: "image";
      fileName: string;
      mediaType: RunAttachmentImageMime;
      data: string;
    };
