import { describe, expect, it } from 'vitest';
import { base64UrlDecode, extractOrganizationIdFromToken, extractUserIdFromToken } from './token-utils';

// JWT fixtures: header.payload.sig — signature is fake but decoding only inspects the payload segment.
const TOKEN = {
  userBySub: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.sig',
  userByUserId: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTQ1NiJ9.sig',
  orgByOrgId: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1MSIsIm9yZ0lkIjoib3JnLWFiYyJ9.sig',
  orgByMemberships:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1MSIsIm9yZ01lbWJlcnNoaXBzIjpbeyJvcmdJZCI6Im9yZy1tZW1iZXJzaGlwLTEifV19.sig',
} as const;

describe('base64UrlDecode', () => {
  it('decodes a base64url-encoded string', () => {
    const encoded = Buffer.from('{"hello":"world"}').toString('base64url');
    expect(base64UrlDecode(encoded)).toBe('{"hello":"world"}');
  });

  it('handles standard base64 padding differences', () => {
    // length % 4 === 1 after replace — requires 2 padding chars
    const encoded = Buffer.from('ab').toString('base64url');
    expect(base64UrlDecode(encoded)).toBe('ab');
  });

  it('returns null for an empty string', () => {
    expect(base64UrlDecode('')).toBeNull();
  });
});

describe('extractUserIdFromToken', () => {
  it('extracts userId from sub claim', () => {
    expect(extractUserIdFromToken(TOKEN.userBySub)).toBe('user-123');
  });

  it('falls back to userId claim when sub is absent', () => {
    expect(extractUserIdFromToken(TOKEN.userByUserId)).toBe('user-456');
  });

  it('returns null for a malformed token', () => {
    expect(extractUserIdFromToken('not.a.token.at.all')).toBeNull();
  });

  it('returns null for an empty payload', () => {
    const empty = [
      Buffer.from('{}').toString('base64url'),
      Buffer.from('{}').toString('base64url'),
      'sig',
    ].join('.');
    expect(extractUserIdFromToken(empty)).toBeNull();
  });
});

describe('extractOrganizationIdFromToken', () => {
  it('extracts orgId claim', () => {
    expect(extractOrganizationIdFromToken(TOKEN.orgByOrgId)).toBe('org-abc');
  });

  it('falls back to orgMemberships when top-level org fields are absent', () => {
    expect(extractOrganizationIdFromToken(TOKEN.orgByMemberships)).toBe('org-membership-1');
  });

  it('returns null for a token with no org information', () => {
    expect(extractOrganizationIdFromToken(TOKEN.userBySub)).toBeNull();
  });
});
