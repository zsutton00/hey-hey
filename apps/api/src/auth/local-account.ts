const LOCAL_ACCOUNT_EMAIL_PATTERN = /^local-[a-f0-9]{64}@local\.invalid$/;

export const isLocalAccountEmail = (email: string): boolean =>
  LOCAL_ACCOUNT_EMAIL_PATTERN.test(email);
