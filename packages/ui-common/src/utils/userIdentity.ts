const LOCAL_ACCOUNT_EMAIL_PATTERN = /^local-[a-f0-9]{64}@local\.invalid$/;

export const isLocalAccountEmail = (email: string): boolean =>
  LOCAL_ACCOUNT_EMAIL_PATTERN.test(email);

export const formatUserIdentity = (identity: {
  name: string;
  email: string;
  isLocalAccount?: boolean;
}): string =>
  identity.isLocalAccount || isLocalAccountEmail(identity.email)
    ? identity.name
    : `${identity.name} (${identity.email})`;
