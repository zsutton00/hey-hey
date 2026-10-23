import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  AgentTrigger,
  ApplicationEffectLaunchBody,
  CliSettingsEnvelopeBody,
  CliReadEnvelopeBody,
  ControllerAuthorizedSignedApplicationEffectEnvelope,
  ControllerAuthorizedSignedCliReadEnvelope,
  ControllerAuthorizedSignedConversationControlEnvelope,
  ControllerAuthorizedSignedConversationTriggerEnvelope,
  ControllerAuthorizedSignedExactActionEnvelope,
  ControllerAuthorizedSignedMonitorCommandEnvelope,
  ConversationAuthorityIncreasingControlBody,
  ExactActionDeliveryBody,
  ExecutableEnvelopeAuthorization,
  MonitorAuthorityReductionBodyV2,
  MonitorAuthorityNeutralBodyV2,
  MachineRevocationReductionBodyDto,
  MonitorCommandBodyV2,
  ConversationControlStopRun,
  SignedConversationReductionEnvelope,
  SignedControllerRevocationReductionEnvelope,
  SignedMachineRevocationReductionEnvelope,
  ControllerRevocationReductionBodyDto,
  SignedCliSettingsEnvelope,
  SignedCliReadEnvelope,
  SignedConversationControlEnvelope,
  SignedMonitorReductionEnvelope,
  SignedMonitorAuthorityNeutralEnvelope,
  SignedConversationTriggerEnvelope,
  SignedMonitorCommandEnvelope,
} from '../../generated';
import { MachineId, UserId } from '../../types';
import { ServerSigningKeyService } from '../server-signing/server-signing-key.service';
import { canonicalizeJcs } from './trigger-canonicalization';

/**
 * The closed, `kind`-discriminated structural body carried by a
 * `trigger.control` frame. The conversation owner defines two variants today
 * — `stop_run` and `compact_run`; this alias tracks the envelope's `event`
 * shape so the signer stays correct as that closed set grows.
 */
export type ConversationControlBody =
  SignedConversationControlEnvelope['event'];

export type MonitorCommandBody = SignedMonitorCommandEnvelope['event'];
export type CliReadBody = CliReadEnvelopeBody;
export type CliSettingsBody = CliSettingsEnvelopeBody;

/**
 * Mints and signs every server-issued trigger envelope at one security
 * boundary: conversation input, observed platform events, conversation
 * controls, and explicit monitor commands.
 *
 * Both envelopes share one security core (`SignedEnvelopeFields`): a random
 * `nonce`, a `timestampMs`, and an Ed25519 `signature` covering the RFC 8785
 * canonicalization of `{ event, machineId, userId, nonce, timestampMs }`. The
 * CLI verifies that signature against the server public key delivered at
 * machine pairing, so the canonical bytes produced here MUST match what the
 * CLI reconstructs — see `canonicalizeJcs`.
 *
 * The Ed25519 keypair itself is owned by `ServerSigningKeyService`; this
 * service only borrows the private key for signing.
 */
@Injectable()
export class TriggerEnvelopeSigner {
  private readonly logger = new Logger(TriggerEnvelopeSigner.name);

  constructor(private readonly signingKeyService: ServerSigningKeyService) {}

  /**
   * Sign a conversation-trigger envelope wrapping a rich `AgentTrigger` body.
   */
  signConversationTrigger(
    event: AgentTrigger,
    machineId: MachineId,
    userId: UserId,
  ): SignedConversationTriggerEnvelope {
    const workflowKickoffPayload =
      event.promptType === 'start_run' &&
      event.payload?.payload?.promptType === 'workflow_kickoff'
        ? event.payload.payload
        : undefined;
    this.logger.debug('Signing conversation-trigger envelope', {
      event: 'trigger_envelope.signing',
      machineId,
      userId,
      promptType: event.promptType,
      focalScope: workflowKickoffPayload
        ? workflowKickoffPayload.entity
          ? 'entity'
          : 'unscoped'
        : undefined,
      entityType: workflowKickoffPayload?.entity?.entityType,
      entityId: workflowKickoffPayload?.entity?.entityId,
    });
    return this.mintEnvelope(event, machineId, userId);
  }

  /**
   * Sign a conversation-control envelope wrapping a closed
   * `ConversationControlBody`.
   */
  signConversationControl(
    event: ConversationControlBody,
    machineId: MachineId,
    userId: UserId,
  ): SignedConversationControlEnvelope {
    this.logger.debug('Signing conversation-control envelope', {
      machineId,
      userId,
      kind: event.kind,
    });
    return this.mintEnvelope(event, machineId, userId);
  }

  signMonitorCommand(
    event: MonitorCommandBody,
    machineId: MachineId,
    userId: UserId,
  ): SignedMonitorCommandEnvelope {
    this.logger.debug('Signing monitor-command envelope', {
      commandId: event.commandId,
      monitorId: event.target.workItemId,
      cause: event.command.cause,
      machineId,
      userId,
    });
    return this.mintEnvelope(event, machineId, userId);
  }

