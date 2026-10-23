import type { FileReferenceValueV1 } from "./types";

const DESTINATION_PREFIX = "heyhey-file:v1:";

const escapeMarkdownLabel = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");

const unescapeMarkdownLabel = (value: string): string =>
  value.replace(/\\([\\[\]])/g, "$1");

export const fileReferenceLabel = ({
  serviceName,
  normalizedPath,
}: FileReferenceValueV1): string => `$${serviceName}/${normalizedPath}`;

export const fileReferenceDestination = ({
  serviceId,
  normalizedPath,
}: FileReferenceValueV1): string =>
  `${DESTINATION_PREFIX}${encodeURIComponent(serviceId)}:${encodeURIComponent(
    normalizedPath
  )}`;

export const serializeFileReferenceMarkdown = (
  value: FileReferenceValueV1
): string =>
  `[${escapeMarkdownLabel(fileReferenceLabel(value))}](${fileReferenceDestination(
    value
  )})`;

export const parseFileReferenceMarkdownParts = (
  rawLabel: string,
  destination: string
): FileReferenceValueV1 | null => {
  if (!destination.startsWith(DESTINATION_PREFIX)) return null;

  const encodedIdentity = destination.slice(DESTINATION_PREFIX.length);
  const separatorIndex = encodedIdentity.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === encodedIdentity.length - 1) {
    return null;
  }

  try {
    const serviceId = decodeURIComponent(
      encodedIdentity.slice(0, separatorIndex)
    );
    const normalizedPath = decodeURIComponent(
      encodedIdentity.slice(separatorIndex + 1)
    );
    const label = unescapeMarkdownLabel(rawLabel);
    const pathSuffix = `/${normalizedPath}`;

    if (
      !serviceId ||
      !normalizedPath ||
      !label.startsWith("$") ||
      !label.endsWith(pathSuffix)
    ) {
      return null;
    }

    const serviceName = label.slice(1, -pathSuffix.length);
    if (!serviceName) return null;

    return {
      version: 1,
      serviceId,
      serviceName,
      normalizedPath,
    };
  } catch {
    return null;
  }
};
