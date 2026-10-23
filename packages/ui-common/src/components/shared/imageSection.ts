import {
  ImageSectionContentMimeTypeEnum,
  WorkItemTypeSectionDefinitionKindEnum,
  type ImageSectionContent,
  type WorkItemTypeSectionDefinition,
} from "../../api";

export const IMAGE_SECTION_SCHEMA_REF =
  "#/components/schemas/ImageSectionContent";

/** Decoded-byte ceiling enforced by the server for ImageSectionContent. */
export const IMAGE_SECTION_MAX_BYTES = 1_000_000;

const SUPPORTED_MIME_TYPES: readonly string[] = Object.values(
  ImageSectionContentMimeTypeEnum
);

/**
 * Image rendering is selected by the effective registry definition (json kind
 * plus the registered schemaRef), never by a work-item type key.
 */
export const isImageSectionDefinition = (
  definition:
    | Pick<WorkItemTypeSectionDefinition, "kind" | "schemaRef">
    | undefined
): boolean =>
  definition?.kind === WorkItemTypeSectionDefinitionKindEnum.Json &&
  definition.schemaRef === IMAGE_SECTION_SCHEMA_REF;

export type ImageSectionValue =
  | { status: "absent" }
  | { status: "valid"; image: ImageSectionContent }
  | { status: "invalid" };

/**
 * Reads a stored or proposed image section. Materialized sections arrive as
 * JSON text and proposed sections as objects; empty content means absence.
 */
export const readImageSection = (content: unknown): ImageSectionValue => {
  if (content === undefined || content === null) return { status: "absent" };
  let value: unknown = content;
  if (typeof content === "string") {
    if (!content.trim()) return { status: "absent" };
    try {
      value = JSON.parse(content);
    } catch {
      return { status: "invalid" };
    }
  }
  if (typeof value !== "object" || value === null) return { status: "invalid" };
  const { mimeType, data } = value as Record<string, unknown>;
  if (
    typeof mimeType !== "string" ||
    !SUPPORTED_MIME_TYPES.includes(mimeType) ||
    typeof data !== "string" ||
    !data
  ) {
    return { status: "invalid" };
  }
  return {
    status: "valid",
    image: { mimeType: mimeType as ImageSectionContent["mimeType"], data },
  };
};

export const serializeImageSection = (image: ImageSectionContent): string =>
  JSON.stringify({ mimeType: image.mimeType, data: image.data });

export const imageSectionDataUrl = (image: ImageSectionContent): string =>
  `data:${image.mimeType};base64,${image.data}`;

const sniffMimeType = (bytes: Uint8Array): string | undefined => {
  const startsWith = (signature: readonly number[], offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return ImageSectionContentMimeTypeEnum.ImagePng;
  }
  if (startsWith([0xff, 0xd8, 0xff])) {
    return ImageSectionContentMimeTypeEnum.ImageJpeg;
  }
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return ImageSectionContentMimeTypeEnum.ImageWebp;
  }
  return undefined;
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
};

const readBytes = (file: Blob): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });

export type ImageFileEncoding =
  | { status: "ok"; image: ImageSectionContent }
  | { status: "error"; message: string };

/**
 * Encodes a local file into the generated mimeType/data payload exactly as
 * supplied — no resizing or compression. These checks give actionable
 * feedback before save; server validation remains authoritative.
 */
export const encodeImageFile = async (
  file: Blob & { name?: string }
): Promise<ImageFileEncoding> => {
  if (file.size > IMAGE_SECTION_MAX_BYTES) {
    return {
      status: "error",
      message: `Image is ${file.size.toLocaleString()} bytes; the limit is ${IMAGE_SECTION_MAX_BYTES.toLocaleString()} bytes. Choose a smaller PNG, JPEG, or WebP file.`,
    };
  }
  const bytes = await readBytes(file);
  const mimeType = sniffMimeType(bytes);
  if (!mimeType) {
    return {
      status: "error",
      message: "Unsupported image. Choose a PNG, JPEG, or WebP file.",
    };
  }
  if (file.type && file.type !== mimeType) {
    return {
      status: "error",
      message: `File is labelled ${file.type} but its contents are ${mimeType}. Re-export the image and try again.`,
    };
  }
  return {
    status: "ok",
    image: {
      mimeType: mimeType as ImageSectionContent["mimeType"],
      data: toBase64(bytes),
    },
  };
};

export const IMAGE_SECTION_ACCEPT = SUPPORTED_MIME_TYPES.join(",");
