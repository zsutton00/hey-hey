export interface FileValidationResult {
  isValid: boolean;
  isLLMAnalyzable: boolean;
  category: FileCategory;
  errorMessage?: string;
  suggestedAction?: string;
}

export enum FileCategory {
  TEXT = "text",
  CODE = "code",
  DOCUMENT = "document",
  SPREADSHEET = "spreadsheet",
  PRESENTATION = "presentation",
  IMAGE = "image",
  AUDIO = "audio",
  VIDEO = "video",
  ARCHIVE = "archive",
  DATA = "data",
  UNKNOWN = "unknown",
}

const LLM_ANALYZABLE_MIME_TYPES = new Set([
  // Text files
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/css",
  "text/xml",
  "text/rtf",

  // Code files
  "text/javascript",
  "text/typescript",
  "application/javascript",
  "application/typescript",
  "application/json",
  "application/x-python",
  "text/x-python",
  "text/x-java-source",
  "text/x-c",
  "text/x-c++",
  "text/x-csharp",
  "text/x-php",
  "text/x-ruby",
  "text/x-go",
  "text/x-rust",
  "text/x-sql",
  "application/sql",

  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.oasis.opendocument.text",
  "application/rtf",

  // Spreadsheets
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.oasis.opendocument.spreadsheet",

  // Presentations
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.presentation",

  // Images (for OCR/analysis)
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/bmp",
  "image/webp",
  "image/svg+xml",

  // Data formats
  "application/xml",
  "application/yaml",
  "text/yaml",
  "application/toml",
  "text/toml",
]);

const LLM_ANALYZABLE_EXTENSIONS = new Set([
  // Text
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".html",
  ".htm",
  ".css",
  ".xml",
  ".rtf",

  // Code
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".json",
  ".py",
  ".java",
  ".c",
  ".cpp",
  ".cc",
  ".cxx",
  ".cs",
  ".php",
  ".rb",
  ".go",
  ".rs",
  ".sql",
  ".sh",
  ".bash",
  ".ps1",
  ".bat",
  ".vue",
  ".svelte",
  ".dart",
  ".kt",
  ".scala",
  ".clj",
  ".hs",
  ".elm",
  ".swift",
  ".r",
  ".m",
  ".pl",
  ".lua",
  ".vim",
  ".dockerfile",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".properties",

  // Documents
  ".pdf",
  ".doc",
  ".docx",
  ".odt",
  ".rtf",

  // Spreadsheets
  ".xls",
  ".xlsx",
  ".ods",
  ".csv",
  ".tsv",

  // Presentations
  ".ppt",
  ".pptx",
  ".odp",

  // Images
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",

  // Data
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".json",
  ".jsonl",
  ".ndjson",
]);

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export function validateFile(file: File): FileValidationResult {
  const extension = getFileExtension(file.name);
  const category = categorizeFile(file);

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      isValid: false,
      isLLMAnalyzable: false,
      category,
      errorMessage: `File size (${formatFileSize(
        file.size,
      )}) exceeds maximum allowed size (${formatFileSize(MAX_FILE_SIZE)})`,
      suggestedAction: "Please select a smaller file or compress the file",
    };
  }

  // Check if file is empty
  if (file.size === 0) {
    return {
      isValid: false,
      isLLMAnalyzable: false,
      category,
      errorMessage: "File is empty",
      suggestedAction: "Please select a file with content",
    };
  }

  // Check if file type is LLM analyzable
  const isLLMAnalyzable = isFileAnalyzableByLLM(file);

  if (!isLLMAnalyzable) {
    return {
      isValid: true,
      isLLMAnalyzable: false,
      category,
      errorMessage: `File type ${
        file.type || extension
      } is not currently supported for LLM analysis`,
      suggestedAction:
        "Convert to a supported format (PDF, text, code, image, etc.)",
    };
  }

  return {
    isValid: true,
    isLLMAnalyzable: true,
    category,
  };
}

export function isFileAnalyzableByLLM(file: File): boolean {
  const extension = getFileExtension(file.name);
  const mimeType = file.type;

  return (
    LLM_ANALYZABLE_MIME_TYPES.has(mimeType) ||
    LLM_ANALYZABLE_EXTENSIONS.has(extension)
  );
}

export function categorizeFile(file: File): FileCategory {
  const extension = getFileExtension(file.name);
  const mimeType = file.type;

  // Text files
  if (
    mimeType.startsWith("text/") ||
    [".txt", ".md", ".markdown", ".rtf"].includes(extension)
  ) {
    return FileCategory.TEXT;
  }

  // Code files
  if (isCodeFile(file)) {
    return FileCategory.CODE;
  }

  // Documents
  if (
    mimeType.includes("pdf") ||
    mimeType.includes("word") ||
    mimeType.includes("document") ||
    [".pdf", ".doc", ".docx", ".odt"].includes(extension)
  ) {
    return FileCategory.DOCUMENT;
  }

  // Spreadsheets
  if (
    mimeType.includes("excel") ||
    mimeType.includes("spreadsheet") ||
    [".xls", ".xlsx", ".ods", ".csv"].includes(extension)
  ) {
    return FileCategory.SPREADSHEET;
  }

  // Presentations
  if (
    mimeType.includes("powerpoint") ||
    mimeType.includes("presentation") ||
    [".ppt", ".pptx", ".odp"].includes(extension)
  ) {
    return FileCategory.PRESENTATION;
  }

  // Images
  if (mimeType.startsWith("image/")) {
    return FileCategory.IMAGE;
  }

  // Audio
  if (mimeType.startsWith("audio/")) {
    return FileCategory.AUDIO;
  }

  // Video
  if (mimeType.startsWith("video/")) {
    return FileCategory.VIDEO;
  }

  // Archives
  if (
    mimeType.includes("zip") ||
    mimeType.includes("tar") ||
    mimeType.includes("rar") ||
    [".zip", ".tar", ".gz", ".rar", ".7z"].includes(extension)
  ) {
    return FileCategory.ARCHIVE;
  }

  // Data formats
  if ([".json", ".xml", ".yaml", ".yml", ".toml", ".csv"].includes(extension)) {
    return FileCategory.DATA;
  }

  return FileCategory.UNKNOWN;
}

function isCodeFile(file: File): boolean {
  const extension = getFileExtension(file.name);
  const codeExtensions = [
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".py",
    ".java",
    ".c",
    ".cpp",
    ".cs",
    ".php",
    ".rb",
    ".go",
    ".rs",
    ".sql",
    ".sh",
    ".bash",
    ".vue",
    ".svelte",
    ".dart",
    ".kt",
    ".scala",
    ".clj",
    ".hs",
    ".elm",
    ".swift",
    ".r",
    ".m",
    ".pl",
    ".lua",
  ];

  return (
    codeExtensions.includes(extension) ||
    file.type.includes("javascript") ||
    file.type.includes("python")
  );
}

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot !== -1 ? filename.slice(lastDot).toLowerCase() : "";
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function getFileIcon(category: FileCategory): string {
  switch (category) {
    case FileCategory.TEXT:
      return "📄";
    case FileCategory.CODE:
      return "💻";
    case FileCategory.DOCUMENT:
      return "📝";
    case FileCategory.SPREADSHEET:
      return "📊";
    case FileCategory.PRESENTATION:
      return "🖼️";
    case FileCategory.IMAGE:
      return "🖼️";
    case FileCategory.AUDIO:
      return "🎵";
    case FileCategory.VIDEO:
      return "🎬";
    case FileCategory.ARCHIVE:
      return "📦";
    case FileCategory.DATA:
      return "🗂️";
    default:
      return "📁";
  }
}
