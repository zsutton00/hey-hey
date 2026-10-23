import dns from 'node:dns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installLocalhostResolution } from './localhost-resolution';

const originalLookup = dns.lookup;

afterEach(() => {
  dns.lookup = originalLookup;
  vi.restoreAllMocks();
});

describe('local development hostname resolution', () => {
  it('resolves a worktree hostname without changing the configured API URL', async () => {
    const apiUrl = new URL('http://dev.localhost:43753/api/oauth/token');
    installLocalhostResolution();
    const addresses = await new Promise<dns.LookupAddress[]>((resolve, reject) => {
      dns.lookup(apiUrl.hostname, { all: true }, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
    expect(addresses).toEqual([{ address: '127.0.0.1', family: 4 }]);
    expect(apiUrl.href).toBe('http://dev.localhost:43753/api/oauth/token');
  });

  it('honors explicit IPv6 lookup options', async () => {
    installLocalhostResolution();
    const address = await new Promise<string>((resolve, reject) => {
      dns.lookup('DEV.localhost.', { family: 6 }, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
    expect(address).toBe('::1');
  });

  it('delegates other hostnames and their errors to the original resolver', () => {
    const lookup = vi.spyOn(dns, 'lookup').mockImplementation(() => undefined);
    installLocalhostResolution();
    const callback = vi.fn();
    dns.lookup('dev.localhost.example.com', callback);
    expect(lookup).toHaveBeenCalledWith('dev.localhost.example.com', callback);
  });
});
