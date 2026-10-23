import type { SourceReference } from "../../EditorPreference";
import type { ServiceRepoBinding } from "../../../api";
import type { FileReferenceValueV1 } from "./types";

type BindingsByServiceId = Readonly<Record<string, ServiceRepoBinding>>;

const DRIVE_QUALIFIED_PATH = /^[A-Za-z]:/;
const WINDOWS_ROOT = /^([A-Za-z]):\\(.*)$/;

const parseSegments = (
  raw: string,
  separator: "/" | "\\"
): readonly string[] | null => {
  if (raw === "") return [];

  const segments = raw.split(separator);
  if (segments.at(-1) === "") segments.pop();

  return segments.some(
    (segment) => segment === "" || segment === "." || segment === ".."
  )
    ? null
    : segments;
};

const parseRelativePath = (
  normalizedPath: string
): readonly string[] | null => {
  if (
    normalizedPath === "" ||
    normalizedPath.startsWith("/") ||
    normalizedPath.startsWith("\\") ||
    normalizedPath.endsWith("/") ||
    normalizedPath.includes("\\") ||
    DRIVE_QUALIFIED_PATH.test(normalizedPath)
  ) {
    return null;
  }

  return parseSegments(normalizedPath, "/");
};

const joinPosixRoot = (
  repositoryPath: string,
  relativeSegments: readonly string[]
): string | null => {
  if (!repositoryPath.startsWith("/") || repositoryPath.includes("\\")) {
    return null;
  }

  const rootSegments = parseSegments(repositoryPath.slice(1), "/");
  if (!rootSegments) return null;

  const normalizedRoot =
    rootSegments.length === 0 ? "/" : `/${rootSegments.join("/")}`;
  const joinedPath =
    normalizedRoot === "/"
      ? `/${relativeSegments.join("/")}`
      : `${normalizedRoot}/${relativeSegments.join("/")}`;

  return joinedPath.startsWith(
    normalizedRoot === "/" ? "/" : `${normalizedRoot}/`
  )
    ? joinedPath
    : null;
};

const joinWindowsRoot = (
  repositoryPath: string,
  relativeSegments: readonly string[]
): string | null => {
  if (repositoryPath.includes("/")) return null;

  const rootMatch = WINDOWS_ROOT.exec(repositoryPath);
  if (!rootMatch) return null;

  const [, drive = "", rootTail = ""] = rootMatch;
  const rootSegments = parseSegments(rootTail, "\\");
  if (!rootSegments) return null;

  const normalizedRoot =
    rootSegments.length === 0
      ? `${drive.toUpperCase()}:\\`
      : `${drive.toUpperCase()}:\\${rootSegments.join("\\")}`;
  const joinedPath = `${normalizedRoot}${
    normalizedRoot.endsWith("\\") ? "" : "\\"
  }${relativeSegments.join("\\")}`;
  const boundary = normalizedRoot.endsWith("\\")
    ? normalizedRoot
    : `${normalizedRoot}\\`;

  return joinedPath.toLowerCase().startsWith(boundary.toLowerCase())
    ? joinedPath
    : null;
};

export const resolveFileReferenceSource = (
  value: FileReferenceValueV1,
  bindingsByServiceId: BindingsByServiceId
): SourceReference | null => {
  const binding = bindingsByServiceId[value.serviceId];
  if (!binding || binding.serviceId !== value.serviceId) return null;

  const relativeSegments = parseRelativePath(value.normalizedPath);
  if (!relativeSegments) return null;

  const path =
    joinPosixRoot(binding.repositoryPath, relativeSegments) ??
    joinWindowsRoot(binding.repositoryPath, relativeSegments);

  return path ? { path, line: 1, column: 1 } : null;
};
