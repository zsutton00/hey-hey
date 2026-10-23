import type {
  PasswordChangeCredentialId,
  PasswordChangeCredentialIdentifier,
  PrivateBetaAccessRequestId,
  UserId,
} from '../types';
import type { AnyTransactionClient } from '../prisma/prisma.service';
import type { BrowserSessionRequestMetadata } from './browser-session.types';

export const PASSWORD_CHANGE_CREDENTIAL_ISSUER = Symbol(
  'PASSWORD_CHANGE_CREDENTIAL_ISSUER',
);

export const PasswordChangeCredentialKind = {
  RequiredChange: 'REQUIRED_CHANGE',
  AccountRecovery: 'ACCOUNT_RECOVERY',
} as const;

export type PasswordChangeCredentialKind =
  (typeof PasswordChangeCredentialKind)[keyof typeof PasswordChangeCredentialKind];

export interface PasswordChangeCredentialIssuer {
  issueInTransaction(
    tx: AnyTransactionClient,
    userId: UserId,
    issuanceKind: PasswordChangeCredentialKind,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<string>;
  issueIdempotentlyInTransaction(
    tx: AnyTransactionClient,
    userId: UserId,
    requestId: PrivateBetaAccessRequestId,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<string>;
}

export interface IssuePasswordChangeCredentialOperation {
  id: PasswordChangeCredentialId;
  credentialId: PasswordChangeCredentialIdentifier;
  userId: UserId;
  issuanceKind: PasswordChangeCredentialKind;
  issuedAt: Date;
  expiresAt: Date | null;
  requestMetadata: BrowserSessionRequestMetadata;
}

export interface IssuedPasswordChangeCredential {
  id: PasswordChangeCredentialId;
  credentialId: PasswordChangeCredentialIdentifier;
  userId: UserId;
  issuedAt: Date;
  expiresAt: Date | null;
}

export interface ConsumePasswordChangeCredentialOperation {
  credentialId: PasswordChangeCredentialIdentifier;
  requestMetadata: BrowserSessionRequestMetadata;
}

export type PasswordChangeCredentialConsumptionResult =
  | {
      status: 'consumed';
      id: PasswordChangeCredentialId;
      userId: UserId;
      issuanceKind: PasswordChangeCredentialKind;
      consumedAt: Date;
    }
  | {
      status: 'not_found' | 'expired' | 'already_consumed' | 'revoked';
    };
