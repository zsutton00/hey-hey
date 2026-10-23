import crypto from 'node:crypto';

export interface StoreKeyPayload {
  type: 'oauth';
  url: string;
  headers?: Record<string, string>;
}

const sha256Prefix = (value: string): string => {
  const hash = crypto.createHash('sha256').update(value).digest('hex');
  return hash.slice(0, 16);
};

export const computeStoreKey = (serverName: string, payload: StoreKeyPayload): string => {
  const normalized = JSON.stringify({
    type: payload.type,
    url: payload.url,
    headers: payload.headers ?? {},
  });
  const truncated = sha256Prefix(normalized);
  return `${serverName}|${truncated}`;
};
