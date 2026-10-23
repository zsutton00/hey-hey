import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultMachineEnrollmentClient } from '../machine-enrollment-client';
import type {
  ConfirmMachineEnrollmentResponseDto,
  CreateMachineEnrollmentRequestDto,
  PollMachineEnrollmentResponseDto,
} from '../../shared/api/index';

const ENROLLMENT_ID = 'enrollment-1';
const MACHINE_ID = 'machine-1';
const DEVICE_SECRET = 'device-secret';

interface CapturedRequest {
  method: string;
  url: string;
  body: unknown;
}

const readyResponse: PollMachineEnrollmentResponseDto = {
  state: 'ready',
  enrollmentId: ENROLLMENT_ID,
  machineId: MACHINE_ID,
  machineName: 'Alice laptop',
  osFamily: 'macos',
  cliVersion: '2.2.2',
  machineKeyFingerprint: 'machine-key-fingerprint',
  accountId: 'account-1',
  organizationId: 'organization-1',
  controllerLabel: 'Alice passkey',
  controllerCredentialId: 'credential-1',
  controllerCredentialFingerprint: 'controller-fingerprint',
  backupEligible: true,
  backupState: false,
  confirmationNonce: 'confirmation-nonce',
  expiresAt: '2099-08-12T22:00:00.000Z',
};

const activationResponse: ConfirmMachineEnrollmentResponseDto = {
  machineCredential: 'machine-credential',
  serverSigningPublicKey: 'server-signing-public-key',
  authorizationProtocolVersion: 2,
  activatedBinding: {
    enrollmentId: ENROLLMENT_ID,
    machineId: MACHINE_ID,
    machineName: 'Alice laptop',
    osFamily: 'macos',
    cliVersion: '2.2.2',
    accountId: 'account-1',
    organizationId: 'organization-1',
    controllerLabel: 'Alice passkey',
    controllerCredentialId: 'credential-1',
    controllerCredentialPublicKey: {
      kty: 'EC',
      crv: 'P-256',
      x: 'A'.repeat(43),
      y: 'B'.repeat(43),
    },
    controllerCredentialFingerprint: 'controller-fingerprint',
    backupEligible: true,
    backupState: false,
  },
};

const createResponse = {
  success: true,
  message: 'created',
  data: {
    enrollmentId: ENROLLMENT_ID,
    machineId: MACHINE_ID,
    deviceSecret: DEVICE_SECRET,
    userCode: 'BCDFG-HJKLM',
    expiresAt: '2099-08-12T22:00:00.000Z',
    pollingIntervalSeconds: 5,
  },
  timestamp: '2099-08-12T21:00:00.000Z',
  statusCode: 201,
};

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const serialized = Buffer.concat(chunks).toString('utf8');
  return serialized.length === 0 ? null : JSON.parse(serialized);
};

const send = (response: ServerResponse, data: unknown, statusCode = 200): void => {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      success: statusCode < 400,
      message: statusCode < 400 ? 'ok' : 'error',
      data,
      timestamp: '2099-08-12T21:00:00.000Z',
      statusCode,
    }),
  );
};

describe('createDefaultMachineEnrollmentClient', () => {
  let server: Server;
  let baseUrl: string;
  let requests: CapturedRequest[];
  let previousApiUrl: string | undefined;

  beforeEach(async () => {
    requests = [];
    previousApiUrl = process.env['HEYHEY_API_URL'];
    server = createServer(async (request, response) => {
      const body = await readBody(request);
      requests.push({ method: request.method ?? '', url: request.url ?? '', body });

      if (request.method === 'POST' && request.url === '/api/v1/machines/enrollments') {
        send(response, createResponse.data, 201);
        return;
      }
      if (
        request.method === 'POST' &&
        request.url === `/api/v1/machines/enrollments/${ENROLLMENT_ID}/poll`
      ) {
        send(response, readyResponse);
        return;
      }
      if (
        request.method === 'POST' &&
        request.url === `/api/v1/machines/enrollments/${ENROLLMENT_ID}/confirm`
      ) {
        send(response, activationResponse);
        return;
      }
      send(response, null, 404);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('server did not bind');
    baseUrl = `http://127.0.0.1:${String(address.port)}`;
    process.env['HEYHEY_API_URL'] = baseUrl;
  });

  afterEach(async () => {
    if (previousApiUrl === undefined) delete process.env['HEYHEY_API_URL'];
    else process.env['HEYHEY_API_URL'] = previousApiUrl;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('uses generated create, POST poll, and POST confirm operations with closed request bodies', async () => {
    const client = createDefaultMachineEnrollmentClient();
    const createRequest: CreateMachineEnrollmentRequestDto = {
      machinePublicKey: 'machine-public-key',
      machineName: 'Alice laptop',
      osFamily: 'macos',
      cliVersion: '2.2.2',
      authorizationProtocolVersion: 2,
    };

    await expect(client.createMachineEnrollment(createRequest)).resolves.toMatchObject({
      data: { data: createResponse.data },
    });
    await expect(client.pollMachineEnrollment(ENROLLMENT_ID, DEVICE_SECRET)).resolves.toEqual(
      readyResponse,
    );
    await expect(
      client.confirmMachineEnrollment({
        deviceSecret: DEVICE_SECRET,
        confirmation: {
          enrollmentId: ENROLLMENT_ID,
          machineId: MACHINE_ID,
          accountId: 'account-1',
          organizationId: 'organization-1',
          controllerCredentialId: 'credential-1',
          confirmationNonce: 'confirmation-nonce',
        },
        signature: 'signature',
      }),
    ).resolves.toEqual(activationResponse);

    expect(requests).toHaveLength(3);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/api/v1/machines/enrollments',
      body: createRequest,
    });
    expect(requests[1]).toMatchObject({
      method: 'POST',
      url: `/api/v1/machines/enrollments/${ENROLLMENT_ID}/poll`,
      body: { deviceSecret: DEVICE_SECRET },
    });
    expect(requests[2]).toMatchObject({
      method: 'POST',
      url: `/api/v1/machines/enrollments/${ENROLLMENT_ID}/confirm`,
      body: {
        deviceSecret: DEVICE_SECRET,
        confirmation: {
          enrollmentId: ENROLLMENT_ID,
          machineId: MACHINE_ID,
          accountId: 'account-1',
          organizationId: 'organization-1',
          controllerCredentialId: 'credential-1',
          confirmationNonce: 'confirmation-nonce',
        },
        signature: 'signature',
      },
    });
  });
});
