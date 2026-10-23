import type { RequestHandler } from 'express';
import type { KeyPairStore } from '../../credentials';
import { ChromeLaunchError } from '../../browser/chrome-launcher';
import { isAllowedBrowserUrl } from '../../browser/run-tabs';
import {
  LocalRunBrowserOpenErrorCode,
  type LocalStagedBrowserTabOpenErrorCode,
} from '../../shared/local-agent-api/generated/api';
import type { ServerLogger } from '../logger';

/**
 * Admission shared by the loopback Open browser operations: the Run-keyed open
 * and the pre-Run staged open. Their error enums share these codes.
 */
export type BrowserOpenAdmissionErrorCode = Extract<
  LocalRunBrowserOpenErrorCode,
  LocalStagedBrowserTabOpenErrorCode
>;

export interface BrowserOpenErrorBody {
  code: BrowserOpenAdmissionErrorCode;
  message: string;
}

const MAX_URL_LENGTH = 8_192;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const readNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** The URL to open, the start page when none was sent, or the typed reason it cannot be opened. */
export const readOpenUrl = (
  value: unknown,
  defaultUrl: string,
): { ok: true; url: string } | { ok: false; error: BrowserOpenErrorBody } => {
  if (value !== undefined && typeof value !== 'string')
    return {
      ok: false,
      error: {
        code: LocalRunBrowserOpenErrorCode.InvalidRequest,
        message: 'The URL must be text.',
      },
    };
  const url = readNonEmptyString(value) ?? defaultUrl;
  if (url.length > MAX_URL_LENGTH || !isAllowedBrowserUrl(url))
    return {
      ok: false,
      error: {
        code: LocalRunBrowserOpenErrorCode.UnsupportedUrl,
        message: 'Only http, https and about URLs can be opened.',
      },
    };
  return { ok: true, url };
};

export const createBrowserOpenCors = (
  allowedOrigins: readonly string[],
  logger: ServerLogger,
  blocked: { event: string; message: string },
): RequestHandler => {
  const allowed = new Set(allowedOrigins);
  return (request, response, next) => {
    const origin = request.get('origin');
    if (!origin) {
      next();
      return;
    }
    if (!allowed.has(origin)) {
      logger.warn(blocked.event, { origin });
      response.status(403).json({
        code: LocalRunBrowserOpenErrorCode.OriginNotAllowed,
        message: blocked.message,
      } satisfies BrowserOpenErrorBody);
      return;
    }
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') {
      response.status(204).end();
      return;
    }
    next();
  };
};

export type MachineAdmission =
  | { admitted: true }
  | {
      admitted: false;
      status: 409 | 503;
      body: BrowserOpenErrorBody;
      reason: string;
    };

/**
 * Being on loopback is the authorization: once the origin is approved, the
 * only remaining gate is that the requested machine is this paired CLI.
 */
export const admitMachine = async (
  keyPairStore: Pick<KeyPairStore, 'loadCurrentMachineId'>,
  requestedMachineId: string,
  onLoadFailure: (error: unknown) => void,
): Promise<MachineAdmission> => {
  let localMachineId: string | null;
  try {
    localMachineId = readNonEmptyString(await keyPairStore.loadCurrentMachineId());
  } catch (error) {
    onLoadFailure(error);
    localMachineId = null;
  }
  if (!localMachineId) {
    return {
      admitted: false,
      status: 503,
      body: {
        code: LocalRunBrowserOpenErrorCode.MachineIdUnavailable,
        message: 'The CLI paired-machine identity is unavailable.',
      },
      reason: 'machine_identity_unavailable',
    };
  }
  if (requestedMachineId !== localMachineId) {
    return {
      admitted: false,
      status: 409,
      body: {
        code: LocalRunBrowserOpenErrorCode.MachineMismatch,
        message: 'The requested machine does not match the locally paired CLI machine.',
      },
      reason: 'machine_mismatch',
    };
  }
  return { admitted: true };
};

/** Chrome launch failures say what the user must do, e.g. close a stuck window. */
export const openFailedMessage = (error: unknown): string =>
  error instanceof ChromeLaunchError ? error.message : 'The browser tab could not be opened.';
