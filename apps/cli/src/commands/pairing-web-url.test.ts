import { describe, expect, it } from 'vitest';

import { resolvePairingUrl, resolvePairingWebOrigin } from './pairing-web-url';

describe('pairing web URL', () => {
  it('uses the production origin by default', () => {
    expect(resolvePairingWebOrigin({})).toBe('https://heyhey.dev');
    expect(resolvePairingUrl(undefined, {})).toBe('https://heyhey.dev/pairing');
    expect(resolvePairingUrl('BCDFG-HJKLM', {})).toBe(
      'https://heyhey.dev/pairing?code=BCDFG-HJKLM',
    );
    expect(resolvePairingUrl('BCDFG-HJKLM', {}, 'add-controller')).toBe(
      'https://heyhey.dev/add-controller?code=BCDFG-HJKLM',
    );
  });

  it('uses the local web app when the CLI targets the local API', () => {
    const env = { HEYHEY_API_URL: 'http://localhost:3000/api/v1/' };

    expect(resolvePairingWebOrigin(env)).toBe('http://localhost:5173');
    expect(resolvePairingUrl('BCDFG HJKLM', env)).toBe(
      'http://localhost:5173/pairing?code=BCDFG+HJKLM',
    );
    expect(resolvePairingUrl('BCDFG HJKLM', env, 'add-controller')).toBe(
      'http://localhost:5173/add-controller?code=BCDFG+HJKLM',
    );
  });

  it('uses an explicit deployment override and normalizes it to an origin', () => {
    const env = {
      HEYHEY_API_URL: 'http://localhost:3000',
      HEYHEY_WEB_ORIGIN: 'https://staging.heyhey.dev/some/path',
    };

    expect(resolvePairingWebOrigin(env)).toBe('https://staging.heyhey.dev');
    expect(resolvePairingUrl('BCDFG+HJKLM', env)).toBe(
      'https://staging.heyhey.dev/pairing?code=BCDFG%2BHJKLM',
    );
    expect(resolvePairingUrl('BCDFG+HJKLM', env, 'add-controller')).toBe(
      'https://staging.heyhey.dev/add-controller?code=BCDFG%2BHJKLM',
    );
  });
});