  signCliRead(
    event: CliReadBody,
    machineId: MachineId,
    userId: UserId,
  ): SignedCliReadEnvelope {
    this.logger.debug('Signing CLI-read envelope', {
      machineId,
      userId,
      requestId: event.requestId,
      operation: event.operation,
    });
    return this.mintEnvelope(event, machineId, userId);
  }

  signCliSettings(
    event: CliSettingsBody,
    machineId: MachineId,
    userId: UserId,
  ): SignedCliSettingsEnvelope {
    this.logger.debug('Signing CLI-settings envelope', {
      machineId,
      userId,
      requestId: event.requestId,
      operation: event.operation,
      projectId: event.projectId,
    });
    return this.mintEnvelope(event, machineId, userId);
  }

  signConversationTriggerAuthorized(
    event: AgentTrigger,
    machineId: MachineId,
    userId: UserId,
    authorization: ExecutableEnvelopeAuthorization,
  ): ControllerAuthorizedSignedConversationTriggerEnvelope {
    return this.mintAuthorizedEnvelope(event, machineId, userId, authorization);
  }

  signConversationControlAuthorized(
    event: ConversationAuthorityIncreasingControlBody,
    machineId: MachineId,
    userId: UserId,
    authorization: ExecutableEnvelopeAuthorization,
  ): ControllerAuthorizedSignedConversationControlEnvelope {
    return this.mintAuthorizedEnvelope(event, machineId, userId, authorization);
  }

  signMonitorCommandAuthorized(
    event: MonitorCommandBodyV2,
    machineId: MachineId,
    userId: UserId,
    authorization: ExecutableEnvelopeAuthorization,
  ): ControllerAuthorizedSignedMonitorCommandEnvelope {
    return this.mintAuthorizedEnvelope(event, machineId, userId, authorization);
  }

  signMonitorReduction(
    event: MonitorAuthorityReductionBodyV2,
    machineId: MachineId,
    userId: UserId,
  ): SignedMonitorReductionEnvelope {
    return this.mintReductionEnvelope(event, machineId, userId);
  }

  signMonitorAuthorityNeutral(
    event: MonitorAuthorityNeutralBodyV2,
    machineId: MachineId,
    userId: UserId,
  ): SignedMonitorAuthorityNeutralEnvelope {
    return this.mintReductionEnvelope(event, machineId, userId);
  }

  signCliReadAuthorized(
    event: CliReadBody,
    machineId: MachineId,
    userId: UserId,
    authorization: ExecutableEnvelopeAuthorization,
  ): ControllerAuthorizedSignedCliReadEnvelope {
    return this.mintAuthorizedEnvelope(event, machineId, userId, authorization);
  }

  signApplicationEffectAuthorized(
    event: ApplicationEffectLaunchBody,
    machineId: MachineId,
    userId: UserId,
    authorization: ExecutableEnvelopeAuthorization,
  ): ControllerAuthorizedSignedApplicationEffectEnvelope {
    return this.mintAuthorizedEnvelope(event, machineId, userId, authorization);
  }

  signExactActionAuthorized(
    event: ExactActionDeliveryBody,
    machineId: MachineId,
    userId: UserId,
    authorization: ExecutableEnvelopeAuthorization,
  ): ControllerAuthorizedSignedExactActionEnvelope {
    return this.mintAuthorizedEnvelope(event, machineId, userId, authorization);
  }

  signConversationReduction(
    event: SignedConversationReductionEnvelope['event'],
    machineId: MachineId,
    userId: UserId,
  ): SignedConversationReductionEnvelope {
    return this.mintReductionEnvelope(event, machineId, userId);
  }

  signControllerRevocationReduction(
    event: ControllerRevocationReductionBodyDto,
    machineId: MachineId,
    userId: UserId,
  ): SignedControllerRevocationReductionEnvelope {
    const nonce = crypto.randomUUID();
    const timestampMs = Date.now();
    const signedFields = {
      controllerCredentialId: event.controllerCredentialId,
      event,
      machineId,
      nonce,
      protocolVersion: 2 as const,
      timestampMs,
      userId,
    };
    const canonicalBytes = Buffer.from(canonicalizeJcs(signedFields), 'utf8');
    const signature = crypto
      .sign(null, canonicalBytes, this.signingKeyService.getPrivateKey())
      .toString('base64');
    this.logger.debug(
      `trigger-envelope-signer.controller-revocation.signed.diagnostic ${JSON.stringify(
        {
          machineId,
          userId,
          controllerCredentialId: event.controllerCredentialId,
          timestampMs,
          canonicalLen: canonicalBytes.length,
          canonicalSha256: crypto
            .createHash('sha256')
            .update(canonicalBytes)
            .digest('hex'),
        },
      )}`,
    );
    return {
      ...signedFields,
      signature,
    } satisfies SignedControllerRevocationReductionEnvelope;
  }

