import { logOutAccount, type AccountLogoutResult } from '../auth/account-logout';
import type {
  LocalMachineReadinessState,
  MachineControllerAuthority,
} from '../auth/machine-controller-authority';
import {
  MachineEnrollmentCeremony,
  type MachineEnrollmentCeremonyPorts,
  type MachineEnrollmentOutcome,
} from '../auth/machine-enrollment-ceremony';
import type { MachineEnrollmentConfirmationResult } from '../auth/machine-enrollment-confirmation';
import { createDefaultMachineEnrollmentClient } from '../auth/machine-enrollment-client';
import type { OAuthClient } from '../auth/oauth-client';
import type { ControllerRegistryStore, KeyPairStore } from '../credentials';
import type { ExecutionGrantStore } from '../server/controller-authorization/execution-grant-store';
import type { ServerLogger } from '../server/logger';
import type { PlatformConnectionState, PlatformWebSocketManager } from '../server/platform-ws';
import { pairMachine, resolvePairDependencies } from './pair';

/**
 * MachineActions — the Pair, Add controller and Log out actions a screen
 * offers, bound to the live account, pairing and controller-authority owners.
 *
 * Account authentication, platform connection and execution readiness are
 * observed separately from those owners; availability is derived from what
 * they report, not re-decided here. One operation runs at a time. A finished,
 * failed or cancelled operation releases the slot and leaves every other
 * action and session observation usable.
 */

export type MachineActionId = 'pair' | 'add-controller' | 'log-out';

export type MachineActionUnavailableReason =
  | 'operation-in-progress'
  | 'signed-out'
  | 'machine-not-paired'
  | 'machine-authority-unusable'
  | 'already-paired';

export type MachineActionAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: MachineActionUnavailableReason };

export interface MachineActionDescriptor {
  readonly id: MachineActionId;
  readonly label: string;
  readonly availability: MachineActionAvailability;
}

export type AccountAuthenticationState = 'unknown' | 'signed-in' | 'signed-out';

export interface MachineStatusSnapshot {
  readonly revision: number;
  readonly account: AccountAuthenticationState;
  readonly connection: PlatformConnectionState;
  /** `unknown` until read, or when the platform directory could not be reached. */
  readonly readiness: LocalMachineReadinessState | 'unknown';
  readonly actions: readonly MachineActionDescriptor[];
}

export type MachineStatusObserver = (snapshot: MachineStatusSnapshot) => void;

export type MachineActionOperation =
  | {
      readonly kind: 'ceremony';
      readonly actionId: 'pair' | 'add-controller';
      /** Observe for steps; answer `local-review` with `respond`; `cancel` to leave. */
      readonly ceremony: MachineEnrollmentCeremony;
      readonly completion: Promise<MachineEnrollmentOutcome>;
    }
  | {
      readonly kind: 'logout';
      readonly actionId: 'log-out';
      readonly completion: Promise<AccountLogoutResult>;
    };

export type MachineActionStart =
  | { readonly started: true; readonly operation: MachineActionOperation }
  | { readonly started: false; readonly reason: MachineActionUnavailableReason };

export interface MachineActionsDependencies {
  oauthClient: Pick<OAuthClient, 'isAuthenticated' | 'logout' | 'onAuthChanged'>;
  platformWebSocketManager: Pick<
    PlatformWebSocketManager,
    'getConnectionState' | 'onConnectionStateChanged' | 'onMachineRevoked'
  >;
  machineControllerAuthority: Pick<MachineControllerAuthority, 'readReadiness' | 'addController'>;
  pair: (ports: MachineEnrollmentCeremonyPorts) => Promise<MachineEnrollmentConfirmationResult>;
  logger: ServerLogger;
}

const LABELS: Record<MachineActionId, string> = {
  pair: 'Pair',
  'add-controller': 'Add controller',
  'log-out': 'Log out',
};

const UNUSABLE_AUTHORITY: ReadonlySet<LocalMachineReadinessState> = new Set([
  'machine-revoked',
  'machine-unrecognized',
  'locally-inconsistent',
]);

/** A usable pairing; Pair is offered again only when the machine is unpaired or its pairing is unusable. */
const PAIRED: ReadonlySet<LocalMachineReadinessState> = new Set([
  'ready',
  'no-controller',
  'legacy-controller-enrollment-required',
]);

const FAILED: MachineEnrollmentConfirmationResult = { outcome: 'failed' };

export class MachineActions {
  private readonly observers = new Set<MachineStatusObserver>();
  private readonly unsubscribes: Array<() => void> = [];
  private account: AccountAuthenticationState = 'unknown';
  private connection: PlatformConnectionState;
  private readiness: LocalMachineReadinessState | 'unknown' = 'unknown';
  private readinessRead: object | null = null;
  private active: MachineActionOperation | null = null;
  private revision = 0;
  private disposed = false;

