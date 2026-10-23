import { describe, expect, it } from 'vitest';
import { parseOAuthCallback } from '../callback-server';

describe('parseOAuthCallback', () => {
  it('parses successful callback with code and state', () => {
    const result = parseOAuthCallback('/callback?code=abc123&state=xyz789');
    expect(result).toEqual({
      type: 'success',
      code: 'abc123',
      state: 'xyz789',
    });
  });

  it('parses error callback with error_description', () => {
    const result = parseOAuthCallback('/callback?error_description=Access%20denied');
    expect(result).toEqual({
      type: 'error',
      description: 'Access denied',
    });
  });

  it('returns invalid for missing code', () => {
    const result = parseOAuthCallback('/callback?state=xyz789');
    expect(result).toEqual({ type: 'invalid' });
  });

  it('returns invalid for missing state', () => {
    const result = parseOAuthCallback('/callback?code=abc123');
    expect(result).toEqual({ type: 'invalid' });
  });

  it('returns invalid for wrong path', () => {
    const result = parseOAuthCallback('/wrong?code=abc123&state=xyz789');
    expect(result).toEqual({ type: 'invalid' });
  });

  it('returns invalid for root path', () => {
    const result = parseOAuthCallback('/?code=abc123&state=xyz789');
    expect(result).toEqual({ type: 'invalid' });
  });
});
