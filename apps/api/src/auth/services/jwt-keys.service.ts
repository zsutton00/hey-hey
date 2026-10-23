import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as jwt from 'jsonwebtoken';
import * as NodeRSA from 'node-rsa';
import * as path from 'path';
import * as crypto from 'crypto';
import { OrganizationId, ProjectId, UserId } from 'src/types';
import { ContextAuthContext, ContextAuthMembership } from '../types';
import { OrganizationRole } from 'src/generated';
import { errorToLoggable } from 'src/utils/logging.util';

export interface JWK {
  kty: string;
  use: string;
  kid: string;
  n: string;
  e: string;
  alg: string;
}

export interface JWKSResponse {
  keys: JWK[];
}

export const PROJECTION_DELETION_AUTHORIZATION = {
  GRAPH: {
    scope: 'organization:projection:delete',
    audience: 'graph-service',
  },
  EMBEDDINGS: {
    scope: 'organization:projection:delete',
    audience: 'embeddings-service',
  },
} as const;

export type ProjectionDeletionProvider =
  keyof typeof PROJECTION_DELETION_AUTHORIZATION;

export interface OrganizationClosureTokenContext {
  organizationId: OrganizationId;
  markerId: string;
  irreversibleClosureAt: Date;
  deletionDeadline: Date;
}

const PROJECTION_DELETION_TOKEN_MAX_LIFETIME_SECONDS = 5 * 60;

@Injectable()
export class JwtKeysService {
  private readonly logger = new Logger(JwtKeysService.name);
  private privateKey!: string;
  private publicKey!: string;
  private keyId: string;
  private keysPath: string;
  private readonly systemUserId: UserId;

  constructor(private configService: ConfigService) {
    this.keysPath = path.join(process.cwd(), 'config', 'keys');
    this.keyId = this.configService.get<string>('JWT_KEY_ID') || 'default-key';
    this.systemUserId = (this.configService.get<string>('SYSTEM_USER_ID') ||
      'system') as UserId;
    this.initializeKeys();
  }

  /**
   * Initialize the RSA key pair.
   *
   * Runtime configuration is preferred when available. Until deployment key
   * provisioning is ready, local development can continue using the ignored
   * on-disk pair or a newly generated pair.
   */
  private initializeKeys(): void {
    const privateKey = this.configService.get<string>('JWT_PRIVATE_KEY');
    const publicKey = this.configService.get<string>('JWT_PUBLIC_KEY');

    const hasPrivateKey = Boolean(privateKey?.trim());
    const hasPublicKey = Boolean(publicKey?.trim());

    if (hasPrivateKey !== hasPublicKey) {
      throw new Error(
        'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be provided together',
      );
    }

    if (privateKey && publicKey) {
      this.setKeys(privateKey, publicKey, 'environment variables');
      return;
    }

    if (this.loadKeysFromDisk()) {
      return;
    }

    this.generateKeys();
    this.saveKeysToDisk();
    this.logger.log('Generated new RSA keys (no runtime or disk keys found)');
  }

  private setKeys(privateKey: string, publicKey: string, source: string): void {
    this.validateKeyPair(privateKey, publicKey);
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.logger.log(`Loaded RSA keys from ${source}`);
  }

  private loadKeysFromDisk(): boolean {
    const privateKeyPath = path.join(this.keysPath, 'jwt-private.pem');
    const publicKeyPath = path.join(this.keysPath, 'jwt-public.pem');
    const hasPrivateKey = fs.existsSync(privateKeyPath);
    const hasPublicKey = fs.existsSync(publicKeyPath);

    if (!hasPrivateKey && !hasPublicKey) {
      return false;
    }

    if (hasPrivateKey !== hasPublicKey) {
      throw new Error(
        'JWT private and public key files must be provided together',
      );
    }

    let privateKey: string;
    let publicKey: string;
    try {
      privateKey = fs.readFileSync(privateKeyPath, 'utf8');
      publicKey = fs.readFileSync(publicKeyPath, 'utf8');
    } catch (error) {
      this.logger.error('Failed to load JWT keys from disk', error);
      throw new Error('Failed to load JWT keys from disk');
    }

    this.setKeys(privateKey, publicKey, 'disk');
    return true;
  }

  private generateKeys(): void {
    const key = new NodeRSA({ b: 2048 });
    key.setOptions({ signingScheme: 'pkcs1-sha256' });

    this.privateKey = key.exportKey('pkcs1-private-pem');
    this.publicKey = key.exportKey('pkcs8-public-pem');
  }

  private saveKeysToDisk(): void {
    const privateKeyPath = path.join(this.keysPath, 'jwt-private.pem');
    const publicKeyPath = path.join(this.keysPath, 'jwt-public.pem');

    try {
      if (!fs.existsSync(this.keysPath)) {
        fs.mkdirSync(this.keysPath, { recursive: true });
      }

      fs.writeFileSync(privateKeyPath, this.privateKey, { mode: 0o600 });
      fs.writeFileSync(publicKeyPath, this.publicKey, { mode: 0o644 });

      this.logger.log('RSA keys saved to disk');
    } catch (error) {
      this.logger.error('Failed to save keys to disk', error);
    }
  }

