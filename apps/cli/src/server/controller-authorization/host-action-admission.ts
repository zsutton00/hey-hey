import type { ServerLogger } from '../logger';
import { AuthorizationReplayStore } from './authorization-replay-store';
import { ControllerAssertionVerifier } from './controller-assertion-verifier';
import { ExecutionGrantStore } from './execution-grant-store';
import { AdmittedHostAction } from './types';
import type {
  ControllerAuthorizationDenialReason,
  ExecutableEnvelopeAuthorization,
  HostActionAdmissionRequest,
  HostActionAdmissionResult,
} from './types';
import { CURRENT_AGENT_OPERATION_CATEGORY, isCurrentAgentOperation } from './types';

export interface HostActionAdmissionOptions {
  logger?: ServerLogger;
  assertionVerifier: ControllerAssertionVerifier;
  grantStore: ExecutionGrantStore;
  replayStore: AuthorizationReplayStore;
}

const denialFromError = (error: Error): ControllerAuthorizationDenialReason => {
  switch (error.message) {
    case 'GRANT_SCOPE_MISMATCH':
      return 'GRANT_SCOPE_MISMATCH';
    case 'GRANT_NOT_ACTIVE':
      return 'GRANT_NOT_ACTIVE';
    default:
      return 'STORAGE_UNAVAILABLE';
  }
};

class AdmittedHostActionCapability extends AdmittedHostAction {
  public constructor(
    actionType: HostActionAdmissionRequest['actionType'],
    authorizationId: string,
    envelopeNonce: string,
  ) {
    super(actionType, authorizationId, envelopeNonce);
  }
}

const admitted = (
  request: HostActionAdmissionRequest,
  authorizationId: string,
  grantId?: string,
): HostActionAdmissionResult => ({
  admitted: true,
  authorizationId,
  ...(grantId ? { grantId } : {}),
  capability: new AdmittedHostActionCapability(
    request.actionType,
    authorizationId,
    request.envelopeNonce,
  ),
});

/** Sole coordinator for controller/grant admission before a host effect. */
export class HostActionAdmission {
  public constructor(private readonly options: HostActionAdmissionOptions) {}

  /** `logger` carries the caller's safe attempt correlation; authorization values never do. */
  private async timed<T>(
    stage: string,
    logger: ServerLogger | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    const started = performance.now();
    logger?.debug(`trigger-admission.${stage}.started`);
    try {
      const result = await operation();
      logger?.debug(`trigger-admission.${stage}.completed`, {
        elapsedMs: performance.now() - started,
      });
      return result;
    } catch (error) {
      logger?.debug(`trigger-admission.${stage}.failed`, {
        elapsedMs: performance.now() - started,
      });
      throw error;
    }
  }

  private async admitGrant(
    authorization: Extract<ExecutableEnvelopeAuthorization, { kind: 'bounded_grant' }>,
    context: HostActionAdmissionRequest,
    logger: ServerLogger | undefined,
  ): Promise<HostActionAdmissionResult> {
    try {
      const grant = await this.timed('grant_check', logger, () =>
        this.options.grantStore.admit(
          {
            grantId: authorization.grantId,
            machineId: context.machineId,
            userId: context.userId,
            organizationId: context.organizationId,
            actionType: context.actionType,
            actionCategory: context.actionCategory,
          },
          logger,
        ),
      );
      return admitted(context, authorization.grantId, grant.grantId);
    } catch (error) {
      return {
        admitted: false,
        reason: denialFromError(error instanceof Error ? error : new Error(String(error))),
      };
    }
  }

