import crypto from 'node:crypto';

export const toBuffer = (value: string): Buffer => Buffer.from(value, 'utf8');

export const zeroBuffer = (buffer?: Buffer | null): void => {
  if (!buffer) return;
  buffer.fill(0);
};

export const randomBytes = (size: number): Buffer => crypto.randomBytes(size);

export const pbkdf2Async = (
  password: Buffer,
  salt: Buffer,
  iterations: number,
  keylen: number,
  digest: string,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, keylen, digest, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
