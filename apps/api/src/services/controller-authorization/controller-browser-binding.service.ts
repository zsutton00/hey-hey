import { ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { AnyTransactionClient } from '../../prisma/prisma.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { OrganizationId, UserId } from '../../types';

const CONTROLLER_BINDING_SECRET_BYTES = 32;
export const CONTROLLER_BROWSER_IDENTITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface ControllerBindingIdentity {
  controllerInstallationId: string;
  controllerCredentialId: string;
  controllerCredentialPublicId: string;
  machineId: string;
  userId: UserId;
  organizationId: OrganizationId;
  expiresAt: Date;
}

export interface IssuedControllerBinding {
  secret: string;
  expiresAt: Date;
}

export interface PendingControllerBinding extends IssuedControllerBinding {
  credentialHash: string;
  issuedAt: Date;
}

@Injectable()
export class ControllerBrowserBindingService {
  constructor(private readonly prisma: PrismaService) {}

  issuePending(now = new Date()): PendingControllerBinding {
    const secret = randomBytes(CONTROLLER_BINDING_SECRET_BYTES).toString(
      'base64url',
    );
    return {
      secret,
      credentialHash: this.hash(secret),
      issuedAt: now,
      expiresAt: new Date(now.getTime() + CONTROLLER_BROWSER_IDENTITY_TTL_MS),
    };
  }

  async activatePending(
    tx: AnyTransactionClient,
    pending: {
      credentialHash: string;
      issuedAt: Date;
      expiresAt: Date;
    },
    identity: Omit<
      ControllerBindingIdentity,
      'controllerCredentialPublicId' | 'machineId' | 'expiresAt'
    >,
    now: Date,
  ): Promise<void> {
    if (pending.expiresAt.getTime() <= now.getTime()) {
      throw new ForbiddenException('Controller browser identity has expired');
    }

    await tx.controllerBrowserBinding.updateMany({
      where: {
        controllerInstallationId: identity.controllerInstallationId,
        controllerCredentialId: identity.controllerCredentialId,
        userId: identity.userId,
        organizationId: identity.organizationId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        revocationReason: 'ROTATED',
        updatedAt: now,
      },
    });
    await tx.controllerBrowserBinding.create({
      data: {
        credentialHash: pending.credentialHash,
        ...identity,
        issuedAt: pending.issuedAt,
        expiresAt: pending.expiresAt,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  async issueOrRotate(
    tx: AnyTransactionClient,
    identity: Omit<
      ControllerBindingIdentity,
      'controllerCredentialPublicId' | 'machineId'
    >,
    now: Date,
  ): Promise<IssuedControllerBinding> {
    if (identity.expiresAt.getTime() <= now.getTime()) {
      throw new ForbiddenException('Controller authorization has expired');
    }

    const secret = randomBytes(CONTROLLER_BINDING_SECRET_BYTES).toString(
      'base64url',
    );
    const credentialHash = this.hash(secret);

    await tx.controllerBrowserBinding.updateMany({
      where: {
        controllerInstallationId: identity.controllerInstallationId,
        controllerCredentialId: identity.controllerCredentialId,
        userId: identity.userId,
        organizationId: identity.organizationId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        revocationReason: 'ROTATED',
        updatedAt: now,
      },
    });

    await tx.controllerBrowserBinding.create({
      data: {
        credentialHash,
        controllerInstallationId: identity.controllerInstallationId,
        controllerCredentialId: identity.controllerCredentialId,
        userId: identity.userId,
        organizationId: identity.organizationId,
        issuedAt: now,
        expiresAt: identity.expiresAt,
        createdAt: now,
        updatedAt: now,
      },
    });

    return { secret, expiresAt: identity.expiresAt };
  }

  async resolveForAdmission(params: {
    secret: string | undefined;
    userId: UserId;
    organizationId?: OrganizationId;
    now?: Date;
    required?: boolean;
  }): Promise<ControllerBindingIdentity | null> {
    if (!params.secret) {
      if (params.required) this.deny();
      return null;
    }

    const now = params.now ?? new Date();
    const credentialHash = this.hash(params.secret);
    const binding = await this.prisma.db.controllerBrowserBinding.findUnique({
      where: { credentialHash },
      include: { controllerCredential: true },
    });

    if (!binding) {
      if (params.required) this.deny();
      return null;
    }
    if (
      binding.userId !== params.userId ||
      (params.organizationId !== undefined &&
        binding.organizationId !== params.organizationId)
    ) {
      this.deny();
    }
    if (
      binding.expiresAt.getTime() <= now.getTime() ||
      binding.revokedAt !== null ||
      binding.controllerCredential.revokedAt !== null ||
      binding.controllerCredential.userId !== binding.userId ||
      binding.controllerCredential.organizationId !== binding.organizationId ||
      binding.controllerCredential.controllerInstallationId !==
        binding.controllerInstallationId
    ) {
      if (params.required) this.deny();
      return null;
    }

    const touched = await this.prisma.db.controllerBrowserBinding.updateMany({
      where: {
        id: binding.id,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { lastUsedAt: now, updatedAt: now },
    });
    if (touched.count !== 1) this.deny();

    return {
      controllerInstallationId: binding.controllerInstallationId,
      controllerCredentialId: binding.controllerCredentialId,
      controllerCredentialPublicId: binding.controllerCredential.credentialId,
      machineId: binding.controllerCredential.machineId,
      userId: binding.userId as UserId,
      organizationId: binding.organizationId as OrganizationId,
      expiresAt: binding.expiresAt,
    };
  }

  async resolveForSelection(params: {
    secret: string | undefined;
    userId: UserId;
    organizationId?: OrganizationId;
  }): Promise<ControllerBindingIdentity | null> {
    if (!params.secret) return null;
    const binding = await this.prisma.db.controllerBrowserBinding.findUnique({
      where: { credentialHash: this.hash(params.secret) },
      include: { controllerCredential: true },
    });
    if (!binding) return null;
    if (
      binding.userId !== params.userId ||
      (params.organizationId !== undefined &&
        binding.organizationId !== params.organizationId) ||
      binding.revokedAt !== null ||
      binding.controllerCredential.revokedAt !== null ||
      binding.controllerCredential.userId !== binding.userId ||
      binding.controllerCredential.organizationId !== binding.organizationId ||
      binding.controllerCredential.controllerInstallationId !==
        binding.controllerInstallationId
    ) {
      this.deny();
    }
    return {
      controllerInstallationId: binding.controllerInstallationId,
      controllerCredentialId: binding.controllerCredentialId,
      controllerCredentialPublicId: binding.controllerCredential.credentialId,
      machineId: binding.controllerCredential.machineId,
      userId: binding.userId as UserId,
      organizationId: binding.organizationId as OrganizationId,
      expiresAt: binding.expiresAt,
    };
  }

  private hash(secret: string): string {
    return createHash('sha256').update(secret, 'utf8').digest('hex');
  }

  private deny(): never {
    throw new ForbiddenException('Controller browser binding is invalid');
  }
}
