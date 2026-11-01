import { randomUUID } from 'crypto';
import { TemplateCloneRemapper } from '../template-clone-remapper';

describe('Template clone references outside the template', () => {
  it('leaves values that are not copied records untouched, wherever they appear', () => {
    const remap = new TemplateCloneRemapper();
    const outside = randomUUID();
    const body = `Prose @[task:${outside}|Elsewhere]`;
    const record = {
      providerId: 'not-a-record',
      serviceIds: [outside],
      content: JSON.stringify({ items: [{ body }] }),
    };
    expect(remap.rewrite(record)).toEqual(record);
  });

  it('translates copied records by exact identity, whatever the field is called', () => {
    const remap = new TemplateCloneRemapper();
    const task = randomUUID();
    const copy = remap.allocate(task);
    expect(
      remap.rewrite({
        about: task,
        body: `See @[task:${task}|Capability]`,
      }),
    ).toEqual({ about: copy, body: `See @[task:${copy}|Capability]` });
  });

  it('drops references to template records withheld from the copy', () => {
    const remap = new TemplateCloneRemapper();
    const withheld = randomUUID();
    remap.withheld.add(withheld);
    expect(
      remap.rewrite({
        conversationId: withheld,
        body: `See @[conversation:${withheld}|Old chat]`,
      }),
    ).toEqual({ conversationId: null, body: 'See Old chat' });
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