  signMachineRevocationReduction(
    event: MachineRevocationReductionBodyDto,
    machineId: MachineId,
    userId: UserId,
  ): SignedMachineRevocationReductionEnvelope {
    const envelope = this.mintReductionEnvelope(event, machineId, userId);
    return envelope satisfies SignedMachineRevocationReductionEnvelope;
  }

  /**
   * The Ed25519 public key matching the signing key. Exposed so tests can
   * verify envelopes this service produced; production code reading the
   * public key for delivery should go through `ServerSigningKeyService`.
   */
  getPublicKey(): crypto.KeyObject {
    return this.signingKeyService.getPublicKey();
  }

  private mintAuthorizedEnvelope<TEvent extends object>(
    event: TEvent,
    machineId: MachineId,
    userId: UserId,
    authorization: ExecutableEnvelopeAuthorization,
  ): {
    machineId: MachineId;
    userId: UserId;
    nonce: string;
    timestampMs: number;
    signature: string;
    protocolVersion: 2;
    authorization: ExecutableEnvelopeAuthorization;
    event: TEvent;
  } {
    const nonce = crypto.randomUUID();
    const timestampMs = Date.now();
    const signedFields = {
      authorization,
      event,
      machineId,
      nonce,
      protocolVersion: 2 as const,
      timestampMs,
      userId,
    };
    const canonical = canonicalizeJcs(signedFields);
    const canonicalBytes = Buffer.from(canonical, 'utf8');
    const signature = crypto
      .sign(null, canonicalBytes, this.signingKeyService.getPrivateKey())
      .toString('base64');
    const canonicalSha256 = crypto
      .createHash('sha256')
      .update(canonicalBytes)
      .digest('hex');
    this.logger.debug(
      `trigger-envelope-signer.authorized.signed.diagnostic ${JSON.stringify({
        machineId,
        userId,
        grantId:
          authorization.kind === 'bounded_grant'
            ? authorization.grantId
            : undefined,
        timestampMs,
        canonicalLen: canonicalBytes.length,
        canonicalSha256,
      })}`,
    );
    return {
      machineId,
      userId,
      nonce,
      timestampMs,
      signature,
      protocolVersion: 2,
      authorization,
      event,
    };
  }

  private mintReductionEnvelope<TEvent extends object>(
    event: TEvent,
    machineId: MachineId,
    userId: UserId,
  ): {
    machineId: MachineId;
    userId: UserId;
    nonce: string;
    timestampMs: number;
    signature: string;
    protocolVersion: 2;
    event: TEvent;
  } {
    const nonce = crypto.randomUUID();
    const timestampMs = Date.now();
    const signedFields = {
      event,
      machineId,
      nonce,
      protocolVersion: 2 as const,
      timestampMs,
      userId,
    };
    const canonicalBytes = Buffer.from(canonicalizeJcs(signedFields), 'utf8');
    const signature = crypto
      .sign(null, canonicalBytes, this.signingKeyService.getPrivateKey())
      .toString('base64');
    this.logger.debug(
      `trigger-envelope-signer.reduction.signed.diagnostic ${JSON.stringify({
        machineId,
        userId,
        timestampMs,
        canonicalLen: canonicalBytes.length,
        canonicalSha256: crypto
          .createHash('sha256')
          .update(canonicalBytes)
          .digest('hex'),
      })}`,
    );
    return {
      machineId,
      userId,
      nonce,
      timestampMs,
      signature,
      protocolVersion: 2,
      event,
    };
  }

  /**
   * Build a fully-populated signed envelope. The `signature` covers the
   * canonicalization of the envelope with `signature` itself removed, so the
   * object handed to `canonicalizeJcs` is exactly `{ event, machineId,
   * userId, nonce, timestampMs }`.
   */
  private mintEnvelope<TEvent extends object>(
    event: TEvent,
    machineId: MachineId,
    userId: UserId,
  ): {
    machineId: MachineId;
    userId: UserId;
    nonce: string;
    timestampMs: number;
    signature: string;
    event: TEvent;
  } {
    const nonce = crypto.randomUUID();
    const timestampMs = Date.now();

    const signedFields = { event, machineId, userId, nonce, timestampMs };
    const canonical = canonicalizeJcs(signedFields);
    const canonicalBytes = Buffer.from(canonical, 'utf8');
    const signature = crypto
      .sign(null, canonicalBytes, this.signingKeyService.getPrivateKey())
      .toString('base64');

    const canonicalSha256 = crypto
      .createHash('sha256')
      .update(canonicalBytes)
      .digest('hex');
    this.logger.debug(
      `trigger-envelope-signer.signed.diagnostic ${JSON.stringify({
        machineId,
        userId,
        timestampMs,
        canonicalLen: canonicalBytes.length,
        canonicalSha256,
      })}`,
    );

    return { machineId, userId, nonce, timestampMs, signature, event };
  }
}
