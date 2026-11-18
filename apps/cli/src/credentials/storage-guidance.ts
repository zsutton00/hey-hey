import { isCredentialError, type CredentialErrorCode } from './errors';

const LINUX_DEFAULT_KEYRING_STEPS = [
  'Open "Passwords and Keys" from the application menu.',
  'If there is no keyring with a password, create one (File > New > Password Keyring), then choose a password.',
  'Right-click that keyring and choose "Set as default". Creating a keyring alone does not select it.',
  'Run the same heyhey command again. Nothing in Hey Hey or your existing keyrings was changed.',
  'Note: the default keyring is shared by every application that stores passwords on this account.',
];

/** Plain-language cause and next step for a protected-storage failure; never includes secrets. */
export const describeProtectedStorageProblem = (
  error: unknown,
  platform: NodeJS.Platform = process.platform,
): string => {
  const code: CredentialErrorCode | 'UNKNOWN' = isCredentialError(error) ? error.code : 'UNKNOWN';
  const reason = error instanceof Error ? error.message : String(error);

  switch (code) {
    case 'DEFAULT_COLLECTION_MISSING':
      return [
        `Protected storage has no usable default keyring (${reason}).`,
        ...LINUX_DEFAULT_KEYRING_STEPS.map((step, index) => `  ${String(index + 1)}. ${step}`),
      ].join('\n');
    case 'STORAGE_LOCKED':
      return `Protected storage is locked (${reason}). Unlock the default keyring when your desktop asks, then run this command again.`;
    case 'PERMISSION_DENIED':
      return `Access to protected storage was denied or dismissed (${reason}). Run this command again and approve the system prompt.`;
    case 'PLATFORM_UNAVAILABLE':
      return platform === 'linux'
        ? `Protected storage is unavailable (${reason}). Hey Hey needs a desktop session with a Secret Service such as GNOME Keyring or KWallet running; start it, then run this command again.`
        : `Protected storage is unavailable (${reason}).`;
    default:
      return `Protected storage failed (${code}: ${reason}). Your existing credentials were not changed; run this command again, and report this message if it persists.`;
  }
};
