import { MachineEnrollmentState } from '@prisma/client';
import * as crypto from 'node:crypto';
import {
  MachineEnrollmentAuthenticationFailedException,
  MachineEnrollmentInvalidTransitionException,
  MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH,
  MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH_MESSAGE,
} from '../../../common/exceptions/pairing.exceptions';
import {
  ConfirmMachineEnrollmentRequestDto,
  MachineEnrollmentConfirmationPayloadDto,
  PollMachineEnrollmentRequestDto,
} from '../../../generated';
import { PrismaService } from '../../../prisma/prisma.service';
import { OrganizationId, UserId } from '../../../types';
import { canonicalizeJcs } from '../../../core/websockets/trigger-canonicalization';
import { ServerSigningKeyService } from '../../../core/server-signing/server-signing-key.service';
import {
  MACHINE_ENROLLMENT_MIN_POLL_INTERVAL_MS,
  MachineEnrollmentConfirmationService,
} from '../machine-enrollment-confirmation.service';

const ENROLLMENT_ID = '11111111-1111-4111-8111-111111111111';
const MACHINE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333' as UserId;
const ORGANIZATION_ID =
  '44444444-4444-4444-8444-444444444444' as OrganizationId;
const CREDENTIAL_ID = 'Y29udHJvbGxlci1jcmVkZW50aWFsLWlk';
const CONFIRMATION_NONCE = 'Y29uZmlybWF0aW9uLW5vbmNlLTEyMw';
const DEVICE_SECRET_BYTES = Buffer.alloc(32, 7);
const DEVICE_SECRET = DEVICE_SECRET_BYTES.toString('base64');
const DEVICE_SECRET_DIGEST = crypto
  .createHash('sha256')
  .update(DEVICE_SECRET_BYTES)
  .digest('hex');

type TestEnrollment = {
  id: string;
  machineId: string;
  machinePublicKey: string;
  machinePublicKeyFingerprint: string;
  machineName: string;
  osFamily: 'macos' | 'windows' | 'linux';
  cliVersion: string;
  authorizationProtocolVersion: number;
  deviceSecretDigest: string;
  state: MachineEnrollmentState;
  expiresAt: Date;
  claimantUserId: string;
  claimantOrganizationId: string;
  controllerInstallationId: string;
  controllerLabel: string;
  credentialId: string;
  credentialPublicKeyX: Buffer;
  credentialPublicKeyY: Buffer;
  credentialTransports: string[];
  credentialAaguid: Buffer;
  credentialSignCount: number;
  credentialBackupEligible: boolean;
  credentialBackupState: boolean;
  credentialFingerprint: string;
  confirmationNonce: string | null;
  lastPolledAt: Date | null;
  consumedAt: Date | null;
  browserBindingCredentialHash: string | null;
  browserBindingIssuedAt: Date | null;
  browserBindingExpiresAt: Date | null;
  localOutcomeCode: string | null;
  localOutcomeIssuedAt: Date | null;
  localOutcomeConsumedAt: Date | null;
};

type TestUpdateWhere = {
  id: string;
  state?: MachineEnrollmentState;
  lastPolledAt?: Date | null;
  consumedAt?: null;
  expiresAt?: { gt: Date };
  localOutcomeCode?: string | null;
  localOutcomeIssuedAt?: null;
  localOutcomeConsumedAt?: null;
};

type TestDatabase = {
  pendingMachineEnrollment: {
    findUnique: (args: { where: { id: string } }) => Promise<TestEnrollment>;
    updateMany: (args: {
      where: TestUpdateWhere;
      data: Partial<TestEnrollment>;
    }) => Promise<{ count: number }>;
  };
  machine: {
    create: (args: {
      data: Record<string, unknown>;
    }) => Promise<Record<string, unknown>>;
  };
  machineControllerCredential: {
    create: (args: {
      data: Record<string, unknown>;
    }) => Promise<Record<string, unknown>>;
  };
  $executeRaw: (...args: unknown[]) => Promise<number>;
  $transaction: (
    callback: (client: TestDatabase) => Promise<unknown>,
  ) => Promise<unknown>;
};

