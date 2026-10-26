import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { TemplateCloneRemapper } from '../template-clone-remapper';

describe('Template clone failure diagnostics', () => {
  afterEach(() => jest.restoreAllMocks());

  it('locates a missing mention inside serialized content without logging the body', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const remap = new TemplateCloneRemapper();
    const missing = randomUUID();
    remap.diagnosticContext = {
      stage: 'record-copy',
      sourceTable: 'taskSection',
      sourceRecordId: randomUUID(),
    };
    expect(() =>
      remap.rewrite({
        content: JSON.stringify({
          items: [{ body: `Private prose @[task:${missing}|Private title]` }],
        }),
      }),
    ).toThrow('Template clone contains an unmapped reference');
    expect(error).toHaveBeenCalledWith(
      'Template clone contains an unmapped reference',
      expect.objectContaining({
        ...remap.diagnosticContext,
        fieldPath: '$.content[json].items[0].body',
        referenceKind: 'mention',
        unmappedReferenceId: missing,
      }),
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('Private');
  });

  it('redacts arbitrary values mistaken for identifiers and still rejects them', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const remap = new TemplateCloneRemapper();
    expect(() => remap.rewrite({ providerId: 'secret-payload' })).toThrow(
      'unmapped reference',
    );
    expect(error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        fieldPath: '$.providerId',
        unmappedReferenceId: '[redacted non-UUID identifier]',
      }),
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret-payload');
  });
});

describe('Template clone of dispatched agent triggers', () => {
  it('keeps a trigger operationId so the copied trigger stays dispatched', () => {
    const remap = new TemplateCloneRemapper();
    const messageId = randomUUID();
    const operationId = randomUUID();
    const copiedMessageId = remap.allocate(messageId);
    const copy = remap.rewrite({
      id: messageId,
      data: { triggersAgent: { operationId, messageId, nodeId: 'refine' } },
    });
    expect(copy).toEqual({
      id: copiedMessageId,
      data: {
        triggersAgent: {
          operationId,
          messageId: copiedMessageId,
          nodeId: 'refine',
        },
      },
    });
  });
});