  private validateKeyPair(privateKey: string, publicKey: string): void {
    let privateKeyObject: crypto.KeyObject;
    try {
      privateKeyObject = crypto.createPrivateKey(privateKey);
    } catch {
      throw new Error('JWT_PRIVATE_KEY must be a valid RSA private key');
    }

    if (privateKeyObject.asymmetricKeyType !== 'rsa') {
      throw new Error('JWT_PRIVATE_KEY must be an RSA private key');
    }

    let publicKeyObject: crypto.KeyObject;
    try {
      publicKeyObject = crypto.createPublicKey(publicKey);
    } catch {
      throw new Error('JWT_PUBLIC_KEY must be a valid RSA public key');
    }

    if (publicKeyObject.asymmetricKeyType !== 'rsa') {
      throw new Error('JWT_PUBLIC_KEY must be an RSA public key');
    }

    let derivedPublicKey: Buffer;
    let configuredPublicKey: Buffer;
    try {
      derivedPublicKey = crypto
        .createPublicKey(privateKeyObject)
        .export({ type: 'spki', format: 'der' }) as Buffer;
      configuredPublicKey = publicKeyObject.export({
        type: 'spki',
        format: 'der',
      }) as Buffer;
    } catch {
      throw new Error(
        'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY could not be validated as a matching RSA key pair',
      );
    }

    if (!derivedPublicKey.equals(configuredPublicKey)) {
      throw new Error(
        'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must form a matching RSA key pair',
      );
    }
  }

  private getSystemSubject(organizationId: OrganizationId): string {
    return `system:search-context:${organizationId}`;
  }

  isSystemSubject(subject?: string | null): subject is string {
    return Boolean(subject && subject.startsWith('system:'));
  }

  getSystemUserId(): UserId {
    return this.systemUserId;
  }

