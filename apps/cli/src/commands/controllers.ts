import { createInteractivePrompter, type CredentialPrompter } from '../agent-runtime/index';

import { createDefaultMachineEnrollmentClient } from '../auth/machine-enrollment-client';
import {
  MachineControllerAuthority,
  recoveryGuidanceForReadiness,
  type MachineControllerAuthorityDependencies,
} from '../auth/machine-controller-authority';
import {
  attachDirectEnrollmentOutput,
  MachineEnrollmentCeremony,
} from '../auth/machine-enrollment-ceremony';
import { ControllerRegistryStore, KeyPairStore } from '../credentials';
import { ExecutionGrantStore } from '../server/controller-authorization/execution-grant-store';
import { describeEnrollment } from './pairing-presentation';
import { resolvePairingUrl } from './pairing-web-url';
import type { ServerCommandOptions } from './server';

const CONTROLLERS_COMMAND_USAGE = `Usage: heyhey controllers <list|add|revoke>

  list                         Show safe local and server controller evidence
  add [--no-start]             Add or recover a controller on this machine
  revoke <credential-id>       Revoke one controller (defaults to no)
  revoke <credential-id> --yes Confirm the revoke without a prompt`;

export interface ControllersCommandDependencies {
  authority?: MachineControllerAuthority;
  authorityDependencies?: MachineControllerAuthorityDependencies;
  prompter?: Pick<CredentialPrompter, 'confirm'>;
  log?: (message: string) => void;
  logError?: (message: string) => void;
  isTty?: boolean;
  serverOptions?: ServerCommandOptions;
  startServerAfterConfirmation?: (options: ServerCommandOptions) => Promise<boolean>;
}

const createDefaultAuthority = (): MachineControllerAuthority => {
  const keyPairStore = new KeyPairStore();
  const controllerRegistryStore = new ControllerRegistryStore({ keyPairStore });
  const executionGrantStore = new ExecutionGrantStore({ keyPairStore });
  return new MachineControllerAuthority({
    keyPairStore,
    controllerRegistryStore,
    executionGrantStore,
    enrollmentConfirmationClient: createDefaultMachineEnrollmentClient(),
  });
};

const controllerAuthority = (
  dependencies: ControllersCommandDependencies,
): MachineControllerAuthority =>
  dependencies.authority ??
  new MachineControllerAuthority({
    ...(dependencies.authorityDependencies ??
      (() => {
        const keyPairStore = new KeyPairStore();
        return {
          keyPairStore,
          controllerRegistryStore: new ControllerRegistryStore({ keyPairStore }),
          executionGrantStore: new ExecutionGrantStore({ keyPairStore }),
        };
      })()),
    ...(dependencies.prompter ? { prompter: dependencies.prompter } : {}),
  });

const formatController = (controller: {
  credentialId: string;
  label: string;
  fingerprint: string;
  revocationState: string;
  backupEligible: boolean;
  backupState: boolean;
}): string =>
  `${controller.label} — ${controller.credentialId} — fingerprint ${controller.fingerprint} — ${
    controller.revocationState
  } — backup ${controller.backupState ? 'backed up' : controller.backupEligible ? 'eligible' : 'not eligible'}`;

export const runControllersCommand = async (
  args: readonly string[],
  dependencies: ControllersCommandDependencies = {},
): Promise<boolean> => {
  const log = dependencies.log ?? console.log;
  const logError = dependencies.logError ?? console.error;
  const isTty = dependencies.isTty ?? process.stdin.isTTY === true;
  const authority =
    dependencies.authority ??
    (dependencies.authorityDependencies
      ? controllerAuthority(dependencies)
      : createDefaultAuthority());
  const subcommand = args[0];

  if (subcommand === 'list') {
    const result = await authority.listControllers();
    log(`Machine state: ${result.readiness.state}`);
    if (result.readiness.machineId) log(`Machine: ${result.readiness.machineId}`);
    if (result.inventory) {
      log(`Server execution readiness: ${result.inventory.executionReadiness}`);
      for (const controller of result.inventory.controllers) log(formatController(controller));
    } else {
      for (const controller of result.readiness.localControllers) {
        log(
          `${controller.controllerLabel} — ${controller.controllerCredentialId} — fingerprint ${controller.controllerCredentialFingerprint} — local registry`,
        );
      }
    }
    log(recoveryGuidanceForReadiness(result.readiness.state));
    return true;
  }

  if (subcommand === 'add') {
    const ceremony = new MachineEnrollmentCeremony();
    attachDirectEnrollmentOutput(ceremony, {
      log,
      logError,
      prompter: dependencies.prompter ?? createInteractivePrompter(),
      describeHandoff: (userCode) =>
        describeEnrollment(
          { userCode },
          resolvePairingUrl(userCode, process.env, 'add-controller'),
          'Add this controller in your browser.',
        ),
    });
    const result = await ceremony.run(
      (ports) => authority.addController({ ports }),
      () => ({ outcome: 'failed' }),
    );
    if (result.outcome === 'confirmed') {
      log('Controller enrollment confirmed and stored locally.');
      if (args.includes('--no-start') || !isTty) return true;
      if (!dependencies.startServerAfterConfirmation) return true;
      return dependencies.startServerAfterConfirmation(dependencies.serverOptions ?? {});
    }
    return false;
  }

  if (subcommand === 'revoke') {
    const controllerCredentialId = args[1];
    if (!controllerCredentialId || controllerCredentialId.startsWith('-')) {
      logError(CONTROLLERS_COMMAND_USAGE);
      return false;
    }
    const confirmed =
      args.includes('--yes') ||
      (await (dependencies.prompter ?? createInteractivePrompter()).confirm(
        `Revoke controller ${controllerCredentialId}?`,
        false,
      ));
    if (!confirmed) {
      log('Controller revoke cancelled. No server or local authority changed.');
      return true;
    }
    const ok = await authority.revokeController(controllerCredentialId);
    if (ok) log(`Controller ${controllerCredentialId} revoked; its local grants were terminated.`);
    return ok;
  }

  logError(CONTROLLERS_COMMAND_USAGE);
  return false;
};