  public constructor(private readonly dependencies: MachineActionsDependencies) {
    const ws = dependencies.platformWebSocketManager;
    this.connection = ws.getConnectionState();
    this.unsubscribes.push(
      dependencies.oauthClient.onAuthChanged((token) =>
        this.setAccount(token === null ? 'signed-out' : 'signed-in'),
      ),
      ws.onConnectionStateChanged((state) => {
        this.connection = state;
        this.publish();
        if (state === 'connected') this.refreshReadiness();
      }),
      ws.onMachineRevoked(() => this.refreshReadiness()),
    );
    void dependencies.oauthClient.isAuthenticated().then(
      (authenticated) => this.setAccount(authenticated ? 'signed-in' : 'signed-out'),
      (error: unknown) => {
        dependencies.logger.warn('machine_actions.account_read_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
    this.refreshReadiness();
  }

  public snapshot(): MachineStatusSnapshot {
    return Object.freeze({
      revision: this.revision,
      account: this.account,
      connection: this.connection,
      readiness: this.readiness,
      actions: Object.freeze(
        (['pair', 'add-controller', 'log-out'] as const).map((id) =>
          Object.freeze({ id, label: LABELS[id], availability: this.availability(id) }),
        ),
      ),
    });
  }

  public observe(observer: MachineStatusObserver): {
    snapshot: MachineStatusSnapshot;
    unsubscribe: () => void;
  } {
    if (!this.disposed) this.observers.add(observer);
    return {
      snapshot: this.snapshot(),
      unsubscribe: () => {
        this.observers.delete(observer);
      },
    };
  }

  public start(id: MachineActionId): MachineActionStart {
    const availability = this.availability(id);
    if (!availability.available) return { started: false, reason: availability.reason };
    const operation = id === 'log-out' ? this.startLogout() : this.startCeremony(id);
    this.active = operation;
    this.publish();
    void operation.completion.finally(() => {
      if (this.active === operation) this.active = null;
      this.publish();
      this.refreshReadiness();
    });
    return { started: true, operation };
  }

  /** Re-reads execution readiness from the controller authority. */
  public refreshReadiness(): void {
    if (this.disposed) return;
    const read = {};
    this.readinessRead = read;
    void this.dependencies.machineControllerAuthority.readReadiness().then(
      (snapshot) => {
        if (this.readinessRead !== read) return;
        this.readiness = snapshot.state;
        this.publish();
      },
      (error: unknown) => {
        if (this.readinessRead !== read) return;
        this.dependencies.logger.warn('machine_actions.readiness_read_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.readiness = 'unknown';
        this.publish();
      },
    );
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.active?.kind === 'ceremony') this.active.ceremony.cancel();
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.observers.clear();
  }

  private availability(id: MachineActionId): MachineActionAvailability {
    if (this.active) return { available: false, reason: 'operation-in-progress' };
    switch (id) {
      case 'pair':
        return this.readiness !== 'unknown' && PAIRED.has(this.readiness)
          ? { available: false, reason: 'already-paired' }
          : { available: true };
      case 'add-controller':
        if (this.readiness === 'unpaired')
          return { available: false, reason: 'machine-not-paired' };
        if (this.readiness !== 'unknown' && UNUSABLE_AUTHORITY.has(this.readiness)) {
          return { available: false, reason: 'machine-authority-unusable' };
        }
        return { available: true };
      case 'log-out':
        return this.account === 'signed-out'
          ? { available: false, reason: 'signed-out' }
          : { available: true };
    }
  }

  private startCeremony(id: 'pair' | 'add-controller'): MachineActionOperation {
    const ceremony = new MachineEnrollmentCeremony();
    const authority = this.dependencies.machineControllerAuthority;
    const result = ceremony.run(
      (ports) =>
        id === 'pair' ? this.dependencies.pair(ports) : authority.addController({ ports }),
      (error) => {
        this.dependencies.logger.error('machine_actions.ceremony_failed', {
          actionId: id,
          error: error.message,
        });
        return FAILED;
      },
    );
    return {
      kind: 'ceremony',
      actionId: id,
      ceremony,
      completion: result.then((settled) => settled.outcome),
    };
  }

  private startLogout(): MachineActionOperation {
    return {
      kind: 'logout',
      actionId: 'log-out',
      completion: logOutAccount(this.dependencies.oauthClient),
    };
  }

  private setAccount(account: AccountAuthenticationState): void {
    if (this.account === account) return;
    this.account = account;
    this.publish();
  }

  private publish(): void {
    if (this.disposed) return;
    this.revision += 1;
    const snapshot = this.snapshot();
    for (const observer of [...this.observers]) {
      try {
        observer(snapshot);
      } catch (error) {
        this.dependencies.logger.warn('machine_actions.observer_failed', {
          revision: snapshot.revision,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

export interface MachineActionsInfrastructure {
  oauthClient: MachineActionsDependencies['oauthClient'];
  platformWebSocketManager: MachineActionsDependencies['platformWebSocketManager'];
  machineControllerAuthority: MachineActionsDependencies['machineControllerAuthority'];
  keyPairStore: KeyPairStore;
  controllerRegistryStore: ControllerRegistryStore;
  executionGrantStore: ExecutionGrantStore;
  logger: ServerLogger;
}

/**
 * Binds machine actions to the live infrastructure owners. Pairing reuses the
 * running process's protected stores; it never starts another server or
 * spawns a CLI. Terminal output and the terminal prompter are never used:
 * every step and the local review flow through the ceremony.
 */
export const createMachineActions = (
  infrastructure: MachineActionsInfrastructure,
): MachineActions => {
  const logger = infrastructure.logger.child({ component: 'machine-actions' });
  const pairDependencies = resolvePairDependencies({
    keyPairStore: infrastructure.keyPairStore,
    controllerRegistryStore: infrastructure.controllerRegistryStore,
    executionGrantStore: infrastructure.executionGrantStore,
    machinesApi: createDefaultMachineEnrollmentClient(),
    logger,
    prompter: {
      confirm: () =>
        Promise.reject(new Error('Machine actions answer review through the ceremony.')),
    },
    log: (message) => logger.info('machine_actions.pair', { message }),
    logError: (message) => logger.warn('machine_actions.pair', { message }),
  });
  return new MachineActions({
    oauthClient: infrastructure.oauthClient,
    platformWebSocketManager: infrastructure.platformWebSocketManager,
    machineControllerAuthority: infrastructure.machineControllerAuthority,
    pair: (ports) => pairMachine(pairDependencies, ports),
    logger,
  });
};
