import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestKeyPairStore } from '../credentials/keypair.test-support';
import { createTestOAuthClient } from '../server/__tests__/helpers/test-oauth-client';
import { MachinesApiAxiosParamCreator } from '../shared/api/generated/api';
import {
  buildMachineControllerReconciliationRequest,
  GatewayMachineAuthenticationError,
  GatewayMachineControllerChallengeSource,
} from './machine-controller-management';

interface MockSocket extends EventEmitter {
  disconnect: () => void;
}

const ioFactory = vi.fn<() => MockSocket>();

vi.mock('socket.io-client', () => ({
  io: () => ioFactory(),
}));

const createMockSocket = (): MockSocket => {
  const socket = new EventEmitter() as MockSocket;
  socket.disconnect = vi.fn();
  return socket;
};

const encodeTokenWithOrg = (organizationId: string): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ organizationId })).toString('base64url');
  return `${header}.${payload}.sig`;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('gateway machine controller challenge', () => {
  it('preserves the authoritative machine-revoked authentication reason', async () => {
    const socket = createMockSocket();
    ioFactory.mockReturnValue(socket);
    const keyPairStore = createTestKeyPairStore();
    vi.spyOn(keyPairStore, 'loadMachineCredential').mockResolvedValue('machine-credential');
    const oauthClient = createTestOAuthClient({
      getAccessToken: async () => ({
        success: true,
        data: encodeTokenWithOrg('00000000-0000-4000-8000-000000000002'),
      }),
    });
    const source = new GatewayMachineControllerChallengeSource(
      keyPairStore,
      oauthClient,
      'http://test',
    );

    const challenge = source.issue('00000000-0000-4000-8000-000000000001');
    await new Promise((resolve) => setImmediate(resolve));
    socket.emit('authenticated', {
      status: 'error',
      reason: 'machine_revoked',
      message: 'machine revoked',
    });

    await expect(challenge).rejects.toEqual(
      expect.objectContaining<Partial<GatewayMachineAuthenticationError>>({
        name: 'GatewayMachineAuthenticationError',
        reason: 'machine_revoked',
        message: 'machine revoked',
      }),
    );
  });
});

describe('machine controller reconciliation request', () => {
  it('serializes non-empty controller credential IDs as a JSON array', async () => {
    const request = buildMachineControllerReconciliationRequest(
      {
        machineId: '00000000-0000-4000-8000-000000000001',
        challenge: 'challenge',
        signature: 'signature',
      },
      new Set(['controller-1', 'controller-2']),
    );

    const axiosRequest = await MachinesApiAxiosParamCreator().reconcileMachineControllers(
      '00000000-0000-4000-8000-000000000001',
      request,
    );

    expect(JSON.parse(String(axiosRequest.options.data))).toMatchObject({
      knownControllerCredentialIds: ['controller-1', 'controller-2'],
    });
  });
});
