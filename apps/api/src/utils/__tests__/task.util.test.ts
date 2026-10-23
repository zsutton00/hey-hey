import { getNextStatus } from '../work-item.util';

describe('task.util getNextStatus', () => {
  it('returns refining description after generating description without skipping', () => {
    expect(getNextStatus('GENERATING_DESCRIPTION')).toBe(
      'REFINING_DESCRIPTION',
    );
  });

  it('returns refining details after generating details', () => {
    expect(getNextStatus('GENERATING_DETAILS')).toBe('REFINING_DETAILS');
    expect(getNextStatus('GENERATING_DESCRIPTION_AND_DETAILS')).toBe(
      'REFINING_DETAILS',
    );
  });

  it('returns refining acceptance criteria after generating acceptance content', () => {
    expect(getNextStatus('GENERATING_ACCEPTANCE_CRITERIA')).toBe(
      'REFINING_ACCEPTANCE_CRITERIA',
    );
    expect(getNextStatus('GENERATING_ALL')).toBe(
      'REFINING_ACCEPTANCE_CRITERIA',
    );
  });

  it('continues normal refinement progression for non-generating statuses', () => {
    expect(getNextStatus('REFINING_DESCRIPTION')).toBe('REFINING_DETAILS');
    expect(getNextStatus('REFINING_DETAILS')).toBe(
      'REFINING_ACCEPTANCE_CRITERIA',
    );
    expect(getNextStatus('REFINING_ACCEPTANCE_CRITERIA')).toBe('ACTIVE');
  });
});
