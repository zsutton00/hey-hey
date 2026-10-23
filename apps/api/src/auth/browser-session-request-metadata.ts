import type { Request } from 'express';

import type { BrowserSessionRequestMetadata } from './browser-session.types';

const MAX_IP_ADDRESS_LENGTH = 45;
const MAX_USER_AGENT_LENGTH = 512;

export const extractBrowserSessionRequestMetadata = (
  request: Request,
): BrowserSessionRequestMetadata => {
  const userAgent = request.headers['user-agent'];
  const ipAddress = request.ip?.trim().slice(0, MAX_IP_ADDRESS_LENGTH);
  const boundedUserAgent =
    typeof userAgent === 'string'
      ? userAgent.trim().slice(0, MAX_USER_AGENT_LENGTH)
      : undefined;

  return {
    ...(ipAddress ? { ipAddress } : {}),
    ...(boundedUserAgent ? { userAgent: boundedUserAgent } : {}),
  };
};