describe('MachineEnrollmentConfirmationService', () => {
  let service: MachineEnrollmentConfirmationService;
  let row: TestEnrollment;
  let machineCreates: Record<string, unknown>[];
  let credentialCreates: Record<string, unknown>[];
  let privateKey: crypto.KeyObject;
  let publicKeyPem: string;
  let db: TestDatabase;
  let loggerLog: jest.SpyInstance;
  let nudgeForMachine: jest.Mock;
  let recordWake: jest.Mock;

  const now = new Date('2026-08-12T20:00:00.000Z');

  const makeRow = (
    state = MachineEnrollmentState.AWAITING_MACHINE_CONFIRMATION,
  ): TestEnrollment => ({
    id: ENROLLMENT_ID,
    machineId: MACHINE_ID,
    machinePublicKey: publicKeyPem,
    machinePublicKeyFingerprint: 'a'.repeat(64),
    machineName: 'local-machine',
    osFamily: 'linux',
    cliVersion: '2.2.2',
    authorizationProtocolVersion: 2,
    deviceSecretDigest: DEVICE_SECRET_DIGEST,
    state,
    expiresAt: new Date(now.getTime() + 300_000),
    claimantUserId: USER_ID,
    claimantOrganizationId: ORGANIZATION_ID,
    controllerInstallationId: '00000000-0000-4000-8000-000000000099',
    controllerLabel: 'Zac browser',
    credentialId: CREDENTIAL_ID,
    credentialPublicKeyX: Buffer.alloc(32, 1),
    credentialPublicKeyY: Buffer.alloc(32, 2),
    credentialTransports: ['internal'],
    credentialAaguid: Buffer.alloc(16, 3),
    credentialSignCount: 1,
    credentialBackupEligible: true,
    credentialBackupState: false,
    credentialFingerprint: 'b'.repeat(64),
    confirmationNonce: CONFIRMATION_NONCE,
    lastPolledAt: null,
    consumedAt: null,
    browserBindingCredentialHash: null,
    browserBindingIssuedAt: null,
    browserBindingExpiresAt: null,
    localOutcomeCode: null,
    localOutcomeIssuedAt: null,
    localOutcomeConsumedAt: null,
  });

  const expectedConfirmation = (): MachineEnrollmentConfirmationPayloadDto => ({
    enrollmentId: ENROLLMENT_ID,
    machineId: MACHINE_ID,
    accountId: USER_ID,
    organizationId: ORGANIZATION_ID,
    controllerCredentialId: CREDENTIAL_ID,
    confirmationNonce: CONFIRMATION_NONCE,
  });

  const signedRequest = (
    confirmation = expectedConfirmation(),
  ): ConfirmMachineEnrollmentRequestDto => ({
    deviceSecret: DEVICE_SECRET,
    confirmation,
    signature: crypto
      .sign(
        null,
        Buffer.from(canonicalizeJcs(confirmation), 'utf8'),
        privateKey,
      )
      .toString('base64'),
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    ({ privateKey } = crypto.generateKeyPairSync('ed25519'));
    publicKeyPem = crypto
      .createPublicKey(privateKey)
      .export({ format: 'pem', type: 'spki' })
      .toString();
    row = makeRow();
    machineCreates = [];
    credentialCreates = [];
    nudgeForMachine = jest.fn().mockResolvedValue(true);
    recordWake = jest.fn();

    db = {
      pendingMachineEnrollment: {
        findUnique: jest.fn(async () => row),
        updateMany: jest.fn(
          async ({
            where,
            data,
          }: {
            where: TestUpdateWhere;
            data: Partial<TestEnrollment>;
          }) => {
            if (where.id !== row.id) return { count: 0 };
            if (where.state && row.state !== where.state) return { count: 0 };
            if (
              where.lastPolledAt !== undefined &&
              row.lastPolledAt !== where.lastPolledAt
            ) {
              return { count: 0 };
            }
            if (where.consumedAt === null && row.consumedAt !== null) {
              return { count: 0 };
            }
            if (where.expiresAt?.gt && row.expiresAt <= where.expiresAt.gt) {
              return { count: 0 };
            }
            if (
              where.localOutcomeCode !== undefined &&
              row.localOutcomeCode !== where.localOutcomeCode
            ) {
              return { count: 0 };
            }
            if (
              where.localOutcomeIssuedAt === null &&
              row.localOutcomeIssuedAt !== null
            ) {
              return { count: 0 };
            }
            if (
              where.localOutcomeConsumedAt === null &&
              row.localOutcomeConsumedAt !== null
            ) {
              return { count: 0 };
            }
            Object.assign(row, data);
            return { count: 1 };
          },
        ),
      },
      machine: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          machineCreates.push(data);
          return data;
        }),
      },
      machineControllerCredential: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          credentialCreates.push(data);
          return { id: 'controller-credential-row', ...data };
        }),
      },
      $executeRaw: jest.fn(async (..._args: unknown[]) => 0),
      $transaction: jest.fn(
        async (callback: (client: TestDatabase) => Promise<unknown>) =>
          callback(db),
      ),
    };

    service = new MachineEnrollmentConfirmationService(
      { db } as unknown as PrismaService,
      {
        getPublicKeyBase64: jest.fn(() => 'server-signing-public-key'),
      } as unknown as ServerSigningKeyService,
      undefined,
      { nudgeForMachine } as never,
      { recordWake } as never,
    );
    loggerLog = jest
      .spyOn(
        (
          service as unknown as {
            logger: { log: (...args: unknown[]) => void };
          }
        ).logger,
        'log',
      )
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns state-only pending evidence and then ready review evidence', async () => {
    row.state = MachineEnrollmentState.PENDING;
    const input: PollMachineEnrollmentRequestDto = {
      deviceSecret: DEVICE_SECRET,
    };

    await expect(service.poll(ENROLLMENT_ID, input)).resolves.toEqual({
      state: 'pending',
    });

    jest.advanceTimersByTime(MACHINE_ENROLLMENT_MIN_POLL_INTERVAL_MS);
    row.state = MachineEnrollmentState.AWAITING_MACHINE_CONFIRMATION;
    row.lastPolledAt = new Date(now.getTime() - 5_000);
    row.confirmationNonce = null;

    await expect(service.poll(ENROLLMENT_ID, input)).resolves.toMatchObject({
      state: 'ready',
      enrollmentId: ENROLLMENT_ID,
      machineId: MACHINE_ID,
      accountId: USER_ID,
      organizationId: ORGANIZATION_ID,
      controllerCredentialId: CREDENTIAL_ID,
      controllerCredentialFingerprint: `sha256:${'b'.repeat(64)}`,
    });
    expect(row.confirmationNonce).toEqual(expect.any(String));
    expect(loggerLog).toHaveBeenLastCalledWith(
      'Machine enrollment polled',
      expect.objectContaining({
        event: 'machine_enrollment.poll',
        operation: 'machine_enrollment',
        protocolVersion: 2,
        contractVersion: 'machine-enrollment-v2',
        enrollmentId: ENROLLMENT_ID,
        state: 'ready',
        decision: 'ready',
        reasonCode: 'poll_succeeded',
      }),
    );
  });

  it('enforces the advertised minimum poll interval without exposing evidence', async () => {
    row.state = MachineEnrollmentState.PENDING;
    await service.poll(ENROLLMENT_ID, { deviceSecret: DEVICE_SECRET });

    await expect(
      service.poll(ENROLLMENT_ID, { deviceSecret: DEVICE_SECRET }),
    ).rejects.toBeInstanceOf(MachineEnrollmentInvalidTransitionException);
  });

  it('returns and consumes the local account-mismatch warning before pending state', async () => {
    row.state = MachineEnrollmentState.PENDING;
    row.localOutcomeCode = MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH;
    row.localOutcomeIssuedAt = new Date(now.getTime() - 1_000);

    await expect(
      service.poll(ENROLLMENT_ID, { deviceSecret: DEVICE_SECRET }),
    ).resolves.toEqual({
      state: 'warning',
      code: MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH,
      message: MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH_MESSAGE,
    });
    expect(row.localOutcomeConsumedAt).toEqual(now);

    jest.advanceTimersByTime(MACHINE_ENROLLMENT_MIN_POLL_INTERVAL_MS);
    await expect(
      service.poll(ENROLLMENT_ID, { deviceSecret: DEVICE_SECRET }),
    ).resolves.toEqual({ state: 'pending' });
  });

  it('does not consume a local warning with the wrong device secret', async () => {
    row.state = MachineEnrollmentState.PENDING;
    row.localOutcomeCode = MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH;
    row.localOutcomeIssuedAt = new Date(now.getTime() - 1_000);

    await expect(
      service.poll(ENROLLMENT_ID, {
        deviceSecret: Buffer.alloc(32, 8).toString('base64'),
      }),
    ).rejects.toBeInstanceOf(MachineEnrollmentAuthenticationFailedException);
    expect(row.localOutcomeConsumedAt).toBeNull();
  });

  it.each([
    [
      'wrong device secret',
      { deviceSecret: Buffer.alloc(32, 8).toString('base64') },
    ],
    ['expired enrollment', { deviceSecret: DEVICE_SECRET }],
  ])('%s cannot poll or reveal review details', async (reason, input) => {
    if (reason === 'expired enrollment') {
      row.expiresAt = new Date(now.getTime() - 1);
    }

    await expect(service.poll(ENROLLMENT_ID, input)).rejects.toBeInstanceOf(
      MachineEnrollmentAuthenticationFailedException,
    );
  });

  it('activates exactly one machine binding and returns the credential once', async () => {
    const result = await service.confirm(ENROLLMENT_ID, signedRequest());

    expect(result).toMatchObject({
      serverSigningPublicKey: 'server-signing-public-key',
      authorizationProtocolVersion: 2,
      activatedBinding: expect.objectContaining({
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        accountId: USER_ID,
        organizationId: ORGANIZATION_ID,
        controllerCredentialPublicKey: {
          kty: 'EC',
          crv: 'P-256',
          x: Buffer.alloc(32, 1).toString('base64url'),
          y: Buffer.alloc(32, 2).toString('base64url'),
        },
      }),
    });
    expect(result.machineCredential).toMatch(/^mch_[A-Za-z0-9_-]+$/);
    expect(machineCreates).toHaveLength(1);
    expect(credentialCreates).toHaveLength(1);
    expect(credentialCreates[0]!.controllerInstallationId).toBe(
      '00000000-0000-4000-8000-000000000099',
    );
    expect(machineCreates[0]).not.toHaveProperty('token');
    expect(machineCreates[0]!.tokenHash).toBe(
      crypto
        .createHash('sha256')
        .update(result.machineCredential)
        .digest('hex'),
    );
    expect(JSON.stringify(machineCreates[0])).not.toContain(
      result.machineCredential,
    );
    expect(row.state).toBe(MachineEnrollmentState.CONSUMED);
    expect(nudgeForMachine).toHaveBeenCalledWith(MACHINE_ID);
    await Promise.resolve();
    expect(recordWake).toHaveBeenCalledWith('enrollment', 'claimed');
    expect(loggerLog).toHaveBeenCalledWith(
      'Machine enrollment local confirmation verified',
      expect.objectContaining({
        event: 'machine_enrollment.local_confirmation',
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        state: MachineEnrollmentState.AWAITING_MACHINE_CONFIRMATION,
        decision: 'verified',
        reasonCode: 'signature_verification_succeeded',
      }),
    );
    expect(loggerLog).toHaveBeenCalledWith(
      'Machine enrollment activated',
      expect.objectContaining({
        event: 'machine_enrollment.activation',
        operation: 'machine_enrollment',
        protocolVersion: 2,
        contractVersion: 'machine-enrollment-v2',
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        state: 'consumed',
        decision: 'activated_after_local_confirmation',
        reasonCode: 'activation_succeeded',
      }),
    );
    expect(JSON.stringify(loggerLog.mock.calls)).not.toContain(DEVICE_SECRET);
    expect(JSON.stringify(loggerLog.mock.calls)).not.toContain(CREDENTIAL_ID);
  });

  it('promotes the pending browser identity only after local confirmation', async () => {
    row.browserBindingCredentialHash = 'c'.repeat(64);
    row.browserBindingIssuedAt = new Date(now.getTime() - 1_000);
    row.browserBindingExpiresAt = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000,
    );
    const activatePending = jest.fn().mockResolvedValue(undefined);
    const bindingService = { activatePending };
    const confirmationService = new MachineEnrollmentConfirmationService(
      { db } as unknown as PrismaService,
      {
        getPublicKeyBase64: jest.fn(() => 'server-signing-public-key'),
      } as unknown as ServerSigningKeyService,
      bindingService as never,
    );

    await confirmationService.confirm(ENROLLMENT_ID, signedRequest());

    expect(activatePending).toHaveBeenCalledWith(
      db,
      {
        credentialHash: 'c'.repeat(64),
        issuedAt: row.browserBindingIssuedAt,
        expiresAt: row.browserBindingExpiresAt,
      },
      {
        controllerInstallationId: '00000000-0000-4000-8000-000000000099',
        controllerCredentialId: 'controller-credential-row',
        userId: USER_ID,
        organizationId: ORGANIZATION_ID,
      },
      expect.any(Date),
    );
  });

  it('rejects altered confirmation fields and signatures before any write', async () => {
    const altered = expectedConfirmation();
    altered.organizationId =
      '55555555-5555-4555-8555-555555555555' as OrganizationId;

    await expect(
      service.confirm(ENROLLMENT_ID, signedRequest(altered)),
    ).rejects.toBeInstanceOf(MachineEnrollmentAuthenticationFailedException);
    expect(machineCreates).toHaveLength(0);
    expect(credentialCreates).toHaveLength(0);

    const invalidSignature = signedRequest();
    invalidSignature.signature = Buffer.alloc(64, 9).toString('base64');
    await expect(
      service.confirm(ENROLLMENT_ID, invalidSignature),
    ).rejects.toBeInstanceOf(MachineEnrollmentAuthenticationFailedException);
  });

  it('wins one confirmation in a concurrent replay race and leaves no orphan rows', async () => {
    const results = await Promise.allSettled([
      service.confirm(ENROLLMENT_ID, signedRequest()),
      service.confirm(ENROLLMENT_ID, signedRequest()),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(machineCreates).toHaveLength(1);
    expect(credentialCreates).toHaveLength(1);
    expect(row.state).toBe(MachineEnrollmentState.CONSUMED);

    await expect(
      service.confirm(ENROLLMENT_ID, signedRequest()),
    ).rejects.toBeInstanceOf(MachineEnrollmentAuthenticationFailedException);
    expect(machineCreates).toHaveLength(1);
  });
});
