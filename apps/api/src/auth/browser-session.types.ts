import type { Prisma } from '@prisma/client';
import type { BrowserSessionResponseDto } from '../generated';

import type {
  BrowserSessionFamilyId,
  BrowserSessionId,
  RefreshGenerationId,
  RefreshGenerationNumber,
  RefreshSecretHash,
  UserId,
  OrganizationId,
} from '../types';

export interface BrowserSessionRequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}

export type BrowserSessionTransaction = Pick<
  Prisma.TransactionClient,
  'browserSessionFamily' | 'refreshGeneration' | '$queryRaw' | 'user'
>;

export interface CreateBrowserSessionOperation {
  userId: UserId;
  sessionId: BrowserSessionId;
  familyId: BrowserSessionFamilyId;
  refreshGenerationId: RefreshGenerationId;
  refreshSecretHash: RefreshSecretHash;
  createdAt: Date;
  inactivityExpiresAt: Date;
  absoluteExpiresAt: Date;
  requestMetadata: BrowserSessionRequestMetadata;
}

export interface CreatedBrowserSession {
  sessionId: BrowserSessionId;
  familyId: BrowserSessionFamilyId;
  refreshGenerationId: RefreshGenerationId;
  generation: RefreshGenerationNumber;
  inactivityExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface RotateBrowserSessionOperation {
  presentedSecretHash: RefreshSecretHash;
  replacementGenerationId: RefreshGenerationId;
  replacementSecretHash: RefreshSecretHash;
  requestMetadata: BrowserSessionRequestMetadata;
  requestedOrganizationId?: OrganizationId;
}

export interface RefreshBrowserSessionOperation {
  presentedSecret: string;
  requestMetadata: BrowserSessionRequestMetadata;
  requestedOrganizationId?: OrganizationId;
}

export type BrowserSessionRotationResult =
  | {
      status: 'rotated';
      response: BrowserSessionResponseDto;
      refreshSecret: string;
      userId: UserId;
      sessionId: BrowserSessionId;
      familyId: BrowserSessionFamilyId;
      generation: RefreshGenerationNumber;
      inactivityExpiresAt: Date;
      absoluteExpiresAt: Date;
    }
  | {
      status: 'replay_detected';
      userId: UserId;
      sessionId: BrowserSessionId;
      familyId: BrowserSessionFamilyId;
      generation: RefreshGenerationNumber;
    }
  | {
      status: 'not_found' | 'revoked' | 'inactive' | 'absolutely_expired';
    };

export interface RevokeBrowserSessionOperation {
  familyId: BrowserSessionFamilyId;
  revokedAt: Date;
  reason: string;
}

export interface RevokeUserBrowserSessionsOperation {
  userId: UserId;
  revokedAt: Date;
  reason: string;
}

export interface BrowserSessionRevocationResult {
  revokedFamilyIds: BrowserSessionFamilyId[];
  revokedSessionIds: BrowserSessionId[];
}

export interface LogoutBrowserSessionOperation {
  presentedRefreshSecret?: string;
  accessToken?: string;
  requestMetadata: BrowserSessionRequestMetadata;
}
