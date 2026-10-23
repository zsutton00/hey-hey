import type { ImageSectionContent } from '../../generated/model/imageSectionContent';

export const IMAGE_SECTION_CONTENT_SCHEMA_REF =
  '#/components/schemas/ImageSectionContent';

export const IMAGE_SECTION_MAX_DECODED_BYTES = 1_000_000;

type ImageMimeType = ImageSectionContent['mimeType'];

const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const matchesSignature: Record<ImageMimeType, (bytes: Buffer) => boolean> = {
  'image/png': (bytes) =>
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (bytes) =>
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff,
  'image/webp': (bytes) =>
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP',
};

function isImageMimeType(value: unknown): value is ImageMimeType {
  return typeof value === 'string' && Object.hasOwn(matchesSignature, value);
}

/**
 * Validates inline image section content. Messages never echo the payload so
 * base64 data cannot leak into errors or logs.
 */
export function validateImageSectionContent(
  content: unknown,
):
  | { success: true; canonicalContent: string }
  | { success: false; message: string } {
  let value = content;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { success: false, message: 'root: content must be valid JSON' };
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { success: false, message: 'root: expected an object' };
  }

  const record = value as Record<string, unknown>;
  const extraKeys = Object.keys(record).filter(
    (key) => key !== 'mimeType' && key !== 'data',
  );
  if (extraKeys.length > 0) {
    return {
      success: false,
      message: `root: unexpected properties ${extraKeys.join(', ')}`,
    };
  }

  const { mimeType, data } = record;
  if (!isImageMimeType(mimeType)) {
    return {
      success: false,
      message: `mimeType: must be one of ${Object.keys(matchesSignature).join(', ')}`,
    };
  }
  if (typeof data !== 'string' || data.length === 0) {
    return { success: false, message: 'data: must be a non-empty string' };
  }
  // Reject on encoded length first so oversized payloads are never decoded.
  if (data.length > Math.ceil(IMAGE_SECTION_MAX_DECODED_BYTES / 3) * 4) {
    return {
      success: false,
      message: `data: image exceeds ${IMAGE_SECTION_MAX_DECODED_BYTES} bytes`,
    };
  }
  if (!BASE64_PATTERN.test(data)) {
    return { success: false, message: 'data: must be valid padded base64' };
  }

  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > IMAGE_SECTION_MAX_DECODED_BYTES) {
    return {
      success: false,
      message: `data: image exceeds ${IMAGE_SECTION_MAX_DECODED_BYTES} bytes`,
    };
  }
  if (!matchesSignature[mimeType](bytes)) {
    return {
      success: false,
      message: `data: decoded bytes are not a ${mimeType} image`,
    };
  }

  const canonical: ImageSectionContent = { mimeType, data };
  return { success: true, canonicalContent: JSON.stringify(canonical) };
}
