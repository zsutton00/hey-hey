import type { KeyObject } from 'node:crypto';
import { CurrentAgentOperation } from '../../shared/agent-bridge-contract/generated/api';
import type {
  BoundedGrantReference,
  CanonicalControllerAuthorizationIntent,
  ExecutableControllerAssertionEvidence,
  ControllerAuthorizationCadence,
  ControllerDeviceGrantDescriptor,
  ControllerDeviceGrantScope,
  CurrentAgentOperation as CurrentAgentOperationValue,
  ExecutableEnvelopeAuthorization,
  HostActionCategory,
  HostActionTarget,
  HostActionTargetKind,
  HostAffectingActionType,
} from '../../shared/agent-bridge-contract/generated/api';
import type { ControllerCredentialPublicKey } from '../../shared/api/generated/api';

export type {
  CanonicalControllerAuthorizationIntent,
  ExecutableControllerAssertionEvidence,
  CurrentAgentOperationValue,
  ExecutableEnvelopeAuthorization,
  HostActionCategory,
  HostAffectingActionType,
};

export const CURRENT_AGENT_OPERATIONS = [
  CurrentAgentOperation.ConversationTrigger,
  CurrentAgentOperation.PlatformEventTrigger,
  CurrentAgentOperation.ConversationControlCompactRun,
  CurrentAgentOperation.ConversationControlPermissionDecision,
  CurrentAgentOperation.TaskMonitorStart,
  CurrentAgentOperation.TaskMonitorResume,
  CurrentAgentOperation.TaskMonitorJudgmentResolved,
  CurrentAgentOperation.TaskMonitorContinue,
  CurrentAgentOperation.TaskMonitorComplete,
  CurrentAgentOperation.CliRead,
  CurrentAgentOperation.ApplicationEffectLaunch,
  CurrentAgentOperation.ExactActionDelivery,
] as const satisfies readonly CurrentAgentOperationValue[];

const CURRENT_AGENT_OPERATION_SET = new Set<string>(CURRENT_AGENT_OPERATIONS);

export const CURRENT_AGENT_OPERATION_CATEGORY = {
  CONVERSATION_TRIGGER: 'CONVERSATION',
  PLATFORM_EVENT_TRIGGER: 'PLATFORM_EVENT',
  CONVERSATION_CONTROL_COMPACT_RUN: 'AUTHORITY_INCREASING_CONTROL',
  CONVERSATION_CONTROL_PERMISSION_DECISION: 'AUTHORITY_INCREASING_CONTROL',
  TASK_MONITOR_START: 'TASK_MONITOR',
  TASK_MONITOR_RESUME: 'TASK_MONITOR',
  TASK_MONITOR_JUDGMENT_RESOLVED: 'TASK_MONITOR',
  TASK_MONITOR_CONTINUE: 'TASK_MONITOR',
  TASK_MONITOR_COMPLETE: 'TASK_MONITOR',
  CLI_READ: 'CLI_READ',
  APPLICATION_EFFECT_LAUNCH: 'APPLICATION_EFFECT',
  EXACT_ACTION_DELIVERY: 'EXACT_ACTION',
} as const satisfies Record<CurrentAgentOperationValue, HostActionCategory>;

export const isCurrentAgentOperation = (
  value: HostAffectingActionType,
): value is CurrentAgentOperationValue => CURRENT_AGENT_OPERATION_SET.has(value);

export const hasExactCurrentAgentOperations = (
  values: readonly unknown[],
): values is readonly CurrentAgentOperationValue[] =>
  values.length === CURRENT_AGENT_OPERATIONS.length &&
  new Set(values).size === CURRENT_AGENT_OPERATIONS.length &&
  values.every((value) => typeof value === 'string' && CURRENT_AGENT_OPERATION_SET.has(value));

export interface ControllerAuthorizationAdmissionContext {
  machineId: string;
  userId: string;
  organizationId: string;
  projectId: string;
  /** Present for fresh assertion admission; grant references resolve this from protected state. */
  controllerInstallationId?: string;
  actionCategory: HostActionCategory;
  actionType: HostAffectingActionType;
  actionPayloadHash: string;
  target: HostActionTarget;
  agentSessionId?: string | null;
  authorizedTurnId?: string | null;
  taskMonitorId?: string | null;
}

