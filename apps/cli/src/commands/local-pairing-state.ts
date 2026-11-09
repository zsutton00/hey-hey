import { MachineControllerAuthority } from '../auth/machine-controller-authority';
import { createDefaultMachineEnrollmentClient } from '../auth/machine-enrollment-client';
import { OAuthClient } from '../auth/index';
import { createUiCommonAuthAdapter } from '../auth/ui-common-auth-adapter';
import { ControllerRegistryStore, KeyPairStore } from '../credentials';
import { ExecutionGrantStore } from '../server/controller-authorization/execution-grant-store';
import { createBrowserApiRuntime } from '../shared/runtime/clients/shared';
import { classifyStartupReadiness } from '../server/startup-readiness';

/**
 * What `heyhey local` acts on: `recognised` reconnects without pairing, `not-recognised` runs
 * first-time local pairing in place of the stale record, `none` runs first-time local pairing.
 */
export type LocalPairingState = 'recognised' | 'not-recognised' | 'none';

/**
 * Asks the local backend whether the machine remembered in this keychain namespace is one it
 * knows, using the same readiness classification server startup applies. The keychain alone
 * never decides that the computer is paired.
 */
export class LocalPairingStateReader {
  private readonly authority: MachineControllerAuthority;

  public constructor(
    private readonly keyPairStore: KeyPairStore,
    apiBaseUrl: string,
    private readonly oauthClient: OAuthClient = new OAuthClient(),
    authority?: MachineControllerAuthority,
  ) {
    this.authority =
      authority ??
      new MachineControllerAuthority({
        keyPairStore,
        controllerRegistryStore: new ControllerRegistryStore({ keyPairStore }),
        executionGrantStore: new ExecutionGrantStore({ keyPairStore }),
        machineDirectory: createBrowserApiRuntime({
          baseUrl: apiBaseUrl,
          authAdapter: createUiCommonAuthAdapter(this.oauthClient),
        }).clients.machines,
        enrollmentConfirmationClient: createDefaultMachineEnrollmentClient(),
      });
  }

  public async read(): Promise<LocalPairingState> {
    if (!(await this.keyPairStore.loadCurrentMachineId())) {
      return 'none';
    }

    const snapshot = await this.authority.readReadiness();
    const outcome = classifyStartupReadiness(snapshot, '');
    if (outcome.kind !== 'pairing-required') {
      // Ready, or blocked with its own guidance that server startup presents.
      return 'recognised';
    }

    return snapshot.machineId ? 'not-recognised' : 'none';
  }
}
