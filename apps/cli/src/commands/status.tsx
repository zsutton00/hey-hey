import {
  createBrowserApiRuntime,
  type ApiRuntime,
} from '../../../../packages/ui-common/src/clients/shared';

import {
  MachineControllerAuthority,
  recoveryGuidanceForReadiness,
} from '../auth/machine-controller-authority';
import { createDefaultMachineEnrollmentClient } from '../auth/machine-enrollment-client';
import { OAuthClient } from '../auth/index';
import { createUiCommonAuthAdapter } from '../auth/ui-common-auth-adapter';
import { ControllerRegistryStore, KeyPairStore } from '../credentials';
import { ExecutionGrantStore } from '../server/controller-authorization/execution-grant-store';

export interface StatusCommandDependencies {
  oauthClient?: OAuthClient;
  authority?: MachineControllerAuthority;
  apiRuntime?: ApiRuntime;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}

const resolveApiBaseUrl = (): string => {
  const raw = process.env['HEYHEY_API_URL']?.trim() || 'https://heyhey.dev';
  return raw.endsWith('/api/v1') ? raw : `${raw.replace(/\/$/u, '')}/api/v1`;
};

const createDefaultAuthority = (apiRuntime: ApiRuntime | undefined): MachineControllerAuthority => {
  const keyPairStore = new KeyPairStore();
  return new MachineControllerAuthority({
    keyPairStore,
    controllerRegistryStore: new ControllerRegistryStore({ keyPairStore }),
    executionGrantStore: new ExecutionGrantStore({ keyPairStore }),
    ...(apiRuntime ? { machineDirectory: apiRuntime.clients.machines } : {}),
    enrollmentConfirmationClient: createDefaultMachineEnrollmentClient(),
  });
};

export const runStatusCommand = async (
  dependencies: StatusCommandDependencies = {},
): Promise<boolean> => {
  const log = dependencies.log ?? console.log;
  const logError = dependencies.logError ?? console.error;
  const oauthClient = dependencies.oauthClient ?? new OAuthClient();
  log(`Active profile: ${process.env['HEYHEY_PROFILE'] ?? 'default'}`);
  log('Account authentication: checking...');
  try {
    const authed = await oauthClient.isAuthenticated();
    if (!authed) {
      log('Account authentication: not authenticated');
      log('Machine connectivity: unavailable until account login');
      log('Execution readiness: blocked');
      log('Run `heyhey login`, then `heyhey pair` to enroll this machine.');
      return true;
    }

    const tokenResult = await oauthClient.getAccessToken();
    if (!tokenResult.success) {
      log(`Account authentication: authenticated but token issue (${tokenResult.error})`);
      log('Machine connectivity: unavailable');
      log('Execution readiness: blocked');
      return true;
    }
    log('Account authentication: authenticated');

    const apiRuntime =
      dependencies.apiRuntime ??
      createBrowserApiRuntime({
        baseUrl: resolveApiBaseUrl(),
        authAdapter: createUiCommonAuthAdapter(oauthClient),
      });
    apiRuntime.transport.setAuthToken(tokenResult.data);
    const authority = dependencies.authority ?? createDefaultAuthority(apiRuntime);
    const snapshot = await authority.readReadiness();

    if (!snapshot.machineId) {
      log('Machine connectivity: not paired');
    } else if (snapshot.machine) {
      log(`Machine connectivity: ${snapshot.machine.active ? 'connected' : 'disconnected'}`);
    } else {
      log('Machine connectivity: unavailable');
    }
    const executionReadiness =
      snapshot.state === 'ready' &&
      snapshot.serverExecutionReadiness !== null &&
      snapshot.serverExecutionReadiness !== 'READY'
        ? `blocked (${snapshot.serverExecutionReadiness})`
        : snapshot.state;
    log(`Execution readiness: ${executionReadiness}`);
    log(recoveryGuidanceForReadiness(snapshot.state));
    return true;
  } catch (error) {
    logError(
      `Status check failed: ${error instanceof Error ? error.message : 'Unknown status check error'}`,
    );
    return false;
  }
};
