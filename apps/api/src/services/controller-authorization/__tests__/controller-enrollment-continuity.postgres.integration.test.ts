import { ControllerAuthorizationService } from '../controller-authorization.service';
import { ControllerAssertionVerifierService } from '../controller-assertion-verifier.service';
import { ControllerAuthorizationWebAuthnConfigService } from '../controller-authorization-webauthn-config.service';
import { ExecutionGrantService } from '../execution-grant.service';
import {
  ControllerAuthorizationCadence,
  type HostActionPreparation,
} from '../../../generated';
import type { ProjectId, MachineId } from '../../../types';
import { MACHINE_ENROLLMENT_CODE_ALPHABET } from '../../machine-pairing/machine-pairing.service';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { PrismaService } from '../../../prisma/prisma.service';
import { ServerSigningKeyService } from '../../../core/server-signing/server-signing-key.service';
import { canonicalizeJcs } from '../../../core/websockets/trigger-canonicalization';
import { MachineEnrollmentClaimService } from '../../machine-pairing/machine-enrollment-claim.service';
import { MachineEnrollmentConfirmationService } from '../../machine-pairing/machine-enrollment-confirmation.service';
import { SimpleWebAuthnRegistrationVerifier } from '../../machine-pairing/machine-enrollment-webauthn-verifier';
import { ControllerBrowserBindingService } from '../controller-browser-binding.service';
import type { OrganizationId, UserId } from '../../../types';

const describeDatabase =
  process.env.RUN_CONTROLLER_CONTINUITY_DB_TESTS === '1'
    ? describe
    : describe.skip;
