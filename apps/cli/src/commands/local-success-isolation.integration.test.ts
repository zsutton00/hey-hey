import { AxiosHeaders } from 'axios';
import {
  createHash,
  createHmac,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  verify,
} from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runPairCommand } from './pair';
import { LocalApprovalSecret } from '../auth/local-approval';
import { LocalCliState } from '../local-app/local-cli-state';
import { LocalKeyPairStore } from '../local-app/local-key-pair-store';
import { KeyPairStore } from '../credentials/keypair';
import { CliState } from '../credentials/cli-state';
import { KeyringPlatformStore, type KeyringEntryFactory } from '../credentials/platforms/keyring';
import { LocalAgentInfrastructure } from '../server/local-agent-infrastructure';
import { canonicalizeJson, canonicalizeJsonObject } from '../shared/canonical-json';
import { asOrganizationId, asUserId } from '../test-utils/contract-ids';
import {
  CURRENT_AGENT_OPERATIONS,
  CURRENT_AGENT_OPERATION_CATEGORY,
  type HostActionAdmissionRequest,
} from '../server/controller-authorization/types';
import type {
  ControllerCredentialSummaryDto,
  FirstLocalGrantIntent,
  MachineEnrollmentPollReadyDto,
} from '../shared/api';
import { MachineOptionsStore } from '../options/machine-options-store';

