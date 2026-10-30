import { AgentSessionService } from '../agent-session.service';
import { DirectActionServiceScopeResolver } from './direct-action-service-scope-resolver';
import {
  ForbiddenException,
  Injectable,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import {
  ControllerAuthorizationCadence as PrismaControllerAuthorizationCadence,
  ExecutionAuthorization,
  ExecutionGrantScope as PrismaExecutionGrantScope,
  HostActionCategory as PrismaHostActionCategory,
  HostActionTargetKind as PrismaHostActionTargetKind,
  HostAffectingActionType as PrismaHostAffectingActionType,
  Prisma,
} from '@prisma/client';
import * as crypto from 'node:crypto';
import {
  ControllerAuthorizationCadence,
  ControllerDeviceGrantDescriptor,
  CanonicalControllerAuthorizationIntent,
  ControllerAuthorizationAllowedCredential,
  ControllerAuthorizationDenialReason,
  HostActionCategory,
  HostActionPreparation,
  HostActionTargetKind,
  HostAffectingActionType,
  PrepareControllerAuthorizationRequestDto,
  PrepareControllerAuthorizationResponseDto,
  ResolveControllerAuthorizationRequestDto,
  ResolveControllerAuthorizationResponseDto,
  SubmitControllerAuthorizedActionRequestDto,
  SubmitControllerAuthorizedActionResponseDto,
} from '../../generated';
import {
  hashControllerAction,
  hostActionPreparationFailures,
  isHostActionPreparation,
} from '../../generated/controller-action-contract';
import { canonicalizeJcs } from '../../core/websockets/trigger-canonicalization';
import { MachinePresenceService } from '../../core/websockets/machine-presence.service';
import {
  AnyTransactionClient,
  PrismaService,
} from '../../prisma/prisma.service';
import { MachineId, OrganizationId, ProjectId, UserId } from '../../types';
import {
  ControllerAssertionVerificationError,
  ControllerAssertionVerifierService,
} from './controller-assertion-verifier.service';
import { ControllerAuthorizationWebAuthnConfigService } from './controller-authorization-webauthn-config.service';
import {
  ControllerBrowserBindingService,
  IssuedControllerBinding,
} from './controller-browser-binding.service';
import {
  isRemovedControllerAuthorizationCadence,
  REMOVED_CONTROLLER_AUTHORIZATION_CADENCES,
} from './controller-authorization-cadence';
import {
  CONTROLLER_DEVICE_POLICY_REVISION,
  ACTION_BINDINGS,
  CURRENT_AGENT_OPERATION_CATEGORIES,
  CURRENT_AGENT_OPERATIONS,
  getControllerDeviceGrantExpiry,
  PRISMA_CURRENT_AGENT_OPERATIONS,
  toControllerAuthorizationCadence,
} from './controller-authorization-operations';

export { isRemovedControllerAuthorizationCadence } from './controller-authorization-cadence';
export {
  CONTROLLER_DEVICE_GRANT_TTL_MS,
  CONTROLLER_DEVICE_POLICY_REVISION,
  ACTION_BINDINGS,
  CURRENT_AGENT_OPERATION_CATEGORIES,
  CURRENT_AGENT_OPERATIONS,
  getControllerDeviceGrantExpiry,
  getCurrentAgentOperationCategory,
  isCurrentAgentOperation,
  PRISMA_CURRENT_AGENT_OPERATIONS,
  toControllerAuthorizationCadence,
} from './controller-authorization-operations';

export const CONTROLLER_AUTHORIZATION_TTL_MS = 2 * 60 * 1000;
export const CONTROLLER_AUTHORIZATION_CHALLENGE_DOMAIN =
  'heyhey-controller-authorization-v1';
function toPrismaControllerAuthorizationCadence(
  cadence: ControllerAuthorizationCadence,
): PrismaControllerAuthorizationCadence {
  return PrismaControllerAuthorizationCadence[cadence];
}

export function buildControllerDeviceGrantDescriptor(params: {
  controllerCredentialId: string;
  controllerInstallationId: string;
  machineId: string;
  userId: string;
  organizationId: string;
  projectId: string;
  action: Pick<
    ExecutionAuthorization,
    'requestId' | 'actionCategory' | 'actionType' | 'targetKind' | 'targetId'
  >;
  actionPayloadHash: string;
  target: ResolvedTarget;
  allowedActions: HostAffectingActionType[];
  cadence: ControllerAuthorizationCadence;
  policyRevision: number;
  issuedAt: Date;
}): ControllerDeviceGrantDescriptor {
  const effectiveExpiry = getControllerDeviceGrantExpiry(
    params.issuedAt,
    params.cadence,
  );
  return {
    scope: 'controller_device_window',
    controllerCredentialId: params.controllerCredentialId,
    controllerInstallationId: params.controllerInstallationId,
    machineId: params.machineId,
    userId: params.userId as UserId,
    organizationId: params.organizationId as OrganizationId,
    cadence: params.cadence,
    policyRevision: params.policyRevision,
    allowedActionTypes: [...CURRENT_AGENT_OPERATIONS],
    allowedActionCategories: [...CURRENT_AGENT_OPERATION_CATEGORIES],
    issuedAtMs: params.issuedAt.getTime(),
    effectiveExpiresAtMs: effectiveExpiry.getTime(),
  };
}

export function hashControllerDeviceGrantDescriptor(
  descriptor: ControllerDeviceGrantDescriptor,
): string {
  return crypto
    .createHash('sha256')
    .update(canonicalizeJcs(descriptor), 'utf8')
    .digest('hex');
}

interface ResolvedTarget {
  kind: HostActionTargetKind;
  id: string;
  revision: number | null;
  agentSessionId: string | null;
  taskMonitorId: string | null;
}

interface ResolvedAction {
  payload: HostActionPreparation;
  target: ResolvedTarget;
}

export class ControllerAuthorizationPreparationDeniedException extends ForbiddenException {
  constructor(readonly reason: ControllerAuthorizationDenialReason) {
    super(reason);
  }
}

type AuthorizationWithAuthority = ExecutionAuthorization & {
  grant: { id: string } | null;
  controllerCredential: {
    id: string;
    credentialId: string;
    credentialPublicKeyX: Uint8Array;
    credentialPublicKeyY: Uint8Array;
    credentialSignCount: number;
    credentialFingerprint: string;
    userId: string;
    machineId: string;
    organizationId: string;
    revokedAt: Date | null;
  };
  machine: {
    id: string;
    userId: string;
    organizationId: string | null;
    authorizationProtocolVersion: number;
    authorizationState: string;
    revokedAt: Date | null;
  };
};

export interface ControllerAuthorizationSubmission {
  response: SubmitControllerAuthorizedActionResponseDto;
  binding: IssuedControllerBinding | null;
}

@Injectable()
export class ControllerAuthorizationService {
  private readonly logger = new Logger(ControllerAuthorizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly machinePresence: MachinePresenceService,
    private readonly assertionVerifier: ControllerAssertionVerifierService,
    private readonly webauthnConfig: ControllerAuthorizationWebAuthnConfigService,
    private readonly browserBindingService: ControllerBrowserBindingService,
    @Inject(forwardRef(() => AgentSessionService))
    private readonly agentSessionService: AgentSessionService,
  ) {}

  async resolve(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    controllerBindingSecret?: string;
    input: ResolveControllerAuthorizationRequestDto;
  }): Promise<ResolveControllerAuthorizationResponseDto> {
    this.assertResolveRequest(params.input);
    const { organizationId, projectId, userId, input } = params;

    await this.assertProjectContext(organizationId, projectId);
    await this.resolveAction({
      organizationId,
      projectId,
      userId,
      machineId: input.machineId,
      action: input.action,
    });
    const binding = await this.browserBindingService.resolveForAdmission({
      secret: params.controllerBindingSecret,
      userId,
      organizationId,
    });
    if (!binding) {
      return {
        outcome: 'AUTHORIZATION_REQUIRED',
      } satisfies ResolveControllerAuthorizationResponseDto;
    }
    const now = new Date();
    const grant = await this.prisma.db.executionGrant.findFirst({
      where: {
        scope: PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW,
        controllerInstallationId: binding.controllerInstallationId,
        controllerCredentialId: binding.controllerCredentialId,
        machineId: input.machineId,
        userId,
        organizationId,
        cadence: {
          notIn: [...REMOVED_CONTROLLER_AUTHORIZATION_CADENCES],
        },
        policyRevision: CONTROLLER_DEVICE_POLICY_REVISION,
        allowedActions: {
          hasEvery: PRISMA_CURRENT_AGENT_OPERATIONS,
        },
        expiresAt: { gt: now },
        suspendedAt: null,
        terminalAt: null,
        revokedAt: null,
        authorization: {
          outcome: 'ADMITTED',
          consumedAt: { not: null },
          controllerInstallationId: binding.controllerInstallationId,
          controllerCredentialId: binding.controllerCredentialId,
          machineId: input.machineId,
          userId,
          organizationId,
          cadence: {
            notIn: [...REMOVED_CONTROLLER_AUTHORIZATION_CADENCES],
          },
          policyRevision: CONTROLLER_DEVICE_POLICY_REVISION,
          controllerCredential: { revokedAt: null },
          machine: {
            authorizationProtocolVersion: 2,
            authorizationState: 'READY',
            revokedAt: null,
          },
        },
      },
      orderBy: [{ expiresAt: 'desc' }, { id: 'asc' }],
      select: { id: true, expiresAt: true, allowedActions: true },
    });

    if (!grant) {
      return {
        outcome: 'AUTHORIZATION_REQUIRED',
      } satisfies ResolveControllerAuthorizationResponseDto;
    }
    if (
      grant.allowedActions.length !== PRISMA_CURRENT_AGENT_OPERATIONS.length ||
      PRISMA_CURRENT_AGENT_OPERATIONS.some(
        (action) => !grant.allowedActions.includes(action),
      )
    ) {
      return {
        outcome: 'AUTHORIZATION_REQUIRED',
      } satisfies ResolveControllerAuthorizationResponseDto;
    }
    return {
      outcome: 'ACTIVE_GRANT',
      authorization: { kind: 'bounded_grant', grantId: grant.id },
      effectiveExpiresAtMs: grant.expiresAt.getTime(),
    } satisfies ResolveControllerAuthorizationResponseDto;
  }

  async prepare(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    controllerBindingSecret?: string;
    input: PrepareControllerAuthorizationRequestDto;
  }): Promise<PrepareControllerAuthorizationResponseDto> {
    this.assertPrepareRequest(params.input);
    const { organizationId, projectId, userId, input } = params;

    await this.assertProjectContext(organizationId, projectId);
    const machine = await this.prisma.db.machine.findFirst({
      where: {
        id: input.machineId,
        userId,
        organizationId,
        authorizationProtocolVersion: 2,
        authorizationState: 'READY',
        revokedAt: null,
      },
      select: { id: true },
    });
    if (!machine) {
      this.rejectPreparation(
        ControllerAuthorizationDenialReason.MachineNotReady,
        { machineId: input.machineId, organizationId, projectId, userId },
      );
    }
    if (!(await this.machinePresence.isPresent(machine.id as MachineId))) {
      this.rejectPreparation(
        ControllerAuthorizationDenialReason.MachineNotReady,
        { machineId: machine.id, organizationId, projectId, userId },
      );
    }

    const controllerCredential =
      await this.prisma.db.machineControllerCredential.findFirst({
        where: {
          credentialId: input.controllerCredentialId,
          machineId: machine.id,
          userId,
          organizationId,
          revokedAt: null,
        },
        select: {
          id: true,
          credentialId: true,
          controllerInstallationId: true,
          credentialTransports: true,
          credentialFingerprint: true,
        },
      });
    if (!controllerCredential?.controllerInstallationId) {
      this.rejectPreparation(
        ControllerAuthorizationDenialReason.ControllerNotActive,
        { machineId: machine.id, organizationId, projectId, userId },
      );
    }
    const controllerCredentialId = controllerCredential.credentialId;
    const existingBinding =
      await this.browserBindingService.resolveForSelection({
        secret: params.controllerBindingSecret,
        userId,
        organizationId,
      });
    if (
      existingBinding &&
      (existingBinding.controllerCredentialId !== controllerCredential.id ||
        existingBinding.controllerInstallationId !==
          controllerCredential.controllerInstallationId)
    ) {
      this.rejectPreparation(
        ControllerAuthorizationDenialReason.ControllerNotActive,
        { machineId: machine.id, organizationId, projectId, userId },
      );
    }
    const controllerInstallationId =
      controllerCredential.controllerInstallationId;

    const resolvedAction = await this.resolveAction({
      organizationId,
      projectId,
      userId,
      machineId: machine.id,
      action: input.action,
    });
    const issuedAt = new Date();
    const expiresAt = new Date(
      issuedAt.getTime() + CONTROLLER_AUTHORIZATION_TTL_MS,
    );
    const authorizationId = crypto.randomUUID();
    const nonce = crypto.randomBytes(32).toString('base64url');
    const actionPayloadHash = hashControllerAction(resolvedAction.payload);
    const policyRevision = CONTROLLER_DEVICE_POLICY_REVISION;
    const allowedActions = this.allowedGrantActions(resolvedAction.payload);
    const grantDescriptor = buildControllerDeviceGrantDescriptor({
      controllerCredentialId,
      controllerInstallationId,
      machineId: machine.id,
      userId,
      organizationId,
      projectId,
      action: resolvedAction.payload,
      actionPayloadHash,
      target: resolvedAction.target,
      allowedActions,
      cadence: input.cadence,
      policyRevision,
      issuedAt,
    });
    const grantDescriptorHash =
      hashControllerDeviceGrantDescriptor(grantDescriptor);
    const intent = {
      version: 2,
      authorizationId,
      controllerCredentialId,
      controllerInstallationId,
      machineId: machine.id,
      userId,
      organizationId,
      projectId,
      cadence: input.cadence,
      policyRevision,
      effectiveGrantExpiresAtMs: grantDescriptor.effectiveExpiresAtMs,
      grantDescriptorHash,
      actionCategory: resolvedAction.payload.actionCategory,
      actionType: resolvedAction.payload.actionType,
      actionPayloadHash,
      allowedActionTypes: grantDescriptor.allowedActionTypes,
      allowedActionCategories: grantDescriptor.allowedActionCategories,
      target: {
        kind: resolvedAction.target.kind,
        id: resolvedAction.target.id,
        revision: resolvedAction.target.revision,
      },
      agentSessionId: resolvedAction.target.agentSessionId,
      taskMonitorId: resolvedAction.target.taskMonitorId,
      nonce,
      issuedAtMs: issuedAt.getTime(),
      expiresAtMs: expiresAt.getTime(),
    } satisfies CanonicalControllerAuthorizationIntent;
    const canonicalIntent = canonicalizeJcs(intent);
    const webauthnChallenge = this.buildChallenge(canonicalIntent);
    const credentialTransports = this.toCredentialTransports(
      controllerCredential.credentialTransports,
    );

    await this.prisma.db.executionAuthorization.create({
      data: {
        id: authorizationId,
        requestId: resolvedAction.payload.requestId,
        canonicalIntent,
        webauthnChallenge,
        controllerCredentialId: controllerCredential.id,
        controllerInstallationId,
        machineId: machine.id,
        userId,
        organizationId,
        projectId,
        cadence: toPrismaControllerAuthorizationCadence(input.cadence),
        policyRevision,
        grantDescriptorHash,
        actionCategory:
          PrismaHostActionCategory[resolvedAction.payload.actionCategory],
        actionType:
          PrismaHostAffectingActionType[resolvedAction.payload.actionType],
        actionPayloadHash,
        targetKind: PrismaHostActionTargetKind[resolvedAction.target.kind],
        targetId: resolvedAction.target.id,
        agentSessionId: resolvedAction.target.agentSessionId,
        taskMonitorId: resolvedAction.target.taskMonitorId,
        nonce,
        issuedAt,
        expiresAt,
      },
    });

    this.logger.log('Controller authorization prepared', {
      authorizationId,
      controllerCredentialFingerprint:
        controllerCredential.credentialFingerprint,
      machineId: machine.id,
      userId,
      organizationId,
      projectId,
      actionType: resolvedAction.payload.actionType,
      actionPayloadHash,
      targetKind: resolvedAction.target.kind,
      targetId: resolvedAction.target.id,
      reasonCode: 'PREPARED',
    });

    return {
      intent,
      grantDescriptor,
      publicKey: {
        challenge: webauthnChallenge,
        rpId: this.webauthnConfig.rpId,
        timeout: 120000,
        userVerification: 'required',
        allowCredentials: [
          {
            type: 'public-key',
            id: controllerCredential.credentialId,
            transports: credentialTransports,
          },
        ],
      },
    } satisfies PrepareControllerAuthorizationResponseDto;
  }

  async submit(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    input: SubmitControllerAuthorizedActionRequestDto;
  }): Promise<ControllerAuthorizationSubmission> {
    const { organizationId, projectId, userId, input } = params;
    if (!this.isSubmitRequest(input)) {
      return this.submission(
        this.denied(
          ControllerAuthorizationDenialReason.ActionMismatch,
          undefined,
          { organizationId, projectId, userId },
        ),
      );
    }

    const authorization = await this.loadAuthorization(input.authorizationId);
    const stateReason = this.authorizationStateDenial(authorization, {
      organizationId,
      projectId,
      userId,
      now: new Date(),
    });
    if (stateReason || !authorization) {
      return this.submission(
        this.denied(
          stateReason ??
            ControllerAuthorizationDenialReason.AuthorizationNotFound,
          authorization,
          { organizationId, projectId, userId },
        ),
      );
    }

    if (
      !(await this.machinePresence.isPresent(
        authorization.machineId as MachineId,
      ))
    ) {
      return this.submission(
        this.denied(
          ControllerAuthorizationDenialReason.MachineNotReady,
          authorization,
          { organizationId, projectId, userId },
        ),
      );
    }

    const targetReason = await this.persistedTargetDenial(authorization);
    if (targetReason) {
      return this.submission(
        this.denied(targetReason, authorization, {
          organizationId,
          projectId,
          userId,
        }),
      );
    }

    const rebuiltIntent = this.toIntent(authorization);
    const canonicalIntent = canonicalizeJcs(rebuiltIntent);
    let submittedCanonicalIntent: string;
    try {
      submittedCanonicalIntent = canonicalizeJcs(input.assertion.intent);
    } catch {
      return this.submission(
        this.denied(
          ControllerAuthorizationDenialReason.ActionMismatch,
          authorization,
          { organizationId, projectId, userId },
        ),
      );
    }
    if (
      canonicalIntent !== authorization.canonicalIntent ||
      authorization.webauthnChallenge !==
        this.buildChallenge(authorization.canonicalIntent) ||
      submittedCanonicalIntent !== canonicalIntent ||
      input.assertion.intent.authorizationId !== input.authorizationId
    ) {
      return this.submission(
        this.denied(
          ControllerAuthorizationDenialReason.ActionMismatch,
          authorization,
          { organizationId, projectId, userId },
        ),
      );
    }
    if (
      this.expectedGrantDescriptorHash(authorization) !==
      authorization.grantDescriptorHash
    ) {
      return this.submission(
        this.denied(
          ControllerAuthorizationDenialReason.PayloadHashMismatch,
          authorization,
          { organizationId, projectId, userId },
        ),
      );
    }
    let submittedGrantDescriptorHash: string;
    try {
      submittedGrantDescriptorHash = hashControllerDeviceGrantDescriptor(
        input.assertion.grantDescriptor,
      );
    } catch {
      return this.submission(
        this.denied(
          ControllerAuthorizationDenialReason.PayloadHashMismatch,
          authorization,
          { organizationId, projectId, userId },
        ),
      );
    }
    if (submittedGrantDescriptorHash !== authorization.grantDescriptorHash) {
      return this.submission(
        this.denied(
          ControllerAuthorizationDenialReason.PayloadHashMismatch,
          authorization,
          { organizationId, projectId, userId },
        ),
      );
    }
    if (
      this.sha256Hex(canonicalizeJcs(rebuiltIntent)) !==
      this.sha256Hex(authorization.canonicalIntent)
    ) {
      return this.submission(
        this.denied(
          ControllerAuthorizationDenialReason.PayloadHashMismatch,
          authorization,
          { organizationId, projectId, userId },
        ),
      );
    }

    let verifiedSignCount: number;
    try {
      const verification = this.assertionVerifier.verify({
        assertion: input.assertion,
        expectedChallenge: this.buildChallenge(authorization.canonicalIntent),
        credential: authorization.controllerCredential,
      });
      verifiedSignCount = verification.signCount;
    } catch (error) {
      const reason =
        error instanceof ControllerAssertionVerificationError
          ? error.reason
          : ControllerAuthorizationDenialReason.SignatureInvalid;
      return this.submission(
        this.denied(reason, authorization, {
          organizationId,
          projectId,
          userId,
        }),
      );
    }

    return this.consumeAtomically({
      authorizationId: authorization.id,
      organizationId,
      projectId,
      userId,
      verifiedSignCount,
      assertion: input.assertion,
    });
  }

  buildChallenge(canonicalIntent: string): string {
    return crypto
      .createHash('sha256')
      .update(CONTROLLER_AUTHORIZATION_CHALLENGE_DOMAIN, 'utf8')
      .update(Buffer.from([0]))
      .update(canonicalIntent, 'utf8')
      .digest('base64url');
  }

  private async consumeAtomically(params: {
    authorizationId: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    verifiedSignCount: number;
    assertion: SubmitControllerAuthorizedActionRequestDto['assertion'];
  }): Promise<ControllerAuthorizationSubmission> {
    return this.prisma.db.$transaction(async (tx) => {
      await this.lockAuthorizationAuthority(tx, params.authorizationId);
      const current = await this.loadAuthorization(params.authorizationId, tx);
      const now = new Date();
      const stateReason = this.authorizationStateDenial(current, {
        organizationId: params.organizationId,
        projectId: params.projectId,
        userId: params.userId,
        now,
      });
      if (stateReason || !current) {
        return this.submission(
          this.denied(
            stateReason ??
              ControllerAuthorizationDenialReason.AuthorizationNotFound,
            current,
            params,
          ),
        );
      }

      const targetReason = await this.persistedTargetDenial(current, tx);
      if (targetReason) {
        return this.submission(this.denied(targetReason, current, params));
      }

      const consumed = await tx.executionAuthorization.updateMany({
        where: {
          id: current.id,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          consumedAt: now,
          assertionEvidence:
            params.assertion as unknown as Prisma.InputJsonValue,
          outcome: 'ADMITTED',
          outcomeRecordedAt: now,
        },
      });
      if (consumed.count !== 1) {
        return this.submission(
          this.denied(
            ControllerAuthorizationDenialReason.ReplayDetected,
            current,
            params,
          ),
        );
      }

      await tx.machineControllerCredential.update({
        where: { id: current.controllerCredentialId },
        data: {
          lastUsedAt: now,
          ...(params.verifiedSignCount >
          current.controllerCredential.credentialSignCount
            ? { credentialSignCount: params.verifiedSignCount }
            : {}),
        },
      });

      this.logger.log('Controller authorization admitted', {
        authorizationId: current.id,
        controllerCredentialFingerprint:
          current.controllerCredential.credentialFingerprint,
        machineId: current.machineId,
        userId: current.userId,
        organizationId: current.organizationId,
        projectId: current.projectId,
        actionType: current.actionType,
        actionPayloadHash: current.actionPayloadHash,
        targetKind: current.targetKind,
        targetId: current.targetId,
        reasonCode: 'ADMITTED',
      });
      const cadence = toControllerAuthorizationCadence(current.cadence);
      if (!cadence) throw new Error('Removed controller authorization cadence');
      const binding = await this.browserBindingService.issueOrRotate(
        tx,
        {
          controllerInstallationId: current.controllerInstallationId,
          controllerCredentialId: current.controllerCredentialId,
          userId: current.userId as UserId,
          organizationId: current.organizationId as OrganizationId,
          expiresAt: getControllerDeviceGrantExpiry(current.issuedAt, cadence),
        },
        now,
      );
      return {
        response: {
          outcome: 'ADMITTED',
          authorizationId: current.id,
          consumedAt: now.toISOString(),
          grantId: current.grant?.id ?? null,
        } satisfies SubmitControllerAuthorizedActionResponseDto,
        binding,
      };
    });
  }

  private submission(
    response: SubmitControllerAuthorizedActionResponseDto,
  ): ControllerAuthorizationSubmission {
    return { response, binding: null };
  }

  private async resolveAction(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    machineId: string;
    action: HostActionPreparation;
  }): Promise<ResolvedAction> {
    const { action } = params;

    const binding = ACTION_BINDINGS[action.actionType];
    if (action.targetKind === 'CLI_READ') {
      if (
        action.actionType !== HostAffectingActionType.CliRead ||
        action.actionCategory !== HostActionCategory.CliRead
      ) {
        this.rejectPreparation(
          ControllerAuthorizationDenialReason.ActionMismatch,
          params,
        );
      }
      if (action.targetId !== params.machineId)
        this.rejectPreparation(
          ControllerAuthorizationDenialReason.TargetMismatch,
          params,
        );
      if (
        'catalogContext' in action &&
        action.catalogContext.policy === 'service_workspace'
      ) {
        const service = await this.prisma.db.service.findFirst({
          where: {
            id: action.catalogContext.serviceId,
            projectId: params.projectId,
            organizationId: params.organizationId,
          },
          select: { id: true },
        });
        if (!service)
          this.rejectPreparation(
            ControllerAuthorizationDenialReason.TargetMismatch,
            params,
          );
      }
      return {
        payload: action,
        target: {
          kind: 'CLI_READ',
          id: params.machineId,
          revision: null,
          agentSessionId: null,
          taskMonitorId: null,
        },
      };
    }

    if (
      !binding ||
      binding.category !== action.actionCategory ||
      binding.targetKind !== action.targetKind
    ) {
      this.rejectPreparation(
        ControllerAuthorizationDenialReason.ActionMismatch,
        params,
      );
    }

    if (action.targetKind === 'CONVERSATION') {
      const conversation = await this.prisma.db.conversation.findFirst({
        where: {
          id: action.targetId,
          organizationId: params.organizationId,
          projectId: params.projectId,
        },
        select: { id: true },
      });
      if (!conversation) {
        this.rejectPreparation(
          ControllerAuthorizationDenialReason.TargetMismatch,
          params,
        );
      }
      const target = {
        kind: binding.targetKind,
        id: conversation.id,
        revision: null,
        agentSessionId: null,
        taskMonitorId: null,
      } satisfies ResolvedTarget;
      return {
        payload: this.toResolvedActionPayload(action, binding, target),
        target,
      };
    }

    if (action.targetKind === 'AGENT_SESSION') {
      const session = await this.prisma.db.agentSession.findFirst({
        where: {
          id: action.targetId,
          organizationId: params.organizationId,
          projectId: params.projectId,
          userId: params.userId,
          machineId: params.machineId,
        },
        select: { id: true },
      });
      if (!session) {
        this.rejectPreparation(
          ControllerAuthorizationDenialReason.TargetMismatch,
          params,
        );
      }
      const target = {
        kind: binding.targetKind,
        id: session.id,
        revision: null,
        agentSessionId: session.id,
        taskMonitorId: null,
      } satisfies ResolvedTarget;
      return {
        payload: this.toResolvedActionPayload(
          await this.resolveDirectInputs(params),
          binding,
          target,
        ),
        target,
      };
    }

    if (action.targetKind === 'TASK_MONITOR') {
      const monitor = await this.prisma.db.task.findFirst({
        where: {
          id: action.targetId,
          organizationId: params.organizationId,
          projectId: params.projectId,
          type: 'TASK_MONITOR',
          archivedAt: null,
        },
        select: { id: true },
      });
      if (!monitor) {
        this.rejectPreparation(
          ControllerAuthorizationDenialReason.TargetMismatch,
          params,
        );
      }
      const target = {
        kind: binding.targetKind,
        id: monitor.id,
        revision: null,
        agentSessionId: null,
        taskMonitorId: monitor.id,
      } satisfies ResolvedTarget;
      return {
        payload: this.toResolvedActionPayload(action, binding, target),
        target,
      };
    }

    // The remaining variants have no persisted domain target to resolve.
    // Reject them instead of treating browser selectors as trusted scope.
    this.rejectPreparation(
      ControllerAuthorizationDenialReason.TargetMismatch,
      params,
    );
  }

  async resolveDirectInputs(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    machineId: string;
    action: HostActionPreparation;
  }): Promise<HostActionPreparation> {
    const { action } = params;
    if (!('inputs' in action) || !action.inputs) return action;
    let inputs = action.inputs;
    if (action.targetKind !== 'AGENT_SESSION') return action;
    if (inputs.kind === 'START_RUN') {
      if (inputs.payload.agentSessionId !== action.targetId) {
        this.rejectPreparation(
          ControllerAuthorizationDenialReason.TargetMismatch,
          params,
        );
      }
      const config =
        await this.agentSessionService.resolveStartRunConfiguration({
          organizationId: params.organizationId,
          agentSessionId: action.targetId,
          taskMonitorId: inputs.payload.contextMetadata.taskMonitorId,
          config: inputs.payload.config,
        });
      if (config !== undefined)
        inputs = { ...inputs, payload: { ...inputs.payload, config } };
    }
    if (inputs.kind === 'START_RUN' || inputs.kind === 'USER_MESSAGE') {
      const userText =
        inputs.kind === 'USER_MESSAGE'
          ? inputs.payload.userMessage
          : inputs.payload.payload && 'userMessage' in inputs.payload.payload
            ? inputs.payload.payload.userMessage
            : undefined;
      const services = await new DirectActionServiceScopeResolver(
        this.prisma,
        this.machinePresence,
      ).prepare({
        organizationId: params.organizationId,
        projectId: params.projectId,
        userId: params.userId,
        agentSessionId: action.targetId as import('../../types').AgentSessionId,
        machineId: params.machineId as MachineId,
        userText,
      });
      // Browser-provided scope never substitutes for the server-owned scope.
      const { admittedServiceScope: _untrusted, ...submittedInputs } = inputs;
      inputs = {
        ...submittedInputs,
        ...(services ? { admittedServiceScope: services.scope } : {}),
      };
    }
    return { ...action, inputs };
  }

  private toResolvedActionPayload(
    requested: HostActionPreparation,
    binding: { category: HostActionCategory; targetKind: HostActionTargetKind },
    target: ResolvedTarget,
  ): HostActionPreparation {
    return {
      ...requested,
      targetId: target.id,
    };
  }

  private allowedGrantActions(
    _action: Pick<HostActionPreparation, 'actionType'>,
  ): HostAffectingActionType[] {
    return [...CURRENT_AGENT_OPERATIONS];
  }

  private hashGrantDescriptor(params: {
    controllerCredentialId: string;
    controllerInstallationId: string;
    machineId: string;
    userId: string;
    organizationId: string;
    projectId: string;
    action: Pick<
      ExecutionAuthorization,
      'requestId' | 'actionCategory' | 'actionType' | 'targetKind' | 'targetId'
    >;
    actionPayloadHash: string;
    target: ResolvedTarget;
    allowedActions: HostAffectingActionType[];
    cadence: ControllerAuthorizationCadence;
    policyRevision: number;
    issuedAt: Date;
  }): string {
    return hashControllerDeviceGrantDescriptor(
      buildControllerDeviceGrantDescriptor(params),
    );
  }

  private async assertProjectContext(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<void> {
    const project = await this.prisma.db.project.findFirst({
      where: {
        id: projectId,
        organizationId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!project) {
      this.rejectPreparation(
        ControllerAuthorizationDenialReason.TargetMismatch,
        { organizationId, projectId },
      );
    }
  }

  private async persistedTargetDenial(
    authorization: AuthorizationWithAuthority,
    tx: AnyTransactionClient | typeof this.prisma.db = this.prisma.db,
  ): Promise<ControllerAuthorizationDenialReason | null> {
    const binding = ACTION_BINDINGS[authorization.actionType];
    if (authorization.targetKind === 'CLI_READ') {
      return authorization.actionType === 'CLI_READ' &&
        authorization.actionCategory === 'CLI_READ' &&
        authorization.targetId === authorization.machineId &&
        authorization.agentSessionId === null &&
        authorization.taskMonitorId === null
        ? null
        : ControllerAuthorizationDenialReason.TargetMismatch;
    }

    if (
      !binding ||
      binding.category !== authorization.actionCategory ||
      binding.targetKind !== authorization.targetKind
    ) {
      return ControllerAuthorizationDenialReason.ActionMismatch;
    }

    if (authorization.targetKind === HostActionTargetKind.Conversation) {
      const conversation = await tx.conversation.findFirst({
        where: {
          id: authorization.targetId,
          organizationId: authorization.organizationId,
          projectId: authorization.projectId,
        },
        select: { id: true },
      });
      return conversation
        ? null
        : ControllerAuthorizationDenialReason.TargetMismatch;
    }

    if (authorization.targetKind === HostActionTargetKind.AgentSession) {
      if (authorization.agentSessionId !== authorization.targetId) {
        return ControllerAuthorizationDenialReason.TargetMismatch;
      }
      const session = await tx.agentSession.findFirst({
        where: {
          id: authorization.targetId,
          organizationId: authorization.organizationId,
          projectId: authorization.projectId,
          userId: authorization.userId,
          machineId: authorization.machineId,
        },
        select: { id: true },
      });
      return session
        ? null
        : ControllerAuthorizationDenialReason.TargetMismatch;
    }

    if (authorization.targetKind === HostActionTargetKind.TaskMonitor) {
      if (authorization.taskMonitorId !== authorization.targetId) {
        return ControllerAuthorizationDenialReason.TargetMismatch;
      }
      const monitor = await tx.task.findFirst({
        where: {
          id: authorization.targetId,
          organizationId: authorization.organizationId,
          projectId: authorization.projectId,
          type: 'TASK_MONITOR',
          archivedAt: null,
        },
        select: { id: true },
      });
      return monitor
        ? null
        : ControllerAuthorizationDenialReason.TargetMismatch;
    }

    return ControllerAuthorizationDenialReason.TargetMismatch;
  }

  private async loadAuthorization(
    authorizationId: string,
    tx: AnyTransactionClient | typeof this.prisma.db = this.prisma.db,
  ): Promise<AuthorizationWithAuthority | null> {
    return tx.executionAuthorization.findUnique({
      where: { id: authorizationId },
      include: {
        grant: { select: { id: true } },
        controllerCredential: {
          select: {
            id: true,
            credentialId: true,
            credentialPublicKeyX: true,
            credentialPublicKeyY: true,
            credentialSignCount: true,
            credentialFingerprint: true,
            userId: true,
            machineId: true,
            organizationId: true,
            revokedAt: true,
          },
        },
        machine: {
          select: {
            id: true,
            userId: true,
            organizationId: true,
            authorizationProtocolVersion: true,
            authorizationState: true,
            revokedAt: true,
          },
        },
      },
    }) as Promise<AuthorizationWithAuthority | null>;
  }

  private authorizationStateDenial(
    authorization: AuthorizationWithAuthority | null,
    context: {
      organizationId: OrganizationId;
      projectId: ProjectId;
      userId: UserId;
      now: Date;
    },
  ): ControllerAuthorizationDenialReason | null {
    if (!authorization) {
      return ControllerAuthorizationDenialReason.AuthorizationNotFound;
    }
    if (
      authorization.organizationId !== context.organizationId ||
      authorization.projectId !== context.projectId ||
      authorization.userId !== context.userId
    ) {
      return ControllerAuthorizationDenialReason.AuthorizationNotFound;
    }
    if (isRemovedControllerAuthorizationCadence(authorization.cadence)) {
      return ControllerAuthorizationDenialReason.ActionMismatch;
    }
    if (authorization.consumedAt) {
      return ControllerAuthorizationDenialReason.AuthorizationAlreadyConsumed;
    }
    if (authorization.expiresAt.getTime() <= context.now.getTime()) {
      return ControllerAuthorizationDenialReason.AuthorizationExpired;
    }
    const machine = authorization.machine;
    if (machine.revokedAt) {
      return ControllerAuthorizationDenialReason.MachineRevoked;
    }
    if (
      machine.authorizationProtocolVersion !== 2 ||
      machine.authorizationState !== 'READY' ||
      machine.id !== authorization.machineId ||
      machine.userId !== authorization.userId ||
      machine.organizationId !== authorization.organizationId
    ) {
      return ControllerAuthorizationDenialReason.MachineNotReady;
    }
    const credential = authorization.controllerCredential;
    if (
      credential.revokedAt ||
      credential.id !== authorization.controllerCredentialId ||
      credential.machineId !== authorization.machineId ||
      credential.userId !== authorization.userId ||
      credential.organizationId !== authorization.organizationId
    ) {
      return ControllerAuthorizationDenialReason.ControllerNotActive;
    }
    return null;
  }

  private toIntent(
    authorization: AuthorizationWithAuthority,
  ): CanonicalControllerAuthorizationIntent {
    const targetKind = this.toHostActionTargetKind(authorization.targetKind);
    const cadence = toControllerAuthorizationCadence(authorization.cadence);
    if (!cadence) {
      throw new Error('Removed controller authorization cadence');
    }
    const action = {
      requestId: authorization.requestId,
      actionCategory: authorization.actionCategory,
      actionType: authorization.actionType,
      targetKind,
      targetId: authorization.targetId,
    };
    return {
      version: 2,
      authorizationId: authorization.id,
      controllerCredentialId: authorization.controllerCredential.credentialId,
      controllerInstallationId: authorization.controllerInstallationId,
      machineId: authorization.machineId,
      userId: authorization.userId as UserId,
      organizationId: authorization.organizationId as OrganizationId,
      projectId: authorization.projectId as ProjectId,
      cadence,
      policyRevision: authorization.policyRevision,
      effectiveGrantExpiresAtMs: getControllerDeviceGrantExpiry(
        authorization.issuedAt,
        cadence,
      ).getTime(),
      grantDescriptorHash: authorization.grantDescriptorHash,
      actionCategory: authorization.actionCategory,
      actionType: authorization.actionType,
      actionPayloadHash: authorization.actionPayloadHash,
      allowedActionTypes: [...CURRENT_AGENT_OPERATIONS],
      allowedActionCategories: [
        ...new Set(
          this.allowedGrantActions(action).map(
            (action) => ACTION_BINDINGS[action].category,
          ),
        ),
      ],
      target: {
        kind: targetKind,
        id: authorization.targetId,
        revision: null,
      },
      agentSessionId: authorization.agentSessionId,
      taskMonitorId: authorization.taskMonitorId,
      nonce: authorization.nonce,
      issuedAtMs: authorization.issuedAt.getTime(),
      expiresAtMs: authorization.expiresAt.getTime(),
    } satisfies CanonicalControllerAuthorizationIntent;
  }

  private expectedGrantDescriptorHash(
    authorization: AuthorizationWithAuthority,
  ): string {
    const cadence = toControllerAuthorizationCadence(authorization.cadence);
    if (!cadence) {
      throw new Error('Removed controller authorization cadence');
    }
    const targetKind = this.toHostActionTargetKind(authorization.targetKind);
    const action = {
      requestId: authorization.requestId,
      actionCategory: authorization.actionCategory,
      actionType: authorization.actionType,
      targetKind,
      targetId: authorization.targetId,
    };
    const target = {
      kind: targetKind,
      id: authorization.targetId,
      revision: null,
      agentSessionId: authorization.agentSessionId,
      taskMonitorId: authorization.taskMonitorId,
    } satisfies ResolvedTarget;
    return this.hashGrantDescriptor({
      controllerCredentialId: authorization.controllerCredential.credentialId,
      controllerInstallationId: authorization.controllerInstallationId,
      machineId: authorization.machineId,
      userId: authorization.userId,
      organizationId: authorization.organizationId,
      projectId: authorization.projectId,
      action,
      actionPayloadHash: authorization.actionPayloadHash,
      target,
      allowedActions: this.allowedGrantActions(action),
      cadence,
      policyRevision: authorization.policyRevision,
      issuedAt: authorization.issuedAt,
    });
  }

  private toHostActionTargetKind(
    value: PrismaHostActionTargetKind,
  ): HostActionTargetKind {
    switch (value) {
      case PrismaHostActionTargetKind.CONVERSATION:
        return HostActionTargetKind.Conversation;
      case PrismaHostActionTargetKind.AGENT_SESSION:
        return HostActionTargetKind.AgentSession;
      case PrismaHostActionTargetKind.TASK_MONITOR:
        return HostActionTargetKind.TaskMonitor;
      case PrismaHostActionTargetKind.PLATFORM_EVENT:
        return HostActionTargetKind.PlatformEvent;
      case PrismaHostActionTargetKind.APPLICATION_EFFECT:
        return HostActionTargetKind.ApplicationEffect;
      case PrismaHostActionTargetKind.EXACT_ACTION:
        return HostActionTargetKind.ExactAction;
      case PrismaHostActionTargetKind.CLI_READ:
        return HostActionTargetKind.CliRead;
    }
  }

  private async lockAuthorizationAuthority(
    tx: AnyTransactionClient,
    authorizationId: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT 1
      FROM execution_authorizations a
      JOIN machine_controller_credentials c
        ON c.id = a.controller_credential_id
      JOIN machines m ON m.id = a.machine_id
      WHERE a.authorization_id = ${authorizationId}
      FOR UPDATE OF a, c, m
    `;
  }

  private assertPrepareRequest(
    input: PrepareControllerAuthorizationRequestDto,
  ): void {
    if (
      !input ||
      typeof input !== 'object' ||
      !this.hasExactKeys(input, [
        'machineId',
        'controllerCredentialId',
        'cadence',
        'action',
      ]) ||
      !this.isUuid(input.machineId) ||
      typeof input.controllerCredentialId !== 'string' ||
      input.controllerCredentialId.length === 0 ||
      !Object.values(ControllerAuthorizationCadence).includes(input.cadence) ||
      !this.isAction(input.action)
    ) {
      this.rejectPreparation(
        ControllerAuthorizationDenialReason.ActionMismatch,
        {},
      );
    }
  }

  private assertResolveRequest(
    input: ResolveControllerAuthorizationRequestDto,
  ): void {
    const failure = this.findResolveRequestFailure(input);
    if (!failure) {
      return;
    }

    this.rejectPreparation(
      ControllerAuthorizationDenialReason.ActionMismatch,
      {},
      failure,
    );
  }

  /**
   * Names the first check a resolve request fails. Only check names, the
   * action type and schema paths are reported, never request values.
   */
  private findResolveRequestFailure(
    input: ResolveControllerAuthorizationRequestDto,
  ): Record<string, unknown> | null {
    if (!input || typeof input !== 'object') {
      return { failedCheck: 'request_shape' };
    }

    if (!this.hasExactKeys(input, ['machineId', 'action'])) {
      return { failedCheck: 'request_keys', keys: Object.keys(input) };
    }

    if (!this.isUuid(input.machineId)) {
      return { failedCheck: 'machine_id' };
    }

    if (this.isAction(input.action)) {
      return null;
    }

    const action: unknown = input.action;
    const actionObject =
      typeof action === 'object' && action !== null ? action : null;
    const actionType =
      actionObject && 'actionType' in actionObject
        ? actionObject.actionType
        : undefined;

    return {
      failedCheck: 'action_schema',
      actionType: typeof actionType === 'string' ? actionType : undefined,
      schemaFailures: actionObject
        ? hostActionPreparationFailures(actionObject)
        : [{ path: '', keyword: 'type' }],
    };
  }

  private isAction(value: unknown): value is HostActionPreparation {
    return (
      typeof value === 'object' &&
      value !== null &&
      isHostActionPreparation(value)
    );
  }

  private isSubmitRequest(
    input: SubmitControllerAuthorizedActionRequestDto,
  ): boolean {
    return Boolean(
      input &&
        typeof input === 'object' &&
        this.hasExactKeys(input, ['authorizationId', 'assertion']) &&
        this.isUuid(input.authorizationId) &&
        input.assertion &&
        typeof input.assertion === 'object' &&
        this.hasExactKeys(input.assertion, [
          'kind',
          'intent',
          'credentialId',
          'clientDataJSON',
          'authenticatorData',
          'signature',
          'userHandle',
          'grantDescriptor',
        ]) &&
        input.assertion.kind === 'controller_assertion' &&
        input.assertion.intent &&
        typeof input.assertion.intent === 'object' &&
        !Array.isArray(input.assertion.intent) &&
        typeof input.assertion.credentialId === 'string' &&
        typeof input.assertion.clientDataJSON === 'string' &&
        typeof input.assertion.authenticatorData === 'string' &&
        typeof input.assertion.signature === 'string' &&
        (input.assertion.userHandle === null ||
          typeof input.assertion.userHandle === 'string') &&
        input.assertion.grantDescriptor &&
        typeof input.assertion.grantDescriptor === 'object' &&
        !Array.isArray(input.assertion.grantDescriptor),
    );
  }

  private denied(
    reason: ControllerAuthorizationDenialReason,
    authorization: AuthorizationWithAuthority | null | undefined,
    context: Record<string, unknown>,
  ): SubmitControllerAuthorizedActionResponseDto {
    this.logger.warn('Controller authorization denied', {
      authorizationId: authorization?.id,
      controllerCredentialFingerprint:
        authorization?.controllerCredential.credentialFingerprint,
      machineId: authorization?.machineId,
      organizationId: authorization?.organizationId ?? context.organizationId,
      projectId: authorization?.projectId ?? context.projectId,
      userId: authorization?.userId ?? context.userId,
      actionType: authorization?.actionType,
      actionPayloadHash: authorization?.actionPayloadHash,
      targetKind: authorization?.targetKind,
      targetId: authorization?.targetId,
      reasonCode: reason,
    });
    return {
      outcome: 'DENIED',
      reason,
      retryable: [
        ControllerAuthorizationDenialReason.AuthorizationExpired,
        ControllerAuthorizationDenialReason.MachineNotReady,
        ControllerAuthorizationDenialReason.ControllerNotActive,
      ].includes(reason),
    } satisfies SubmitControllerAuthorizedActionResponseDto;
  }

  private rejectPreparation(
    reason: ControllerAuthorizationDenialReason,
    context: Record<string, unknown>,
    diagnostics: Record<string, unknown> = {},
  ): never {
    this.logger.warn('Controller authorization preparation denied', {
      ...diagnostics,
      machineId: context.machineId,
      organizationId: context.organizationId,
      projectId: context.projectId,
      userId: context.userId,
      reasonCode: reason,
    });
    throw new ControllerAuthorizationPreparationDeniedException(reason);
  }

  private toCredentialTransports(
    values: readonly string[],
  ): Set<ControllerAuthorizationAllowedCredential.TransportsEnum> {
    const transports =
      new Set<ControllerAuthorizationAllowedCredential.TransportsEnum>();
    for (const value of values) {
      switch (value) {
        case ControllerAuthorizationAllowedCredential.TransportsEnum.Usb:
        case ControllerAuthorizationAllowedCredential.TransportsEnum.Nfc:
        case ControllerAuthorizationAllowedCredential.TransportsEnum.Ble:
        case ControllerAuthorizationAllowedCredential.TransportsEnum.Internal:
        case ControllerAuthorizationAllowedCredential.TransportsEnum.Hybrid:
          transports.add(value);
          break;
        default:
          throw new Error(
            'Persisted controller credential transport is invalid',
          );
      }
    }
    // OpenAPI Generator models unique arrays as Set, while the HTTP contract is
    // still a JSON array. Give this response value an explicit wire form so
    // Nest does not serialize the Set as an empty object.
    Object.defineProperty(transports, 'toJSON', {
      value: () => Array.from(transports),
      enumerable: false,
    });
    return transports;
  }

  private sha256Hex(value: string): string {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private hasExactKeys(
    value: object,
    expectedKeys: readonly string[],
  ): boolean {
    const actual = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    return (
      actual.length === expected.length &&
      actual.every((key, index) => key === expected[index])
    );
  }

  private isUuid(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    );
  }

  private isOpaqueIdentifier(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
  }
}
