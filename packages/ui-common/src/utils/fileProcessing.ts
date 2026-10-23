import type { FileContent } from "../types/dragAndDrop";
import {
  validateFile,
  categorizeFile,
  getFileIcon,
  formatFileSize,
} from "./fileValidation";

export interface ProcessedFile extends FileContent {
  isValid: boolean;
  isLLMAnalyzable: boolean;
  errorMessage?: string;
  suggestedAction?: string;
}

export async function processFiles(
  files: FileList | File[],
): Promise<ProcessedFile[]> {
  const fileArray = Array.from(files);

  return Promise.all(
    fileArray.map(async (file) => {
      const validation = validateFile(file);
      const category = categorizeFile(file);
      const preview = await generateFilePreview(file);

      const processedFile: ProcessedFile = {
        file,
        id: generateFileId(file),
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        preview,
        metadata: {
          category,
          icon: getFileIcon(category),
          formattedSize: formatFileSize(file.size),
          extension: getFileExtension(file.name),
        },
        isValid: validation.isValid,
        isLLMAnalyzable: validation.isLLMAnalyzable,
        errorMessage: validation.errorMessage,
        suggestedAction: validation.suggestedAction,
      };

      return processedFile;
    }),
  );
}

function generateFileId(file: File): string {
  return `file-${file.name}-${file.size}-${file.lastModified}-${Math.random()
    .toString(36)
    .substr(2, 9)}`;
}

export async function generateFilePreview(
  file: File,
): Promise<string | undefined> {
  // For images, create a data URL preview
  if (file.type.startsWith("image/")) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        resolve(e.target?.result as string);
      };
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(file);
    });
  }

  // For text files, read a preview of the content
  if (file.type.startsWith("text/") || isTextFile(file)) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        // Get first 500 characters as preview
        resolve(
          text
            ? text.substring(0, 500) + (text.length > 500 ? "..." : "")
            : undefined,
        );
      };
      reader.onerror = () => resolve(undefined);
      reader.readAsText(file);
    });
  }

  return undefined;
}

function isTextFile(file: File): boolean {
  const textExtensions = [
    ".txt",
    ".md",
    ".markdown",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".json",
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
    ".vim",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".properties",
    ".xml",
    ".html",
    ".htm",
    ".css",
  ];

  const extension = getFileExtension(file.name);
  return textExtensions.includes(extension);
}

export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot !== -1 ? filename.slice(lastDot).toLowerCase() : "";
}

async function extractFileMetadata(
  file: File,
): Promise<Record<string, unknown>> {
  const metadata: Record<string, unknown> = {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: new Date(file.lastModified).toISOString(),
    category: categorizeFile(file).toString(),
    extension: getFileExtension(file.name),
  };

  // For images, try to extract dimensions
  if (file.type.startsWith("image/")) {
    try {
      const dimensions = await getImageDimensions(file);
      metadata.width = dimensions.width;
      metadata.height = dimensions.height;
    } catch {
      // Ignore errors for unsupported image formats
    }
  }

  return metadata;
}

function getImageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };

    img.src = url;
  });
}

export async function createFileContent(file: File): Promise<FileContent> {
  const metadata = await extractFileMetadata(file);
  const preview = await generateFilePreview(file);

  return {
    file,
    id: generateFileId(file),
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    preview,
    metadata,
  };
}
