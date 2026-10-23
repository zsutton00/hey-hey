import type { ConfigService } from '@nestjs/config';

/** Server-owned identity of the principal that owns every sandbox organization. */
export const DEMO_SYSTEM_USER_ID = 'demo-system';

/** Marks a password hash that no bcrypt comparison can ever match. */
export const UNUSABLE_PASSWORD_HASH = '!';

/** Status read the demo banner polls in the background; it never counts as use. */
export const DEMO_SANDBOX_STATUS_PATH = '/api/v1/demo-sandboxes/current';

export const DEMO_BINDING_COOKIE_NAME = 'demoSandboxBinding';
export const DEMO_BINDING_COOKIE_MAX_AGE_MILLISECONDS =
  30 * 24 * 60 * 60 * 1000;

export const DEMO_SANDBOX_INACTIVITY_TIMEOUT_SECONDS = 2 * 60 * 60;

/** Inactivity timeout from the environment, defaulting to two hours. */
export const resolveInactivityTimeoutSeconds = (
  config: ConfigService,
): number => {
  const configured = config.get<string | number>(
    'DEMO_SANDBOX_INACTIVITY_TIMEOUT_SECONDS',
  );
  if (configured === undefined || configured === '') {
    return DEMO_SANDBOX_INACTIVITY_TIMEOUT_SECONDS;
  }
  const seconds = Number(configured);
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new Error(
      'DEMO_SANDBOX_INACTIVITY_TIMEOUT_SECONDS must be a positive integer',
    );
  }
  return seconds;
};

/** How long an attempt may stay PROVISIONING before it is discarded. */
export const DEFAULT_PROVISIONING_DEADLINE_SECONDS = 120;
export const READINESS_POLL_INTERVAL_MILLISECONDS = 1_000;

/** Demo-specific versions of the documents a visitor agrees to or acknowledges. */
export const DEMO_TERMS_DOCUMENT = {
  documentKind: 'TERMS',
  version: 'demo-1.0',
  effectiveDate: '2026-10-16',
  actionType: 'AGREED',
} as const;

export const DEMO_AGENT_BRIDGE_DOCUMENT = {
  documentKind: 'SECURITY',
  version: 'demo-1.0',
  effectiveDate: '2026-10-16',
  actionType: 'ACKNOWLEDGED',
} as const;

export const PROGRAM_STATE_ID = 'singleton';
