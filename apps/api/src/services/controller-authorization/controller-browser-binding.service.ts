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

export interface ControllerBindingInventoryEntry
  extends ControllerBindingIdentity {
  revoked: boolean;
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

    const context = await tx.controllerBrowserContext.findUnique({
      where: { credentialHash: pending.credentialHash },
    });
    if (
      !context ||
      context.userId !== identity.userId ||
      context.revokedAt ||
      context.expiresAt <= now
    ) {
      this.deny();
    }
    const liveContexts =
      await tx.$queryRaw`SELECT id FROM controller_browser_contexts WHERE id = ${context.id}::uuid AND revoked_at IS NULL AND expires_at > ${now} FOR UPDATE`;
    if (liveContexts.length !== 1) {
      this.deny();
    }
    // Only a verified enrollment or fresh assertion may renew context retention.
    // Cookie reads and account-session refresh never extend its server lifetime.
    await tx.controllerBrowserContext.update({
      where: { id: context.id },
      data: {
        expiresAt: new Date(
          Math.max(
            context.expiresAt.getTime(),
            now.getTime() + CONTROLLER_BROWSER_IDENTITY_TTL_MS,
          ),
        ),
      },
    });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity.controllerInstallationId + ':' + identity.controllerCredentialId}, 0))`;
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
        browserContextId: context.id,
        credentialHash: this.issuePending().credentialHash,
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
    presentedSecret?: string,
  ): Promise<IssuedControllerBinding> {
    if (identity.expiresAt.getTime() <= now.getTime()) {
      throw new ForbiddenException('Controller authorization has expired');
    }

    const contextBinding = await this.ensureContext(
      presentedSecret,
      identity.userId,
      tx,
    );
    if (presentedSecret && contextBinding.secret !== presentedSecret) {
      this.deny();
    }
    const secret = contextBinding.secret;
    const context = await tx.controllerBrowserContext.findUniqueOrThrow({
      where: { credentialHash: this.hash(secret) },
    });
    const liveContexts =
      await tx.$queryRaw`SELECT id FROM controller_browser_contexts WHERE id = ${context.id}::uuid AND revoked_at IS NULL AND expires_at > ${now} FOR UPDATE`;
    if (liveContexts.length !== 1) {
      this.deny();
    }
    const credentialHash = this.issuePending().credentialHash;

    // Only a verified enrollment or fresh assertion may renew context retention.
    // Cookie reads and account-session refresh never extend its server lifetime.
    await tx.controllerBrowserContext.update({
      where: { id: context.id },
      data: {
        expiresAt: new Date(
          Math.max(
            context.expiresAt.getTime(),
            now.getTime() + CONTROLLER_BROWSER_IDENTITY_TTL_MS,
          ),
        ),
      },
    });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity.controllerInstallationId + ':' + identity.controllerCredentialId}, 0))`;
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
        browserContextId: context.id,
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

  async ensureContext(
    secret: string | undefined,
    userId: UserId,
    tx?: AnyTransactionClient,
  ): Promise<IssuedControllerBinding> {
    if (!tx) {
      return this.prisma.db.$transaction((transaction) =>
        this.ensureContext(secret, userId, transaction),
      );
    }
    const pending = this.issuePending();
    const credentialHash = secret ? this.hash(secret) : pending.credentialHash;
    const existing = secret
      ? await tx.controllerBrowserContext.findUnique({
          where: { credentialHash },
        })
      : null;
    if (
      existing &&
      existing.userId === userId &&
      !existing.revokedAt &&
      existing.expiresAt > new Date()
    ) {
      return { secret: secret!, expiresAt: existing.expiresAt };
    }
    const legacy = secret
      ? await tx.controllerBrowserBinding.findUnique({
          where: { credentialHash },
          include: { controllerCredential: true },
        })
      : null;
    const adoptLegacy =
      legacy &&
      legacy.userId === userId &&
      !legacy.revokedAt &&
      !legacy.controllerCredential.revokedAt &&
      legacy.controllerCredential.userId === userId &&
      legacy.controllerCredential.organizationId === legacy.organizationId &&
      legacy.controllerCredential.controllerInstallationId ===
        legacy.controllerInstallationId &&
      !existing;
    const context = await tx.controllerBrowserContext.upsert({
      where: {
        credentialHash: adoptLegacy ? credentialHash : pending.credentialHash,
      },
      create: {
        credentialHash: adoptLegacy ? credentialHash : pending.credentialHash,
        userId,
        expiresAt: pending.expiresAt,
      },
      update: {},
    });
    if (adoptLegacy) {
      const adopted = await tx.controllerBrowserBinding.updateMany({
        where: {
          id: legacy.id,
          revokedAt: null,
          controllerCredential: { revokedAt: null },
        },
        data: { browserContextId: context.id },
      });
      if (adopted.count !== 1) {
        this.deny();
      }
    }
    return {
      secret: adoptLegacy ? secret! : pending.secret,
      expiresAt: pending.expiresAt,
    };
  }

  async resolveInventory(params: {
    secret: string | undefined;
    userId: UserId;
    organizationId?: OrganizationId;
  }): Promise<{
    hasIdentity: boolean;
    bindings: ControllerBindingInventoryEntry[];
  }> {
    if (!params.secret) {
      return { hasIdentity: false, bindings: [] };
    }
    const credentialHash = this.hash(params.secret);
    const context = await this.prisma.db.controllerBrowserContext.findUnique({
      where: { credentialHash },
    });
    if (
      context &&
      (context.userId !== params.userId ||
        context.revokedAt ||
        context.expiresAt <= new Date())
    ) {
      return { hasIdentity: false, bindings: [] };
    }
    const bindings = await this.prisma.db.controllerBrowserBinding.findMany({
      where: context ? { browserContextId: context.id } : { credentialHash },
      include: { controllerCredential: true },
    });
    const result: ControllerBindingInventoryEntry[] = [];
    for (const binding of bindings) {
      const credential = binding.controllerCredential;
      if (binding.userId !== params.userId) {
        continue;
      }
      if (
        params.organizationId &&
        binding.organizationId !== params.organizationId
      ) {
        continue;
      }
      if (
        credential.userId !== binding.userId ||
        credential.organizationId !== binding.organizationId ||
        credential.controllerInstallationId !== binding.controllerInstallationId
      ) {
        continue;
      }
      result.push({
        revoked: binding.revokedAt !== null || credential.revokedAt !== null,
        controllerInstallationId: binding.controllerInstallationId,
        controllerCredentialId: binding.controllerCredentialId,
        controllerCredentialPublicId: credential.credentialId,
        machineId: credential.machineId,
        userId: params.userId,
        organizationId: binding.organizationId as OrganizationId,
        expiresAt: binding.expiresAt,
      });
    }
    return {
      hasIdentity: context !== null || result.length > 0,
      bindings: result,
    };
  }

  async resolveAllForSelection(params: {
    secret: string | undefined;
    userId: UserId;
    organizationId?: OrganizationId;
  }): Promise<ControllerBindingIdentity[]> {
    const inventory = await this.resolveInventory(params);
    return inventory.bindings.filter((binding) => !binding.revoked);
  }

  async resolveForSelection(params: {
    secret: string | undefined;
    userId: UserId;
    organizationId?: OrganizationId;
    machineId?: string;
    controllerCredentialId?: string;
  }): Promise<ControllerBindingIdentity | null> {
    const bindings = await this.resolveAllForSelection(params);
    const candidates = bindings.filter(
      (binding) =>
        (!params.machineId || binding.machineId === params.machineId) &&
        (!params.controllerCredentialId ||
          binding.controllerCredentialPublicId ===
            params.controllerCredentialId),
    );
    return candidates.length === 1 ? candidates[0]! : null;
  }

  async resolveForAdmission(params: {
    secret: string | undefined;
    userId: UserId;
    organizationId?: OrganizationId;
    machineId?: string;
    controllerCredentialId?: string;
    now?: Date;
    required?: boolean;
  }): Promise<ControllerBindingIdentity | null> {
    const binding = await this.resolveForSelection(params);
    if (
      !binding ||
      binding.expiresAt.getTime() <= (params.now ?? new Date()).getTime()
    ) {
      if (params.required) {
        this.deny();
      }
      return null;
    }
    const touched = await this.prisma.db.controllerBrowserBinding.updateMany({
      where: {
        OR: [
          {
            browserContext: {
              credentialHash: this.hash(params.secret!),
              userId: params.userId,
              revokedAt: null,
              expiresAt: { gt: params.now ?? new Date() },
            },
          },
          { browserContextId: null, credentialHash: this.hash(params.secret!) },
        ],
        controllerInstallationId: binding.controllerInstallationId,
        controllerCredentialId: binding.controllerCredentialId,
        userId: params.userId,
        organizationId: binding.organizationId,
        revokedAt: null,
        expiresAt: { gt: params.now ?? new Date() },
        controllerCredential: { revokedAt: null },
      },
      data: { lastUsedAt: params.now ?? new Date() },
    });
    if (touched.count !== 1) {
      this.deny();
    }
    return binding;
  }

  private hash(secret: string): string {
    return createHash('sha256').update(secret, 'utf8').digest('hex');
  }

  private deny(): never {
    throw new ForbiddenException('Controller browser binding is invalid');
  }
}
