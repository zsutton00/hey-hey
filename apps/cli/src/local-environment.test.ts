import { describe, expect, it } from 'vitest';

describe('local environment', () => {
  it('says hi', () => {
    expect('hi').toBe('hi');
  });
});
