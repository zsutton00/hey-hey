import crypto from 'node:crypto';

import { io } from 'socket.io-client';

import { Configuration, MachinesApi } from '../shared/api/index';
import type {
  ControllerRevocationRequestDto,
  CreateMachineEnrollment201Response,
  ExistingMachineControllerEnrollmentRequestDto,
  ListMachineControllers200Response,
  MachineControllerInventoryRequestDto,
  MachineControllerReconciliationRequestDto,
  ReconcileMachineControllers200Response,
  RevokeMachineController200Response,
  WebSocketMachineAuthenticationErrorResponseReasonEnum,
} from '../shared/api/index';
import { WebSocketMachineAuthenticationErrorResponseReasonEnum as MachineAuthenticationReason } from '../shared/api/index';
import type { KeyPairStore } from '../credentials';
import { OAuthClient } from './oauth-client';
import { extractOrganizationIdFromToken } from './token-utils';

export interface MachineControllerManagementClient {
  createExistingMachineControllerEnrollment(
    machineId: string,
  ): Promise<{ data: CreateMachineEnrollment201Response }>;
  inspectMachineControllers(
    machineId: string,
  ): Promise<{ data: ListMachineControllers200Response }>;
  reconcileMachineControllers(
    machineId: string,
    knownControllerCredentialIds: ReadonlySet<string>,
  ): Promise<{ data: ReconcileMachineControllers200Response }>;
  revokeMachineControllerLocally(
    machineId: string,
    controllerCredentialId: string,
  ): Promise<{ data: RevokeMachineController200Response }>;
}

interface MachineControllerChallengeSource {
  issue(machineId: string): Promise<Buffer>;
}

export class GatewayMachineAuthenticationError extends Error {
  public constructor(
    public readonly reason: WebSocketMachineAuthenticationErrorResponseReasonEnum | null,
    message: string,
  ) {
    super(message);
    this.name = 'GatewayMachineAuthenticationError';
  }
}

const isChallengeFrame = (value: object | null): value is { challenge: string } =>
  value !== null &&
  Object.prototype.hasOwnProperty.call(value, 'challenge') &&
  typeof (value as { challenge?: string }).challenge === 'string';

const resolveServerUrl = (): string => {
  const raw = process.env['HEYHEY_API_URL']?.trim() || 'https://heyhey.dev';
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'https://heyhey.dev';
  }
};

/** Obtains the gateway-issued proof challenge without logging or retaining it. */
export class GatewayMachineControllerChallengeSource implements MachineControllerChallengeSource {
  private readonly keyPairStore: KeyPairStore;
  private readonly oauthClient: OAuthClient;
  private readonly serverUrl: string;
  private readonly timeoutMs: number;

  public constructor(
    keyPairStore: KeyPairStore,
    oauthClient: OAuthClient = new OAuthClient(),
    serverUrl: string = resolveServerUrl(),
    timeoutMs = 15_000,
  ) {
    this.keyPairStore = keyPairStore;
    this.oauthClient = oauthClient;
    this.serverUrl = serverUrl;
    this.timeoutMs = timeoutMs;
  }

  public async issue(machineId: string): Promise<Buffer> {
    const tokenResult = await this.oauthClient.getAccessToken();
    if (!tokenResult.success) {
      throw new Error(
        `Machine proof challenge requires account authentication: ${tokenResult.error}`,
      );
    }
    const organizationId = extractOrganizationIdFromToken(tokenResult.data);
    if (!organizationId) {
      throw new Error('Machine proof challenge requires an organization context.');
    }
    const machineCredential = await this.keyPairStore.loadMachineCredential(machineId);
    if (!machineCredential) {
      throw new Error('Machine proof challenge requires the local machine credential.');
    }

    return new Promise<Buffer>((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout>;
      const socket = io(`${this.serverUrl}/events`, {
        transports: ['websocket'],
        autoConnect: true,
        reconnection: false,
        extraHeaders: {
          Cookie: `accessToken=${encodeURIComponent(tokenResult.data)}`,
        },
      });
      timeout = setTimeout(() => {
        finish(new Error('Timed out waiting for the gateway machine proof challenge.'));
      }, this.timeoutMs);
      const finish = (error: Error | null, challenge?: Buffer): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.removeAllListeners();
        socket.disconnect();
        if (error) reject(error);
        else if (challenge) resolve(challenge);
        else reject(new Error('Machine proof challenge ended without challenge bytes.'));
      };

      socket.on('connect', () => {
        socket.emit('authenticate', {
          accessToken: tokenResult.data,
          organizationId,
          clientType: 'cli',
          protocolVersion: 2,
          machineId,
          machineCredential,
        });
      });
      socket.on('machine_challenge', (raw: object | null) => {
        if (!isChallengeFrame(raw)) {
          finish(new Error('Gateway machine proof challenge has an invalid shape.'));
          return;
        }
        if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(raw.challenge)) {
          finish(new Error('Gateway machine proof challenge is not valid base64.'));
          return;
        }
        const challenge = Buffer.from(raw.challenge, 'base64');
        if (challenge.length !== 32 || challenge.toString('base64') !== raw.challenge) {
          finish(new Error('Gateway machine proof challenge has an invalid length.'));
          return;
        }
        finish(null, challenge);
      });
      socket.on('authenticated', (response: object | null) => {
        const status =
          response !== null &&
          Object.prototype.hasOwnProperty.call(response, 'status') &&
          typeof (response as { status?: string }).status === 'string'
            ? (response as { status: string }).status
            : null;
        if (status === 'error') {
          const reason =
            response !== null &&
            Object.prototype.hasOwnProperty.call(response, 'reason') &&
            (response as { reason?: string }).reason === MachineAuthenticationReason.MachineRevoked
              ? MachineAuthenticationReason.MachineRevoked
              : null;
          const message =
            response !== null &&
            Object.prototype.hasOwnProperty.call(response, 'message') &&
            typeof (response as { message?: string }).message === 'string'
              ? (response as { message: string }).message
              : 'Gateway rejected machine proof challenge authentication.';
          finish(new GatewayMachineAuthenticationError(reason, message));
        }
      });
      socket.on('connect_error', (error: Error) => finish(error));
      socket.on('disconnect', (reason: string) => {
        if (!settled) finish(new Error(`Gateway machine proof challenge disconnected: ${reason}`));
      });
    });
  }
}

