import {
  IMAGE_SECTION_CONTENT_SCHEMA_REF,
  IMAGE_SECTION_MAX_DECODED_BYTES,
  validateImageSectionContent,
} from '../image-section-content.validator';
import { TaskSectionSchemaValidatorRegistry } from '../task-section-schema-validator.registry';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP_SIGNATURE = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);

function image(signature: Buffer, totalBytes = signature.length + 8): string {
  return Buffer.concat([
    signature,
    Buffer.alloc(totalBytes - signature.length, 0x01),
  ]).toString('base64');
}

describe('image section content schema', () => {
  const definition = {
    key: 'image',
    label: 'Image',
    kind: 'json' as const,
    schemaRef: IMAGE_SECTION_CONTENT_SCHEMA_REF,
  };
  const registry = new TaskSectionSchemaValidatorRegistry();

  it.each([
    ['image/png', PNG_SIGNATURE],
    ['image/jpeg', JPEG_SIGNATURE],
    ['image/webp', WEBP_SIGNATURE],
  ] as const)(
    'accepts %s through the shared registry and preserves the bytes',
    (mimeType, signature) => {
      const data = image(signature);
      const result = registry.validate(definition, { data, mimeType });

      expect(result).toEqual({
        success: true,
        canonicalContent: JSON.stringify({ mimeType, data }),
      });
    },
  );

  it('accepts serialized JSON content from proposal and materialization paths', () => {
    const content = { mimeType: 'image/png', data: image(PNG_SIGNATURE) };

    expect(validateImageSectionContent(JSON.stringify(content))).toEqual({
      success: true,
      canonicalContent: JSON.stringify(content),
    });
  });

  it('accepts an image of exactly the decoded byte cap', () => {
    const data = image(PNG_SIGNATURE, IMAGE_SECTION_MAX_DECODED_BYTES);

    expect(
      validateImageSectionContent({ mimeType: 'image/png', data }).success,
    ).toBe(true);
  });

  it.each([
    [
      'oversized image',
      {
        mimeType: 'image/png',
        data: image(PNG_SIGNATURE, IMAGE_SECTION_MAX_DECODED_BYTES + 1),
      },
      'exceeds 1000000 bytes',
    ],
    [
      'malformed base64',
      { mimeType: 'image/png', data: 'iVBORw0KGgo*' },
      'valid padded base64',
    ],
    [
      'mismatched MIME type',
      { mimeType: 'image/jpeg', data: image(PNG_SIGNATURE) },
      'not a image/jpeg image',
    ],
    [
      'unsupported MIME type',
      { mimeType: 'image/gif', data: image(PNG_SIGNATURE) },
      'mimeType',
    ],
    ['empty image payload', { mimeType: 'image/png', data: '' }, 'non-empty'],
    [
      'extra properties',
      { mimeType: 'image/png', data: image(PNG_SIGNATURE), url: 'x' },
      'unexpected properties url',
    ],
    ['null placeholder content', null, 'expected an object'],
  ])('rejects %s', (_label, content, message) => {
    const result = registry.validate(definition, content);

    expect(result).toMatchObject({
      success: false,
      code: 'invalid_json_section',
      message: expect.stringContaining(message),
    });
  });

  it('never echoes image data in rejection messages', () => {
    const data = image(PNG_SIGNATURE);
    const result = validateImageSectionContent({
      mimeType: 'image/webp',
      data,
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(data);
  });

  it('validates each item independently so one bad image does not affect others', () => {
    const valid = { mimeType: 'image/png', data: image(PNG_SIGNATURE) };
    const results = [
      valid,
      { mimeType: 'image/png', data: '@@@@' },
      { mimeType: 'image/jpeg', data: image(JPEG_SIGNATURE) },
    ].map((content) => registry.validate(definition, content).success);

    expect(results).toEqual([true, false, true]);
  });
});