export type ControllerAuthorizationDenialReason =
  | 'MACHINE_NOT_READY'
  | 'MACHINE_REVOKED'
  | 'CONTROLLER_NOT_ACTIVE'
  | 'AUTHORIZATION_NOT_FOUND'
  | 'AUTHORIZATION_EXPIRED'
  | 'AUTHORIZATION_ALREADY_CONSUMED'
  | 'CREDENTIAL_MISMATCH'
  | 'INSTALLATION_MISMATCH'
  | 'CHALLENGE_MISMATCH'
  | 'ORIGIN_MISMATCH'
  | 'RP_ID_MISMATCH'
  | 'USER_PRESENCE_REQUIRED'
  | 'USER_VERIFICATION_REQUIRED'
  | 'SIGNATURE_INVALID'
  | 'ACTION_MISMATCH'
  | 'PAYLOAD_HASH_MISMATCH'
  | 'TARGET_MISMATCH'
  | 'GRANT_NOT_ACTIVE'
  | 'GRANT_SCOPE_MISMATCH'
  | 'REPLAY_DETECTED'
  | 'SCHEMA_INVALID'
  | 'STORAGE_UNAVAILABLE';

export type ControllerPublicKey = Buffer | string | KeyObject;

interface ControllerAssertionVerificationSuccess {
  ok: true;
  authorizationId: string;
  intent: CanonicalControllerAuthorizationIntent;
  credentialFingerprint: string;
}

interface ControllerAssertionVerificationFailure {
  ok: false;
  reason: ControllerAuthorizationDenialReason;
}

export type ControllerAssertionVerificationResult =
  | ControllerAssertionVerificationSuccess
  | ControllerAssertionVerificationFailure;

export interface ExecutionGrant {
  version: 4;
  grantId: string;
  namespace: string;
  scope: ControllerDeviceGrantScope;
  controllerCredentialId: string;
  controllerInstallationId: string;
  machineId: string;
  userId: string;
  organizationId: string;
  cadence: ControllerAuthorizationCadence;
  policyRevision: number;
  allowedActionTypes: CurrentAgentOperationValue[];
  allowedActionCategories: HostActionCategory[];
  issuedAtMs: number;
  effectiveExpiresAtMs: number;
  descriptorHash: string;
  controllerCredentialFingerprint: string;
  suspended: boolean;
  terminal: boolean;
  revoked: boolean;
  lastUsedAtMs: number | null;
}

export interface CreateExecutionGrantInput {
  grantId: string;
  descriptor: ControllerDeviceGrantDescriptor;
  descriptorHash: string;
  controllerCredentialFingerprint: string;
}

export interface GrantAdmissionInput {
  grantId: string;
  machineId: string;
  userId: string;
  organizationId: string;
  actionType: HostAffectingActionType;
  actionCategory: HostActionCategory;
}

export interface ReplayRecord {
  id: string;
  expiresAtMs: number;
}

export interface HostActionAdmissionRequest extends ControllerAuthorizationAdmissionContext {
  authorization: ExecutableEnvelopeAuthorization;
  envelopeNonce: string;
}

/**
 * Opaque proof that the local controller boundary admitted one exact host action.
 * The private member makes plain transport requests structurally ineligible at
 * effect boundaries; instances are issued only by HostActionAdmission.
 */
export abstract class AdmittedHostAction {
  readonly #admittedHostAction = true;

  protected constructor(
    public readonly actionType: CurrentAgentOperationValue,
    public readonly authorizationId: string,
    public readonly envelopeNonce: string,
  ) {}
}

interface HostActionAdmissionSuccess {
  admitted: true;
  authorizationId: string;
  grantId?: string;
  capability: AdmittedHostAction;
}

interface HostActionAdmissionFailure {
  admitted: false;
  reason: ControllerAuthorizationDenialReason;
}

export type HostActionAdmissionResult = HostActionAdmissionSuccess | HostActionAdmissionFailure;

export interface ControllerRegistryReader {
  read(): Promise<{
    controllers: Array<{
      machineId: string;
      accountId: string;
      organizationId: string;
      authorizationProtocolVersion: 2;
      controllerCredentialId: string;
      controllerCredentialPublicKey: ControllerCredentialPublicKey;
      controllerCredentialFingerprint: string;
    }>;
  } | null>;
}

interface ControllerRegistryKeyEntry {
  machineId: string;
  controllerCredentialId: string;
  controllerCredentialPublicKey: ControllerCredentialPublicKey;
  controllerCredentialFingerprint: string;
}

export interface ControllerAssertionVerifierOptions {
  registry: ControllerRegistryReader;
  origin: string;
  rpId: string;
  expectedUserHandle?: string;
  now?: () => number;
  freshnessMs?: number;
}