const digest = (bytes: string | Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

describeDatabase(
  'browser enrollment continuity through PostgreSQL and real WebAuthn registration',
  () => {
    const prisma = new PrismaService();
    const bindings = new ControllerBrowserBindingService(prisma);
    const config = new ConfigService({
      MACHINE_ENROLLMENT_CODE_HMAC_KEY: 'continuity-test-key',
      MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'localhost.test',
      MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://localhost.test',
    });
    const claims = new MachineEnrollmentClaimService(
      prisma,
      config,
      new SimpleWebAuthnRegistrationVerifier(),
      bindings,
    );
    const confirmations = new MachineEnrollmentConfirmationService(
      prisma,
      new ServerSigningKeyService(config),
      bindings,
    );
    let userId: UserId;
    let organizationId: OrganizationId;
    let projectId: ProjectId;
    let secret: string;
    const enrollmentIds: string[] = [];
    const machineIds: string[] = [];

    beforeAll(async () => {
      await prisma.$connect();
      const user = await prisma.db.user.create({
        data: {
          email: `continuity-${randomUUID()}@example.com`,
          name: 'Continuity fixture',
          passwordHash: 'fixture',
        },
      });
      userId = user.id;
      const organization = await prisma.db.organization.create({
        data: {
          name: 'Continuity fixture',
          slug: `continuity-${randomUUID()}`,
        },
      });
      organizationId = organization.id;
      await prisma.db.organizationMember.create({
        data: { userId, organizationId },
      });
      const project = await prisma.db.project.create({
        data: { name: 'Continuity fixture', organizationId, status: 'ACTIVE' },
      });
      projectId = project.id;
      secret = (await bindings.ensureContext(undefined, userId)).secret;
    });

    afterAll(async () => {
      await prisma.db.executionGrant.deleteMany({ where: { userId } });
      await prisma.db.executionAuthorization.deleteMany({ where: { userId } });
      await prisma.db.project.delete({ where: { id: projectId } });
      await prisma.db.controllerBrowserBinding.deleteMany({
        where: { userId },
      });
      await prisma.db.controllerBrowserContext.deleteMany({
        where: { userId },
      });
      await prisma.db.machineControllerCredential.deleteMany({
        where: { userId },
      });
      await prisma.db.machine.deleteMany({ where: { id: { in: machineIds } } });
      await prisma.db.machineEnrollmentClaimFailure.deleteMany({
        where: { userId },
      });
      await prisma.db.pendingMachineEnrollment.deleteMany({
        where: { id: { in: enrollmentIds } },
      });
      await prisma.db.organizationMember.deleteMany({ where: { userId } });
      await prisma.db.organization.delete({ where: { id: organizationId } });
      await prisma.db.user.delete({ where: { id: userId } });
      await prisma.$disconnect();
    });

    async function claim(
      name: string,
      existing?: {
        machineId: string;
        machineKeys: {
          publicKey: import('node:crypto').KeyObject;
          privateKey: import('node:crypto').KeyObject;
        };
      },
    ) {
      const machineKeys =
        existing?.machineKeys ?? generateKeyPairSync('ed25519');
      const machineId = existing?.machineId ?? randomUUID();
      machineIds.push(machineId);
      const deviceSecret = randomBytes(32);
      const alphabet = MACHINE_ENROLLMENT_CODE_ALPHABET;
      const code = [...randomBytes(10)]
        .map((value) => alphabet[value % alphabet.length])
        .join('');
      const enrollment = await prisma.db.pendingMachineEnrollment.create({
        data: {
          machineId,
          machineName: name,
          machinePublicKey: machineKeys.publicKey
            .export({ type: 'spki', format: 'pem' })
            .toString(),
          machinePublicKeyFingerprint: digest(machineId),
          osFamily: name === 'Mac' ? 'macos' : 'linux',
          cliVersion: '2.2.2',
          authorizationProtocolVersion: 2,
          userCodeHmac: createHmac('sha256', 'continuity-test-key')
            .update(code)
            .digest('hex'),
          deviceSecretDigest: digest(deviceSecret),
          expiresAt: new Date(Date.now() + 300_000),
        },
      });
      enrollmentIds.push(enrollment.id);
      const result = await claims.beginClaim(
        { userCode: code, organizationId, controllerLabel: name },
        userId,
        [{ orgId: organizationId }],
        '192.0.2.1',
      );
      if (result.state !== 'claimable') {
        throw new Error('Expected registration ceremony');
      }
      const controllerKeys = generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
      });
      const jwk = controllerKeys.publicKey.export({ format: 'jwk' });
      const credentialBytes = randomBytes(32);
      const credentialId = credentialBytes.toString('base64url');
      const coseKey = isoCBOR.encode(
        new Map<number, number | Uint8Array>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, new Uint8Array(Buffer.from(jwk.x!, 'base64url'))],
          [-3, new Uint8Array(Buffer.from(jwk.y!, 'base64url'))],
        ]),
      );
      const length = Buffer.alloc(2);
      length.writeUInt16BE(credentialBytes.length);
      const authData = Buffer.concat([
        createHash('sha256').update('localhost.test').digest(),
        Buffer.from([0x45]),
        Buffer.alloc(4),
        Buffer.alloc(16),
        length,
        credentialBytes,
        Buffer.from(coseKey),
      ]);
      const attestationObject = Buffer.from(
        isoCBOR.encode(
          new Map<string, string | Uint8Array | Map<string, string>>([
            ['fmt', 'none'],
            ['attStmt', new Map()],
            ['authData', new Uint8Array(authData)],
          ]),
        ),
      ).toString('base64url');
      const clientDataJSON = Buffer.from(
        JSON.stringify({
          type: 'webauthn.create',
          challenge: result.registrationOptions.challenge,
          origin: 'https://localhost.test',
          crossOrigin: false,
        }),
      ).toString('base64url');
      await claims.completeClaim(
        {
          enrollmentId: enrollment.id,
          organizationId,
          credential: {
            id: credentialId,
            rawId: credentialId,
            type: 'public-key',
            authenticatorAttachment: 'platform',
            response: {
              attestationObject,
              clientDataJSON,
              transports: ['internal'],
            },
          },
        },
        userId,
        [{ orgId: organizationId }],
        '192.0.2.1',
      );
      const issued = await claims.issueBrowserBindingForAwaitingConfirmation({
        enrollmentId: enrollment.id,
        userId,
        organizationId,
        controllerBindingSecret: secret,
      });
      expect(issued.secret).toBe(secret);
      await confirmations.poll(enrollment.id, {
        deviceSecret: deviceSecret.toString('base64'),
      });
      const pending =
        await prisma.db.pendingMachineEnrollment.findUniqueOrThrow({
          where: { id: enrollment.id },
        });
      const confirmation = {
        enrollmentId: enrollment.id,
        machineId,
        accountId: userId,
        organizationId,
        controllerCredentialId: credentialId,
        confirmationNonce: pending.confirmationNonce!,
      };
      const request = {
        deviceSecret: deviceSecret.toString('base64'),
        confirmation,
        signature: sign(
          null,
          Buffer.from(canonicalizeJcs(confirmation)),
          machineKeys.privateKey,
        ).toString('base64'),
      };
      return {
        machineId,
        credentialId,
        controllerKeys,
        machineKeys,
        pending,
        confirm: () => confirmations.confirm(enrollment.id, request),
      };
    }

    it('retains Linux then Mac, rejects pending and replayed activation, and isolates rotation and expiry', async () => {
      const linux = await claim('Linux');
      expect(await bindings.resolveAllForSelection({ secret, userId })).toEqual(
        [],
      );
      await linux.confirm();
      const mac = await claim('Mac');
      expect(
        (await bindings.resolveAllForSelection({ secret, userId })).map(
          (b) => b.machineId,
        ),
      ).toEqual([linux.machineId]);
      await mac.confirm();
      await expect(mac.confirm()).rejects.toThrow();
      const inventory = await bindings.resolveInventory({ secret, userId });
      expect(
        new Set(
          inventory.bindings.filter((b) => !b.revoked).map((b) => b.machineId),
        ),
      ).toEqual(new Set([linux.machineId, mac.machineId]));
      for (const selected of [linux, mac, linux]) {
        expect(
          await bindings.resolveForAdmission({
            secret,
            userId,
            organizationId,
            machineId: selected.machineId,
            controllerCredentialId: selected.credentialId,
            required: true,
          }),
        ).toMatchObject({ machineId: selected.machineId });
      }
      expect(
        await bindings.resolveForAdmission({
          secret,
          userId,
          machineId: linux.machineId,
          controllerCredentialId: mac.credentialId,
        }),
      ).toBeNull();
      const webauthnConfig = new ControllerAuthorizationWebAuthnConfigService(
        config,
      );
      const authorization = new ControllerAuthorizationService(
        prisma,
        { isPresent: async () => true } as any,
        new ControllerAssertionVerifierService(webauthnConfig),
        webauthnConfig,
        bindings,
        null as any,
      );
      const grants = new ExecutionGrantService(prisma, bindings, authorization);
      const context = {
        userId,
        organizationId,
        projectId,
        controllerBindingSecret: secret,
      };
      for (const selected of [linux, mac]) {
        const action = {
          requestId: randomUUID(),
          actionCategory: 'CLI_READ',
          actionType: 'CLI_READ',
          targetKind: 'CLI_READ',
          targetId: selected.machineId,
        } satisfies HostActionPreparation;
        const prepared = await authorization.prepare({
          ...context,
          input: {
            machineId: selected.machineId,
            controllerCredentialId: selected.credentialId,
            cadence: ControllerAuthorizationCadence.FiveMinutes,
            action,
          },
        });
        const clientData = Buffer.from(
          JSON.stringify({
            type: 'webauthn.get',
            challenge: prepared.publicKey.challenge,
            origin: 'https://localhost.test',
            crossOrigin: false,
          }),
        );
        const authData = Buffer.concat([
          createHash('sha256').update('localhost.test').digest(),
          Buffer.from([0x05]),
          Buffer.from([0, 0, 0, 1]),
        ]);
        const signature = sign(
          'sha256',
          Buffer.concat([
            authData,
            createHash('sha256').update(clientData).digest(),
          ]),
          selected.controllerKeys.privateKey,
        ).toString('base64url');
        const assertion = {
          kind: 'controller_assertion' as const,
          intent: prepared.intent,
          grantDescriptor: prepared.grantDescriptor,
          credentialId: selected.credentialId,
          clientDataJSON: clientData.toString('base64url'),
          authenticatorData: authData.toString('base64url'),
          signature,
          userHandle: Buffer.from(userId).toString('base64url'),
        };
        expect(
          (
            await authorization.submit({
              ...context,
              input: {
                authorizationId: prepared.intent.authorizationId,
                assertion,
              },
            })
          ).response.outcome,
        ).toBe('ADMITTED');
        await grants.assertRuntimeModelCatalogAuthorized({
          ...context,
          machineId: selected.machineId as MachineId,
          authorization: assertion,
        });
      }
      for (const selected of [linux, mac, linux, mac]) {
        const action = {
          requestId: randomUUID(),
          actionCategory: 'CLI_READ',
          actionType: 'CLI_READ',
          targetKind: 'CLI_READ',
          targetId: selected.machineId,
        } satisfies HostActionPreparation;
        const resolution = await authorization.resolve({
          ...context,
          input: {
            machineId: selected.machineId,
            controllerCredentialId: selected.credentialId,
            action,
          },
        });
        expect(resolution.outcome).toBe('ACTIVE_GRANT');
        if (resolution.outcome !== 'ACTIVE_GRANT') {
          throw new Error('Missing independently admitted grant');
        }
        await grants.assertRuntimeModelCatalogAuthorized({
          ...context,
          machineId: selected.machineId as MachineId,
          authorization: resolution.authorization,
        });
        await expect(
          grants.assertRuntimeModelCatalogAuthorized({
            ...context,
            machineId: selected.machineId as MachineId,
            controllerBindingSecret: undefined,
            authorization: resolution.authorization,
          }),
        ).rejects.toThrow();
      }
      const linuxBinding = await bindings.resolveForSelection({
        secret,
        userId,
        machineId: linux.machineId,
      });
      expect(linuxBinding).not.toBeNull();
      await prisma.db.$transaction((tx) =>
        bindings.issueOrRotate(
          tx,
          {
            controllerInstallationId: linuxBinding!.controllerInstallationId,
            controllerCredentialId: linuxBinding!.controllerCredentialId,
            userId,
            organizationId,
            expiresAt: new Date(Date.now() + 60_000),
          },
          new Date(),
          secret,
        ),
      );
      expect(
        await bindings.resolveForAdmission({
          secret,
          userId,
          machineId: mac.machineId,
          required: true,
        }),
      ).toMatchObject({ machineId: mac.machineId });
      await prisma.db.controllerBrowserBinding.updateMany({
        where: {
          controllerCredentialId: linuxBinding!.controllerCredentialId,
          revokedAt: null,
        },
        data: { expiresAt: new Date(Date.now() + 1000) },
      });
      expect(
        await bindings.resolveForAdmission({
          secret,
          userId,
          machineId: linux.machineId,
          now: new Date(Date.now() + 2000),
        }),
      ).toBeNull();
      expect(
        await bindings.resolveForSelection({
          secret,
          userId,
          machineId: linux.machineId,
        }),
      ).toMatchObject({ machineId: linux.machineId });
      expect(
        await bindings.resolveForAdmission({
          secret: undefined,
          userId,
          machineId: mac.machineId,
        }),
      ).toBeNull();
      const unrelated = await bindings.ensureContext(undefined, userId);
      expect(
        await bindings.resolveAllForSelection({
          secret: unrelated.secret,
          userId,
        }),
      ).toEqual([]);
    });

    it('appends concurrent locally confirmed enrollments without discarding earlier bindings', async () => {
      const [first, second] = await Promise.all([
        claim('Concurrent Linux'),
        claim('Concurrent Mac'),
      ]);
      await Promise.all([first.confirm(), second.confirm()]);
      for (const enrollment of [first, second]) {
        expect(
          await bindings.resolveForSelection({
            secret,
            userId,
            machineId: enrollment.machineId,
          }),
        ).toMatchObject({ machineId: enrollment.machineId });
      }
    });
    it('keeps two controllers on one machine distinct and requires exact credential selection', async () => {
      const first = await claim('Additional controller');
      await first.confirm();
      const second = await claim('Additional controller', first);
      await second.confirm();
      expect(second.machineId).toBe(first.machineId);
      expect(second.credentialId).not.toBe(first.credentialId);
      expect(
        await bindings.resolveForSelection({
          secret,
          userId,
          machineId: first.machineId,
        }),
      ).toBeNull();
      for (const selected of [first, second]) {
        expect(
          await bindings.resolveForSelection({
            secret,
            userId,
            machineId: selected.machineId,
            controllerCredentialId: selected.credentialId,
          }),
        ).toMatchObject({
          controllerCredentialPublicId: selected.credentialId,
        });
      }
    });

    it('rejects expired and declined enrollment without changing existing membership', async () => {
      const before = await bindings.resolveAllForSelection({ secret, userId });
      for (const state of ['EXPIRED', 'REJECTED'] as const) {
        const pending = await claim('Unconfirmed Linux');
        await prisma.db.pendingMachineEnrollment.update({
          where: { id: pending.pending.id },
          data: {
            state,
            ...(state === 'EXPIRED'
              ? { expiresAt: new Date(Date.now() - 1), expiredAt: new Date() }
              : { rejectedAt: new Date() }),
          },
        });
        await expect(pending.confirm()).rejects.toThrow();
        expect(
          await bindings.resolveForSelection({
            secret,
            userId,
            machineId: pending.machineId,
          }),
        ).toBeNull();
      }
      expect(await bindings.resolveAllForSelection({ secret, userId })).toEqual(
        before,
      );
    });

    it('adopts only a presented legacy binding and rejects expired context authority', async () => {
      const original = (
        await bindings.resolveAllForSelection({ secret, userId })
      )[0]!;
      const legacySecret = randomBytes(32).toString('base64url');
      await prisma.db.controllerBrowserBinding.updateMany({
        where: {
          controllerCredentialId: original.controllerCredentialId,
          revokedAt: null,
        },
        data: { credentialHash: digest(legacySecret), browserContextId: null },
      });
      expect((await bindings.ensureContext(legacySecret, userId)).secret).toBe(
        legacySecret,
      );
      const adopted = await bindings.resolveAllForSelection({
        secret: legacySecret,
        userId,
      });
      expect(adopted).toHaveLength(1);
      expect(adopted[0]).toMatchObject({
        controllerCredentialId: original.controllerCredentialId,
      });
      await prisma.db.controllerBrowserContext.update({
        where: { credentialHash: digest(legacySecret) },
        data: { expiresAt: new Date(Date.now() - 1) },
      });
      expect(
        await bindings.resolveInventory({ secret: legacySecret, userId }),
      ).toEqual({ hasIdentity: false, bindings: [] });
      await expect(
        bindings.resolveForAdmission({
          secret: legacySecret,
          userId,
          machineId: original.machineId,
          required: true,
        }),
      ).rejects.toThrow();
    });
  },
);