// Only the OS keychain and remote API are replaced. Enrollment proof checking,
// machine signing, durable activation, server readiness and admission are real.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('pairs locally, starts server infrastructure and restores authority and saved Runs without accepting foreign authority', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-success-isolation-'));
  const servers: LocalAgentInfrastructure[] = [];
  try {
    const entries = new Map<string, string>();
    const accesses: string[] = [];
    const factory: KeyringEntryFactory = (service, account) => {
      const key = `${service}:${account}`;
      accesses.push(key);
      return {
        getPassword: () => entries.get(key) ?? null,
        setPassword: (value) => {
          entries.set(key, value);
        },
        deletePassword: () => entries.delete(key),
      };
    };
    const machineId = '00000000-0000-4000-8000-000000000001';
    const enrollmentId = '00000000-0000-4000-8000-000000000002';
    const grantId = '00000000-0000-4000-8000-000000000003';
    const userId = asUserId('account-1');
    const organizationId = asOrganizationId('organization-1');
    const now = Date.now();
    const expiresAt = new Date(now + 300_000).toISOString();
    const controllerKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey;
    const jwk = controllerKey.export({ format: 'jwk' });
    if (!jwk.x || !jwk.y) {
      throw new Error('Expected EC public key');
    }
    const publicKey = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } as const;
    const fingerprint = `sha256:${createHash('sha256')
      .update(controllerKey.export({ type: 'spki', format: 'der' }))
      .digest('hex')}`;
    const intent = {
      version: 1,
      enrollmentId,
      machineId,
      userId,
      organizationId,
      projectId: 'project-1',
      controllerInstallationId: 'browser-1',
      cadence: 'ONE_MONTH',
      policyRevision: 1,
      allowedActionTypes: [...CURRENT_AGENT_OPERATIONS],
      allowedActionCategories: [...new Set(Object.values(CURRENT_AGENT_OPERATION_CATEGORY))],
      target: { kind: 'CLI_READ', id: machineId },
      issuedAtMs: now,
      nonce: randomBytes(32).toString('base64url'),
    } satisfies FirstLocalGrantIntent;
    const registrationChallenge = Buffer.concat([
      Buffer.from(intent.nonce, 'base64url'),
      createHash('sha256')
        .update('heyhey-first-local-grant-v1')
        .update(Buffer.from([0]))
        .update(canonicalizeJson(intent))
        .digest(),
    ]).toString('base64url');
    const localApproval = new LocalApprovalSecret();
    const claim = {
      state: 'ready',
      enrollmentId,
      machineId,
      machineName: 'Local laptop',
      osFamily: 'macos',
      cliVersion: '4.4.0',
      machineKeyFingerprint: 'machine-fingerprint',
      accountId: userId,
      organizationId,
      controllerCredentialId: 'local-controller',
      controllerLabel: 'Local passkey',
      controllerCredentialFingerprint: fingerprint,
      controllerCredentialPublicKey: publicKey,
      backupEligible: true,
      backupState: false,
      registrationChallenge,
      confirmationNonce: 'confirmation-nonce',
      expiresAt,
      firstLocalGrant: intent,
      localApprovalProof: createHmac(
        'sha256',
        Buffer.from(localApproval.fragmentValue, 'base64url'),
      )
        .update(
          [
            'heyhey-local-approval-v2',
            enrollmentId,
            userId,
            organizationId,
            'local-controller',
            fingerprint.slice('sha256:'.length),
            registrationChallenge,
          ].join('\n'),
        )
        .digest('base64url'),
    } satisfies MachineEnrollmentPollReadyDto;
    const local = new LocalCliState(
      join(directory, 'installation'),
      new LocalKeyPairStore(factory),
    );
    const foreign = new CliState(
      new KeyPairStore({
        namespaceOverride: '',
        platformStoreOverride: new KeyringPlatformStore(factory),
      }),
      join(directory, 'hosted'),
    );
    await foreign.keyPairStore.setCurrentMachineId(machineId);
    await foreign.keyPairStore.generateAndStoreKeyPair(machineId);
    await foreign.keyPairStore.storeMachineCredential(machineId, 'hosted-token');
    const foreignKeys = new Map(entries);
    const foreignFile = join(directory, 'hosted', 'keep.json');
    await mkdir(join(directory, 'hosted'), { recursive: true });
    await foreign.executionGrantStore.list();
    await writeFile(
      foreignFile,
      JSON.stringify({ projects: ['hosted-project'], selectedModel: 'hosted-model' }),
    );
    const foreignBytes = await readFile(foreignFile);
    vi.stubEnv('HEYHEY_SESSION_DIR', foreign.directory);
    vi.stubEnv('HEYHEY_AUTHORIZATION_DIR', foreign.directory);
    vi.stubEnv('HEYHEY_REPO_DIR', foreign.directory);
    vi.stubEnv('HEYHEY_PROFILE', 'foreign');
    const terminalApproval = vi.fn(() => Promise.resolve(false));
    let signedConfirmation = false;
    expect(
      await runPairCommand({
        keyPairStore: local.keyPairStore,
        controllerRegistryStore: local.controllerRegistryStore,
        executionGrantStore: local.executionGrantStore,
        localApproval,
        prompter: { confirm: terminalApproval },
        log: () => undefined,
        logError: (message) => {
          throw new Error(message);
        },
        machinesApi: {
          createMachineEnrollment: () =>
            Promise.resolve({
              data: {
                success: true,
                message: 'opened',
                timestamp: new Date(now).toISOString(),
                statusCode: 201,
                data: {
                  enrollmentId,
                  machineId,
                  deviceSecret: 'device-secret',
                  userCode: 'BCDFG-HJKLM',
                  expiresAt,
                  pollingIntervalSeconds: 0,
                },
              },
            }),
          pollMachineEnrollment: () => Promise.resolve(claim),
          confirmMachineEnrollment: async (request) => {
            expect(await local.keyPairStore.loadCurrentMachineId()).toBeNull();
            const privateKey = await local.keyPairStore.loadPrivateKey(machineId);
            if (!privateKey || !request.confirmation.firstLocalGrant) {
              throw new Error('Missing signed grant');
            }
            expect(
              verify(
                null,
                Buffer.from(canonicalizeJsonObject(request.confirmation)),
                createPublicKey(privateKey),
                Buffer.from(request.signature, 'base64'),
              ),
            ).toBe(true);
            signedConfirmation = true;
            const issuedAtMs = request.confirmation.firstLocalGrant.issuedAtMs;
            return {
              machineCredential: 'local-machine-token',
              serverSigningPublicKey: 'signing-key',
              authorizationProtocolVersion: 2,
              activatedBinding: {
                enrollmentId,
                machineId,
                machineName: claim.machineName,
                osFamily: claim.osFamily,
                cliVersion: claim.cliVersion,
                accountId: userId,
                organizationId,
                controllerLabel: claim.controllerLabel,
                controllerCredentialId: claim.controllerCredentialId,
                controllerCredentialPublicKey: publicKey,
                controllerCredentialFingerprint: fingerprint,
                backupEligible: true,
                backupState: false,
              },
              firstLocalGrant: {
                authorizationId: 'authorization-1',
                grantId,
                grantDescriptor: {
                  scope: 'controller_device_window',
                  controllerCredentialId: claim.controllerCredentialId,
                  controllerInstallationId: intent.controllerInstallationId,
                  machineId,
                  userId,
                  organizationId,
                  cadence: intent.cadence,
                  policyRevision: intent.policyRevision,
                  allowedActionTypes: intent.allowedActionTypes,
                  allowedActionCategories: intent.allowedActionCategories,
                  issuedAtMs,
                  effectiveExpiresAtMs: issuedAtMs + 30 * 86400_000,
                },
              },
            };
          },
        },
      }),
    ).toBe(true);
    expect(signedConfirmation).toBe(true);
    expect(terminalApproval).not.toHaveBeenCalled();
    const token = [
      'e30',
      Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + 86400 })).toString('base64url'),
      'signature',
    ].join('.');
    await local.credentials.store('heyhey:oauth:local-application', {
      accessToken: token,
      refreshToken: 'local-refresh',
      expiresAt: new Date(now + 86400_000).toISOString(),
    });
    const controller = {
      credentialId: claim.controllerCredentialId,
      controllerCredentialPublicKey: publicKey,
      label: claim.controllerLabel,
      fingerprint,
      createdAt: new Date(now).toISOString(),
      lastUsedAt: null,
      backupEligible: true,
      backupState: false,
      revocationState: 'ACTIVE',
      revokedAt: null,
    } satisfies ControllerCredentialSummaryDto;
    const start = async (state: LocalCliState) => {
      const server = new LocalAgentInfrastructure({
        state,
        apiBaseUrl: 'http://localhost:3000',
        writeLogLine: () => undefined,
      });
      servers.push(server);
      vi.spyOn(server.apiRuntime.clients.machines, 'listMachines').mockResolvedValue({
        data: {
          success: true,
          message: 'OK',
          timestamp: new Date().toISOString(),
          statusCode: 200,
          data: {
            machines: [
              {
                machineId,
                name: claim.machineName,
                pairedAt: new Date(now).toISOString(),
                active: true,
                authorizationProtocolVersion: 2,
                executionReadiness: 'READY',
                currentControllerEligibility: 'ELIGIBLE',
                currentControllerCredentialId: claim.controllerCredentialId,
              },
            ],
          },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: new AxiosHeaders() },
      });
      vi.spyOn(
        server.machineControllerManagementClient,
        'reconcileMachineControllers',
      ).mockResolvedValue({
        data: {
          success: true,
          message: 'OK',
          timestamp: new Date().toISOString(),
          statusCode: 200,
          data: {
            machineId,
            authorizationProtocolVersion: 2,
            enrollmentState: 'READY',
            executionReadiness: 'READY',
            controllers: [controller],
            revokedControllerCredentialIds: [],
          },
        },
      });
      await server.initialize();
      return server;
    };
    const request = (id = grantId): HostActionAdmissionRequest => ({
      machineId,
      userId,
      organizationId,
      projectId: 'project-1',
      controllerInstallationId: intent.controllerInstallationId,
      actionType: 'CLI_READ',
      actionCategory: 'CLI_READ',
      actionPayloadHash: 'a'.repeat(64),
      target: { kind: 'CLI_READ', id: machineId, revision: null },
      agentSessionId: null,
      taskMonitorId: null,
      envelopeNonce: randomBytes(16).toString('base64url'),
      authorization: { kind: 'bounded_grant', grantId: id },
    });
    const first = await start(local);
    const runInput = {
      entity: null,
      agentic_session_id: 'identical-restored-run',
      services: [{ id: 'service-1', path: directory }],
      launchServiceId: 'service-1',
      provider: 'opencode',
      provider_session_id: 'local-provider-session',
      conversationId: 'conversation-1',
      promptType: 'entity_conversation',
      contextMetadata: {
        capturedAt: new Date(now).toISOString(),
        organizationId,
        projectId: 'project-1',
        agentSessionId: enrollmentId,
        userComments: ['Continue the existing project'],
        fileReferences: { resolved: [], unresolved: [] },
      },
    };
    await first.runStore.createRun(runInput);
    const localOptions = new MachineOptionsStore({
      filePath: join(join(directory, 'installation', 'cli'), 'options.json'),
    });
    await localOptions.update({ intentFirst: true, remoteToolCallViewing: false });
    const foreignServer = new LocalAgentInfrastructure({
      state: foreign,
      writeLogLine: () => undefined,
    });
    servers.push(foreignServer);
    await foreignServer.runStore.initialize();
    await foreignServer.runStore.createRun({
      ...runInput,
      provider_session_id: 'hosted-provider-session',
    });
    const admitted = request();
    expect(await first.hostActionAdmission.admit(admitted)).toMatchObject({ admitted: true });
    const installed = await local.executionGrantStore.get(grantId);
    if (!installed) {
      throw new Error('Expected durable grant');
    }
    await foreign.executionGrantStore.create({
      grantId: 'foreign-grant',
      descriptor: {
        ...installed,
        userId,
        organizationId,
        controllerCredentialId: 'foreign-controller',
      },
      descriptorHash: 'b'.repeat(64),
      controllerCredentialFingerprint: 'sha256:' + 'c'.repeat(64),
    });
    expect(await foreignServer.hostActionAdmission.admit(request('foreign-grant'))).toMatchObject({
      admitted: true,
    });
    const foreignGrantBytes = await readFile(foreign.executionGrantStore.path);
    const foreignSnapshot = new Map(entries);
    await first.dispose();
    vi.stubEnv('HEYHEY_API_URL', 'https://heyhey.dev');
    vi.stubEnv('HEYHEY_PROFILE', 'changed');
    const restartedState = new LocalCliState(
      join(directory, 'installation'),
      new LocalKeyPairStore(factory),
    );
    accesses.length = 0;
    const restarted = await start(restartedState);
    expect(await restarted.runStore.getRun('identical-restored-run')).toMatchObject({
      provider_session_id: 'local-provider-session',
    });
    expect(await foreignServer.runStore.getRun('identical-restored-run')).toMatchObject({
      provider_session_id: 'hosted-provider-session',
    });
    expect(
      await new MachineOptionsStore({
        filePath: join(join(directory, 'installation', 'cli'), 'options.json'),
      }).read(),
    ).toMatchObject({ intentFirst: true, remoteToolCallViewing: false });
    expect(await restarted.keyPairStore.loadMachineCredential(machineId)).toBe(
      'local-machine-token',
    );
    expect(
      (await restarted.controllerRegistryStore.read())?.controllers.map(
        (entry) => entry.controllerCredentialId,
      ),
    ).toEqual(['local-controller']);
    expect(await restarted.hostActionAdmission.admit(request())).toMatchObject({ admitted: true });
    expect(await restarted.hostActionAdmission.admit(admitted)).toMatchObject({
      admitted: false,
      reason: 'REPLAY_DETECTED',
    });
    expect(await restarted.hostActionAdmission.admit(request('foreign-grant'))).toMatchObject({
      admitted: false,
      reason: 'GRANT_NOT_ACTIVE',
    });
    expect(accesses.every((key) => key.startsWith('heyhey-local-cli:'))).toBe(true);
    for (const [key, value] of foreignKeys) {
      expect(entries.get(key)).toBe(value);
    }
    for (const [key, value] of foreignSnapshot) {
      if (key.startsWith('heyhey-cli:')) {
        expect(entries.get(key)).toBe(value);
      }
    }
    expect(await readFile(foreignFile)).toEqual(foreignBytes);
    expect(await readFile(foreign.executionGrantStore.path)).toEqual(foreignGrantBytes);
  } finally {
    await Promise.all(servers.map((server) => server.dispose()));
    await rm(directory, { recursive: true, force: true });
  }
});