  getToken(
    {
      organizationId,
      projectId,
      authContext,
      correlationId,
    }: {
      organizationId: OrganizationId;
      projectId: ProjectId;
      authContext?: ContextAuthContext;
      correlationId?: string;
    },
    { expiresIn = '5m' }: { expiresIn?: number | jwt.SignOptions['expiresIn'] },
  ) {
    const subject =
      authContext?.sub && authContext.sub.trim().length > 0
        ? authContext.sub
        : this.getSystemSubject(organizationId);

    const payload: Record<string, unknown> = {
      sub: subject,
    };

    const scopes = authContext?.scopes
      ?.map((scope) => scope?.trim())
      .filter(Boolean);
    if (scopes && scopes.length > 0) {
      payload.scopes = scopes;
    }

    const memberships = this.resolveMemberships(authContext, organizationId);
    if (memberships.length > 0) {
      payload.orgMemberships = memberships;
      payload.currentOrgId = authContext?.currentOrgId ?? organizationId;
    } else if (authContext?.currentOrgId) {
      payload.currentOrgId = authContext.currentOrgId;
    }

    const projectIds = this.resolveProjectIds(authContext, projectId);
    if (projectIds.length > 0) {
      payload.project_ids = projectIds;
    }

    if (authContext?.isDevAdmin !== undefined) {
      payload.isDevAdmin = authContext.isDevAdmin;
    }

    try {
      return this.signToken(payload, {
        expiresIn,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : errorToLoggable(error);
      this.logger.error('[getToken] Failed to sign JWT', {
        organizationId,
        error: errorMessage,
        correlationId,
      });
      throw new Error(
        'Failed to generate authentication token for embeddings service',
      );
    }
  }

  getTemplateGraphToken(organizationId: string, projectId: string): string {
    return this.signToken(
      {
        sub: `system:template-copy:${organizationId}`,
        organizationId,
        projectId,
        scopes: ['project:template:copy'],
      },
      { audience: 'graph-service', expiresIn: '5m' },
    );
  }

  getProjectionDeletionToken(
    context: OrganizationClosureTokenContext,
    provider: ProjectionDeletionProvider,
  ): string {
    const authorization = PROJECTION_DELETION_AUTHORIZATION[provider];
    const secondsUntilDeadline = Math.floor(
      (context.deletionDeadline.getTime() - Date.now()) / 1000,
    );
    const expiresIn = Math.min(
      PROJECTION_DELETION_TOKEN_MAX_LIFETIME_SECONDS,
      secondsUntilDeadline,
    );
    if (expiresIn <= 0) {
      throw new Error(
        'Cannot issue a projection deletion credential after its deletion deadline',
      );
    }

    const payload: jwt.JwtPayload = {
      sub: `system:projection-deletion:${provider.toLowerCase()}:${context.organizationId}`,
      organizationId: context.organizationId,
      currentOrgId: context.organizationId,
      scopes: [authorization.scope],
      markerId: context.markerId,
      irreversibleClosureAt: context.irreversibleClosureAt.toISOString(),
      deletionDeadline: context.deletionDeadline.toISOString(),
    };

    try {
      return this.signToken(payload, {
        audience: authorization.audience,
        expiresIn,
      });
    } catch (error) {
      this.logger.error(
        '[getProjectionDeletionToken] Failed to sign provider credential',
        {
          provider,
          organizationId: context.organizationId,
          markerId: context.markerId,
          error:
            error instanceof Error ? error.message : errorToLoggable(error),
        },
      );
      throw new Error(
        `Failed to generate ${provider.toLowerCase()} projection deletion credential`,
      );
    }
  }

  private resolveMemberships(
    authContext: ContextAuthContext | undefined,
    organizationId: OrganizationId,
  ): ContextAuthMembership[] {
    if (authContext?.orgMemberships && authContext.orgMemberships.length > 0) {
      return authContext.orgMemberships
        .filter((membership): membership is ContextAuthMembership =>
          Boolean(membership?.orgId),
        )
        .map((membership) => ({
          orgId: membership.orgId,
          role: this.normalizeRole(membership.role),
        }));
    }

    if (organizationId) {
      this.logger.debug(
        '[resolveMemberships] Falling back to inferred organization membership',
        {
          organizationId,
        },
      );

      return [
        {
          orgId: organizationId,
          role: 'MEMBER',
        },
      ];
    }

    return [];
  }

  private resolveProjectIds(
    authContext: ContextAuthContext | undefined,
    requestProjectId?: ProjectId,
  ): ProjectId[] {
    const projectIds = new Set<ProjectId>();

    if (authContext?.projectIds) {
      for (const id of authContext.projectIds) {
        if (id) {
          projectIds.add(id);
        }
      }
    }

    if (requestProjectId) {
      projectIds.add(requestProjectId);
    }

    return Array.from(projectIds);
  }

  private normalizeRole(role?: string): OrganizationRole {
    switch ((role || 'MEMBER').toUpperCase()) {
      case 'OWNER':
        return 'OWNER';
      case 'ADMIN':
        return 'ADMIN';
      case 'VIEWER':
        return 'VIEWER';
      default:
        return 'MEMBER';
    }
  }

  /**
   * Sign JWT token with RSA private key
   */
  signToken(payload: jwt.JwtPayload, options?: jwt.SignOptions): string {
    const defaultOptions: jwt.SignOptions = {
      algorithm: 'RS256',
      keyid: this.keyId,
      expiresIn: '24h',
      ...options,
    };

    return jwt.sign(payload, this.privateKey, defaultOptions);
  }

  /**
   * Verify JWT token with RSA public key
   */
  verifyToken(token: string): jwt.JwtPayload {
    return jwt.verify(token, this.publicKey, {
      algorithms: ['RS256'],
    }) as jwt.JwtPayload;
  }

  /**
   * Get JWKS (JSON Web Key Set) for external services
   */
  getJwks(): JWKSResponse {
    try {
      // Modern Node.js (>=16) can convert a PEM public key directly to JWK via the crypto module.
      // This is simpler and more reliable than manually parsing with NodeRSA.
      // We still keep a NodeRSA fallback for older runtimes.
      try {
        const publicKeyObj = crypto.createPublicKey(this.publicKey);
        const exported = publicKeyObj.export({
          format: 'jwk',
        }) as {
          kty: string;
          n: string;
          e: string;
        };

        const jwk: JWK = {
          kty: exported.kty,
          n: exported.n,
          e: exported.e,
          use: 'sig',
          kid: this.keyId,
          alg: 'RS256',
        };

        return { keys: [jwk] };
      } catch (cryptoError) {
        // Fallback to NodeRSA parsing if crypto export not supported (older Node @ runtime)
        this.logger.warn(
          'crypto.createPublicKey JWK export failed, falling back to NodeRSA',
          cryptoError,
        );

        const key = new NodeRSA();
        key.importKey(this.publicKey, 'pkcs8-public-pem');

        const keyComponents = key.exportKey('components-public');

        const n = Buffer.from(keyComponents.n).toString('base64url');
        // Use standard exponent for RSA 65537 if e is number, else convert buffer
        const e =
          typeof keyComponents.e === 'number'
            ? 'AQAB' // 65537 => 010001 in hex -> AQAB in base64url
            : Buffer.from(keyComponents.e).toString('base64url');

        const jwk: JWK = {
          kty: 'RSA',
          use: 'sig',
          kid: this.keyId,
          n,
          e,
          alg: 'RS256',
        };

        return { keys: [jwk] };
      }
    } catch (error) {
      this.logger.error('Failed to generate JWKS', error);
      return { keys: [] };
    }
  }

  /**
   * Get the current key ID
   */
  getKeyId(): string {
    return this.keyId;
  }

  /**
   * Get public key in PEM format
   */
  getPublicKey(): string {
    return this.publicKey;
  }

  /**
   * Get private key in PEM format (for internal use only)
   */
  getPrivateKey(): string {
    return this.privateKey;
  }
}
