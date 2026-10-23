import type { IconType } from "react-icons";
import {
  DiCss3,
  DiGo,
  DiHtml5,
  DiJava,
  DiJavascript1,
  DiMarkdown,
  DiPython,
  DiRuby,
  DiRust,
  DiSass,
} from "react-icons/di";
import { SiGnubash, SiJson, SiTypescript, SiYaml } from "react-icons/si";
import { FaFileAlt, FaLock } from "react-icons/fa";

export interface FileTypeIcon {
  Icon: IconType;
  ariaLabel: string;
  color?: string;
}

const TEST_PATH_PATTERN = /(^|\/)(__tests__|test)\//;
const TEST_FILE_PATTERN = /\.(test|spec)\./;
const NON_TEST_FILE_COLOR = "heyhey.main";

const LOCKFILE_NAMES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
]);

const EXTENSION_ICONS: Record<string, FileTypeIcon> = {
  ts: { Icon: SiTypescript, ariaLabel: "TypeScript file" },
  tsx: { Icon: SiTypescript, ariaLabel: "TypeScript React file" },
  js: { Icon: DiJavascript1, ariaLabel: "JavaScript file" },
  jsx: { Icon: DiJavascript1, ariaLabel: "JavaScript React file" },
  py: { Icon: DiPython, ariaLabel: "Python file" },
  rs: { Icon: DiRust, ariaLabel: "Rust file" },
  go: { Icon: DiGo, ariaLabel: "Go file" },
  rb: { Icon: DiRuby, ariaLabel: "Ruby file" },
  java: { Icon: DiJava, ariaLabel: "Java file" },
  json: { Icon: SiJson, ariaLabel: "JSON file" },
  md: { Icon: DiMarkdown, ariaLabel: "Markdown document" },
  css: { Icon: DiCss3, ariaLabel: "Stylesheet" },
  scss: { Icon: DiSass, ariaLabel: "Stylesheet" },
  html: { Icon: DiHtml5, ariaLabel: "HTML document" },
  yaml: { Icon: SiYaml, ariaLabel: "YAML configuration file" },
  yml: { Icon: SiYaml, ariaLabel: "YAML configuration file" },
  sh: { Icon: SiGnubash, ariaLabel: "Shell script" },
};

const DEFAULT_ICON: FileTypeIcon = {
  Icon: FaFileAlt,
  ariaLabel: "File",
};

const LOCKFILE_ICON: FileTypeIcon = {
  Icon: FaLock,
  ariaLabel: "Lockfile",
};

const getFileName = (filePath: string): string => {
  const parts = filePath.split("/");
  return parts[parts.length - 1] ?? filePath;
};

const getExtension = (fileName: string): string | null => {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
};

const resolveBaseIcon = (fileName: string): FileTypeIcon => {
  if (LOCKFILE_NAMES.has(fileName)) {
    return LOCKFILE_ICON;
  }

  const extension = getExtension(fileName);
  if (extension !== null && extension in EXTENSION_ICONS) {
    return EXTENSION_ICONS[extension];
  }

  return DEFAULT_ICON;
};

export const resolveFileTypeIcon = (filePath: string): FileTypeIcon => {
  const fileName = getFileName(filePath);
  const isTestFile =
    TEST_PATH_PATTERN.test(filePath) || TEST_FILE_PATTERN.test(fileName);

  const base = resolveBaseIcon(fileName);
  if (isTestFile) {
    return base;
  }
  return { ...base, color: NON_TEST_FILE_COLOR };
};
