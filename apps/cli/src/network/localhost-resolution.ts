import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';

type LookupCallback =
  | ((error: NodeJS.ErrnoException | null, address: string, family: number) => void)
  | ((error: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void);

// Browsers resolve *.localhost to loopback without OS DNS configuration.
// Keep the request URL intact (including Host and WebAuthn origins), and give
// Node's HTTP clients the same loopback resolution for local development.
export const installLocalhostResolution = (): void => {
  dns.lookup = new Proxy(dns.lookup, {
    apply(target, receiver, args: [string, ...Array<number | dns.LookupOptions | LookupCallback>]) {
      const [hostname, ...rest] = args;
      const normalized = hostname.toLowerCase().replace(/\.$/, '');
      if (!normalized.endsWith('.localhost')) {
        return Reflect.apply(target, receiver, args);
      }
      const options = rest[0];
      const family = typeof options === 'number'
        ? options
        : typeof options === 'object' ? options.family : undefined;
      return Reflect.apply(target, receiver, [family === 6 ? '::1' : '127.0.0.1', ...rest]);
    },
  });
  syncBuiltinESMExports();
};
