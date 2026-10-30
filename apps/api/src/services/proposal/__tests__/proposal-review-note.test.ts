import { parseProposalReviewNote } from '../proposal-review-note';

const review = {
  noteId: '10000000-0000-4000-8000-000000000001',
  frozenRevision: 4,
  sectionKey: 'mockup',
  sizeKey: 'desktop',
  target: { type: 'position', x: 0.25, y: 0.75, sizeKey: 'desktop' },
  note: 'Make the primary action clearer',
};

describe('frozen screen review note boundary', () => {
  it('preserves the exact reviewed target, presentation size and revision', () => {
    expect(parseProposalReviewNote(review)).toEqual(review);
  });

  it('accepts structured component annotations through the same boundary', () => {
    const component = {
      ...review,
      target: { type: 'component', componentId: 'submit-button' },
    };
    expect(parseProposalReviewNote(component)).toEqual(component);
  });

  it.each([
    { ...review, frozenRevision: 0 },
    { ...review, note: '' },
    { ...review, target: { type: 'unknown', x: 0.25, y: 0.75 } },
  ])('rejects contract-invalid untrusted review input', (input) => {
    expect(() => parseProposalReviewNote(input)).toThrow('OpenAPI contract');
  });
});