  private async activate(
    authorization: Extract<ExecutableEnvelopeAuthorization, { kind: 'controller_assertion' }>,
    request: HostActionAdmissionRequest,
    logger: ServerLogger | undefined,
  ): Promise<HostActionAdmissionResult> {
    let assertion;
    try {
      assertion = await this.timed('assertion_verify', logger, () =>
        this.options.assertionVerifier.verify(authorization, {
          ...request,
          controllerInstallationId: authorization.intent.controllerInstallationId,
          agentSessionId: authorization.intent.agentSessionId,
          taskMonitorId: authorization.intent.taskMonitorId,
        }),
      );
    } catch {
      return { admitted: false, reason: 'STORAGE_UNAVAILABLE' };
    }
    if (!assertion.ok) return { admitted: false, reason: assertion.reason };

    // Durable operation delivery may replay the same persisted controller
    // assertion after a websocket timeout. If this CLI already activated the
    // exact reusable grant, treat the assertion as a safe re-delivery of that
    // grant instead of consuming the authorization identity a second time.
    if (authorization.grantId !== null) {
      try {
        const existingGrant = await this.timed('grant_check', logger, () =>
          this.options.grantStore.admit(
            {
              grantId: authorization.grantId,
              machineId: request.machineId,
              userId: request.userId,
              organizationId: request.organizationId,
              actionType: request.actionType,
              actionCategory: request.actionCategory,
            },
            logger,
          ),
        );
        const freshEnvelope = await this.timed('nonce_record', logger, () =>
          this.options.replayStore.consume(
            request.envelopeNonce,
            undefined,
            logger,
          ),
        );
        if (!freshEnvelope) return { admitted: false, reason: 'REPLAY_DETECTED' };
        return admitted(request, assertion.authorizationId, existingGrant.grantId);
      } catch (error) {
        if (error instanceof Error && error.message !== 'GRANT_NOT_ACTIVE') {
          return { admitted: false, reason: denialFromError(error) };
        }
      }
    }

    try {
      const fresh = await this.timed('nonce_record', logger, () =>
        this.options.replayStore.consumeMany(
          [request.envelopeNonce, assertion.authorizationId],
          assertion.intent.expiresAtMs,
          logger,
        ),
      );
      if (!fresh) return { admitted: false, reason: 'REPLAY_DETECTED' };
    } catch {
      return { admitted: false, reason: 'STORAGE_UNAVAILABLE' };
    }

    if (authorization.grantId === null) {
      return admitted(request, assertion.authorizationId);
    }
    try {
      const grant = await this.timed('grant_activation', logger, () =>
        this.options.grantStore.create(
          {
            grantId: authorization.grantId,
            descriptor: authorization.grantDescriptor,
            descriptorHash: assertion.intent.grantDescriptorHash,
            controllerCredentialFingerprint: assertion.credentialFingerprint,
          },
          logger,
        ),
      );
      return admitted(request, assertion.authorizationId, grant.grantId);
    } catch {
      return { admitted: false, reason: 'STORAGE_UNAVAILABLE' };
    }
  }

  public async admit(
    request: HostActionAdmissionRequest,
    logger = this.options.logger,
  ): Promise<HostActionAdmissionResult> {
    if (
      !isCurrentAgentOperation(request.actionType) ||
      CURRENT_AGENT_OPERATION_CATEGORY[request.actionType] !== request.actionCategory
    ) {
      return { admitted: false, reason: 'ACTION_MISMATCH' };
    }
    if (request.authorization.kind === 'bounded_grant') {
      const grantResult = await this.admitGrant(request.authorization, request, logger);
      if (!grantResult.admitted) return grantResult;
      try {
        const fresh = await this.timed('nonce_record', logger, () =>
          this.options.replayStore.consume(
            request.envelopeNonce,
            undefined,
            logger,
          ),
        );
        if (!fresh) return { admitted: false, reason: 'REPLAY_DETECTED' };
      } catch {
        return { admitted: false, reason: 'STORAGE_UNAVAILABLE' };
      }
      return grantResult;
    }

    return this.activate(request.authorization, request, logger);
  }

  /** Reductions retain signed transport checks but intentionally skip grants. */
  public async admitReduction(
    envelopeNonce: string,
    logger = this.options.logger,
  ): Promise<HostActionAdmissionResult> {
    try {
      const fresh = await this.timed('nonce_record', logger, () =>
        this.options.replayStore.consume(
          envelopeNonce,
          undefined,
          logger,
        ),
      );
      return fresh
        ? {
            admitted: true,
            authorizationId: envelopeNonce,
            capability: new AdmittedHostActionCapability(
              'CONVERSATION_TRIGGER',
              envelopeNonce,
              envelopeNonce,
            ),
          }
        : { admitted: false, reason: 'REPLAY_DETECTED' };
    } catch {
      return { admitted: false, reason: 'STORAGE_UNAVAILABLE' };
    }
  }
}
