import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import * as path from 'node:path';
import {
  JwtKeysService,
  PROJECTION_DELETION_AUTHORIZATION,
  ProjectionDeletionProvider,
} from '../jwt-keys.service';

const ORGANIZATION_ID = '2c7932bd-19d2-463a-a130-965ca6bc8781';
const MARKER_ID = '287163df-6236-46f5-98dc-8a894d7b8e40';
const IRREVERSIBLE_CLOSURE_AT = new Date('2026-08-19T12:00:00.000Z');
const DELETION_DEADLINE = new Date('2026-08-19T12:10:00.000Z');

describe('JwtKeysService projection deletion credentials', () => {
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  let service: JwtKeysService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-19T12:01:00.000Z'));
    service = new JwtKeysService(
      createConfig({
        JWT_PRIVATE_KEY: keys.privateKey,
        JWT_PUBLIC_KEY: keys.publicKey,
        JWT_KEY_ID: 'projection-deletion-test-key',
        SYSTEM_USER_ID: 'system',
      }),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each<ProjectionDeletionProvider>(['GRAPH', 'EMBEDDINGS'])(
    'issues an attempt-bounded %s credential with the contract claims',
    (provider) => {
      const token = issue(provider);
      const payload = verifyProjectionCredential(token, provider, {
        organizationId: ORGANIZATION_ID,
        markerId: MARKER_ID,
      });

      expect(payload).toEqual(
        expect.objectContaining({
          aud: PROJECTION_DELETION_AUTHORIZATION[provider].audience,
          organizationId: ORGANIZATION_ID,
          currentOrgId: ORGANIZATION_ID,
          scopes: [PROJECTION_DELETION_AUTHORIZATION[provider].scope],
          markerId: MARKER_ID,
          irreversibleClosureAt: IRREVERSIBLE_CLOSURE_AT.toISOString(),
          deletionDeadline: DELETION_DEADLINE.toISOString(),
        }),
      );
      expect(payload.exp! - payload.iat!).toBe(5 * 60);
      expect(payload.exp! * 1000).toBeLessThanOrEqual(
        DELETION_DEADLINE.getTime(),
      );
    },
  );

  it.each<
    [
      string,
      Partial<{
        provider: ProjectionDeletionProvider;
        organizationId: string;
        markerId: string;
        scope: string;
      }>,
    ]
  >([
    ['scope', { scope: 'organization:delete' }],
    ['audience', { provider: 'EMBEDDINGS' as const }],
    ['organization', { organizationId: 'wrong-organization' }],
    ['deletion identity', { markerId: 'wrong-marker' }],
  ])('rejects a Graph credential with the wrong %s', (_case, overrides) => {
    const token = issue('GRAPH');

    expect(() =>
      verifyProjectionCredential(token, overrides.provider ?? 'GRAPH', {
        organizationId: overrides.organizationId ?? ORGANIZATION_ID,
        markerId: overrides.markerId ?? MARKER_ID,
        scope: overrides.scope,
      }),
    ).toThrow();
  });

  it('rejects an expired provider credential', () => {
    const token = issue('GRAPH');
    jest.setSystemTime(new Date('2026-08-19T12:06:01.000Z'));

    expect(() =>
      verifyProjectionCredential(token, 'GRAPH', {
        organizationId: ORGANIZATION_ID,
        markerId: MARKER_ID,
      }),
    ).toThrow(jwt.TokenExpiredError);
  });

  it('refuses to issue a credential after the bounded deletion deadline', () => {
    jest.setSystemTime(new Date('2026-08-19T12:10:01.000Z'));

    expect(() => issue('GRAPH')).toThrow(
      'Cannot issue a projection deletion credential after its deletion deadline',
    );
  });

  it.each(['JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY'] as const)(
    'rejects a partial runtime key pair when %s is absent',
    (missingKey) => {
      const values = runtimeKeyConfig();
      delete values[missingKey];

      expect(() => new JwtKeysService(createConfig(values))).toThrow(
        'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be provided together',
      );
    },
  );

  it('fails fast when runtime signing and verification keys do not match', () => {
    const otherKeys = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    expect(
      () =>
        new JwtKeysService(
          createConfig({
            ...runtimeKeyConfig(),
            JWT_PUBLIC_KEY: otherKeys.publicKey,
          }),
        ),
    ).toThrow(
      'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must form a matching RSA key pair',
    );
  });

  it('publishes a JWKS key that verifies a token signed with the runtime private key', () => {
    const token = service.signToken({ sub: 'runtime-user' });
    const [publishedJwk] = service.getJwks().keys;
    if (!publishedJwk) {
      throw new Error('JwtKeysService did not publish a JWK');
    }

    const publishedPublicKey = createPublicKey({
      key: {
        kty: publishedJwk.kty,
        n: publishedJwk.n,
        e: publishedJwk.e,
      },
      format: 'jwk',
    })
      .export({ type: 'spki', format: 'pem' })
      .toString();

    expect(
      jwt.verify(token, publishedPublicKey, { algorithms: ['RS256'] }),
    ).toEqual(expect.objectContaining({ sub: 'runtime-user' }));
  });

  it('falls back to an ignored generated key pair without runtime keys', () => {
    const originalWorkingDirectory = process.cwd();
    const temporaryWorkingDirectory = fs.mkdtempSync(
      path.join(originalWorkingDirectory, '.tmp-jwt-keys-'),
    );

    try {
      process.chdir(temporaryWorkingDirectory);
      const localService = new JwtKeysService(
        createConfig({ SYSTEM_USER_ID: 'system' }),
      );
      const token = localService.signToken({ sub: 'local-user' });
      const [publishedJwk] = localService.getJwks().keys;
      if (!publishedJwk) {
        throw new Error('JwtKeysService did not publish a local JWK');
      }

      const publishedPublicKey = createPublicKey({
        key: {
          kty: publishedJwk.kty,
          n: publishedJwk.n,
          e: publishedJwk.e,
        },
        format: 'jwk',
      })
        .export({ type: 'spki', format: 'pem' })
        .toString();

      expect(
        jwt.verify(token, publishedPublicKey, { algorithms: ['RS256'] }),
      ).toEqual(expect.objectContaining({ sub: 'local-user' }));
      expect(
        fs.existsSync(
          path.join(
            temporaryWorkingDirectory,
            'config',
            'keys',
            'jwt-private.pem',
          ),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(
            temporaryWorkingDirectory,
            'config',
            'keys',
            'jwt-public.pem',
          ),
        ),
      ).toBe(true);
    } finally {
      process.chdir(originalWorkingDirectory);
      fs.rmSync(temporaryWorkingDirectory, { recursive: true, force: true });
    }
  });

  function issue(provider: ProjectionDeletionProvider): string {
    return service.getProjectionDeletionToken(
      {
        organizationId: ORGANIZATION_ID as never,
        markerId: MARKER_ID,
        irreversibleClosureAt: IRREVERSIBLE_CLOSURE_AT,
        deletionDeadline: DELETION_DEADLINE,
      },
      provider,
    );
  }

  function runtimeKeyConfig(): Record<string, string> {
    return {
      JWT_PRIVATE_KEY: keys.privateKey,
      JWT_PUBLIC_KEY: keys.publicKey,
      JWT_KEY_ID: 'projection-deletion-test-key',
      SYSTEM_USER_ID: 'system',
    };
  }

  function verifyProjectionCredential(
    token: string,
    provider: ProjectionDeletionProvider,
    expected: {
      organizationId: string;
      markerId: string;
      scope?: string;
    },
  ): jwt.JwtPayload {
    const authorization = PROJECTION_DELETION_AUTHORIZATION[provider];
    const payload = jwt.verify(token, keys.publicKey, {
      algorithms: ['RS256'],
      audience: authorization.audience,
    }) as jwt.JwtPayload;

    if (
      !Array.isArray(payload.scopes) ||
      payload.scopes.length !== 1 ||
      payload.scopes[0] !== (expected.scope ?? authorization.scope)
    ) {
      throw new Error('Credential scope does not match the operation');
    }
    if (
      payload.organizationId !== expected.organizationId ||
      payload.currentOrgId !== expected.organizationId
    ) {
      throw new Error('Credential organization does not match the command');
    }
    if (payload.markerId !== expected.markerId) {
      throw new Error(
        'Credential deletion identity does not match the command',
      );
    }
    return payload;
  }
});

function createConfig(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}
