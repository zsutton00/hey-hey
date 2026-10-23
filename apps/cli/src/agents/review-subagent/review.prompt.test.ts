import { describe, expect, it } from 'vitest';
import { buildReviewPrompt } from '../prompts/review';
describe('shared Review explanation prompt', () => {
  it('keeps the complete prompt stable without prerequisite messages or reports', () => {
    expect(buildReviewPrompt({ touchedFiles: [] })).toMatchSnapshot();
  });
});
