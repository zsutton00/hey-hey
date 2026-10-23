import { validateWorkItemHtmlCssContent } from '../work-item-html-css.validator';

const annotation = {
  id: '10000000-0000-4000-8000-000000000001',
  note: 'Keep the primary action visible.',
  author: {
    type: 'human' as const,
    userId: '10000000-0000-4000-8000-000000000002',
  },
  category: 'suggestion' as const,
  lifecycle: 'open' as const,
  authoredProposalId: '20000000-0000-4000-8000-000000000001',
  authoredSizeKey: 'desktop',
  target: {
    type: 'position' as const,
    x: 0.25,
    y: 0.75,
    sizeKey: 'desktop',
  },
};

describe('validateWorkItemHtmlCssContent', () => {
  const sizeKeys = new Set(['desktop', 'mobile']);

  it('keeps the review sidecar optional for existing HTML/CSS content', () => {
    const result = validateWorkItemHtmlCssContent(
      { html: '<main>Preview</main>', css: '' },
      sizeKeys,
    );

    expect(result).toEqual({
      success: true,
      canonicalContent: '{"html":"<main>Preview</main>","css":""}',
    });
  });

  it('round-trips typed position and element annotations', () => {
    const content = {
      html: '<main data-hh-id="hero">Preview</main>',
      css: '',
      sizeKey: 'desktop',
      annotations: [
        annotation,
        {
          ...annotation,
          id: '10000000-0000-4000-8000-000000000003',
          target: { type: 'element' as const, nodeId: 'hero' },
        },
      ],
    };

    const result = validateWorkItemHtmlCssContent(content, sizeKeys);

    expect(result).toEqual({
      success: true,
      canonicalContent: JSON.stringify(content),
    });
  });

  it.each([
    [{ ...annotation, id: 'not-a-uuid' }, ['annotations', 0, 'id']],
    [{ ...annotation, note: '' }, ['annotations', 0, 'note']],
    [
      { ...annotation, target: { ...annotation.target, x: 1.1 } },
      ['annotations', 0, 'target', 'x'],
    ],
    [
      { ...annotation, authoredSizeKey: 'watch' },
      ['annotations', 0, 'authoredSizeKey'],
    ],
    [
      {
        ...annotation,
        target: { ...annotation.target, sizeKey: 'watch' },
      },
      ['annotations', 0, 'target', 'sizeKey'],
    ],
    [
      { ...annotation, target: { type: 'element', nodeId: '' } },
      ['annotations', 0, 'target', 'nodeId'],
    ],
  ])('rejects malformed annotation sidecars %#', (invalid, path) => {
    const result = validateWorkItemHtmlCssContent(
      { html: '<main />', css: '', annotations: [invalid] },
      sizeKeys,
    );

    expect(result).toMatchObject({ success: false, path });
  });

  it('rejects duplicate annotation identities', () => {
    const result = validateWorkItemHtmlCssContent(
      { html: '<main />', css: '', annotations: [annotation, annotation] },
      sizeKeys,
    );

    expect(result).toMatchObject({
      success: false,
      path: ['annotations', 1, 'id'],
    });
  });
});