const resolveApiBaseUrl = (): string => {
  const raw = process.env['HEYHEY_API_URL']?.trim() || 'https://heyhey.dev';
  return raw.endsWith('/api/v1') ? raw : `${raw.replace(/\/$/u, '')}/api/v1`;
};

export const buildMachineControllerReconciliationRequest = (
  machineProof: ExistingMachineControllerEnrollmentRequestDto['machineProof'],
  knownControllerCredentialIds: ReadonlySet<string>,
): MachineControllerReconciliationRequestDto => ({
  authorizationProtocolVersion: 2,
  machineProof,
  knownControllerCredentialIds: [...knownControllerCredentialIds],
});

/**
 * Owns the machine-credential half of controller management. The durable
 * machine credential is loaded only at call time and is never returned from
 * this owner or included in diagnostics.
 */
class GeneratedMachineControllerManagementClient implements MachineControllerManagementClient {
  public constructor(
    private readonly keyPairStore: KeyPairStore,
    private readonly challengeSource: MachineControllerChallengeSource = new GatewayMachineControllerChallengeSource(
      keyPairStore,
    ),
  ) {}

  private async authenticatedApi(machineId: string): Promise<{
    api: MachinesApi;
    privateKeyPem: string;
  }> {
    const machineCredential = await this.keyPairStore.loadMachineCredential(machineId);
    const privateKeyPem = await this.keyPairStore.loadPrivateKey(machineId);
    if (!machineCredential || !privateKeyPem) {
      throw new Error(
        'Machine controller management requires the complete local machine authority.',
      );
    }
    return {
      api: new MachinesApi(
        new Configuration({ accessToken: machineCredential, basePath: resolveApiBaseUrl() }),
      ),
      privateKeyPem,
    };
  }

  private async machineProof(
    machineId: string,
    privateKeyPem: string,
  ): Promise<ExistingMachineControllerEnrollmentRequestDto['machineProof']> {
    const challenge = await this.challengeSource.issue(machineId);
    if (challenge.length === 0) throw new Error('Machine controller challenge is empty.');
    const signature = crypto
      .sign(null, challenge, crypto.createPrivateKey(privateKeyPem))
      .toString('base64');
    return {
      machineId,
      challenge: challenge.toString('base64'),
      signature,
    };
  }

  private async requestContext(machineId: string): Promise<{
    api: MachinesApi;
    proof: ExistingMachineControllerEnrollmentRequestDto['machineProof'];
  }> {
    const { api, privateKeyPem } = await this.authenticatedApi(machineId);
    return { api, proof: await this.machineProof(machineId, privateKeyPem) };
  }

  public async createExistingMachineControllerEnrollment(
    machineId: string,
  ): Promise<{ data: CreateMachineEnrollment201Response }> {
    const { api, proof } = await this.requestContext(machineId);
    const request: ExistingMachineControllerEnrollmentRequestDto = {
      authorizationProtocolVersion: 2,
      machineProof: proof,
    };
    return api.createExistingMachineControllerEnrollment({
      machineId,
      existingMachineControllerEnrollmentRequestDto: request,
    });
  }

  public async inspectMachineControllers(
    machineId: string,
  ): Promise<{ data: ListMachineControllers200Response }> {
    const { api, proof } = await this.requestContext(machineId);
    const request: MachineControllerInventoryRequestDto = {
      authorizationProtocolVersion: 2,
      machineProof: proof,
    };
    return api.inspectMachineControllers({
      machineId,
      machineControllerInventoryRequestDto: request,
    });
  }

  public async reconcileMachineControllers(
    machineId: string,
    knownControllerCredentialIds: ReadonlySet<string>,
  ): Promise<{ data: ReconcileMachineControllers200Response }> {
    const { api, proof } = await this.requestContext(machineId);
    const request = buildMachineControllerReconciliationRequest(
      proof,
      knownControllerCredentialIds,
    );
    return api.reconcileMachineControllers({
      machineId,
      machineControllerReconciliationRequestDto: request,
    });
  }

  public async revokeMachineControllerLocally(
    machineId: string,
    controllerCredentialId: string,
  ): Promise<{ data: RevokeMachineController200Response }> {
    const { api, proof } = await this.requestContext(machineId);
    const request: ControllerRevocationRequestDto = {
      authorizationProtocolVersion: 2,
      machineProof: proof,
    };
    return api.revokeMachineControllerLocally({
      machineId,
      controllerCredentialId,
      controllerRevocationRequestDto: request,
    });
  }
}

export const createDefaultMachineControllerManagementClient = (
  keyPairStore: KeyPairStore,
): MachineControllerManagementClient =>
  new GeneratedMachineControllerManagementClient(keyPairStore);
