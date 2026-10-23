import type { ApiRuntime } from '@hey-hey/ui-common/clients';
import type { KeyPairStore } from '../../credentials';
import type { MessagePoster } from '../../run/message-poster';
import type { ServerLogger } from '../logger';
import type { MonitorProjectContext } from '../monitors/project-context';
import type { PlatformWebSocketEvent } from '../platform-ws';
import {
  postDropNoticeMessage,
  postRecoveryNoticeMessage,
  type DropNoticeReason,
} from './drop-notice-message';
import { GeneratedMachineDirectory, MachineIdentityReconciler } from './reconcile-machine-identity';
import type { TriggerVerifier, VerificationDropReason } from './verify';

/** Resolved org/project/conversation a drop-notice message is posted into. */
export interface DropSurfacingContext {
  organizationId: string;
  projectId: string;
  conversationId: string;
}

/** Wiring that turns verification drops into a user-visible recovery signal. */
export interface TriggerDropSurfacingDependencies {
  poster: MessagePoster;
  projectContext: MonitorProjectContext;
  /** The machineId the verifier is bound to at startup (the stale candidate). */
  initialMachineId: string;
  /**
   * Consecutive `signature_invalid` drops before a reconcile is attempted.
   * `machine_id_mismatch` triggers reconcile on the first drop regardless.
   * Defaults to 3.
   */
  signatureInvalidThreshold?: number;
}

export interface TriggerDropRecoverySurfaceDependencies {
  verifier: TriggerVerifier;
  machinesApi: ApiRuntime['clients']['machines'];
  keyPairStore: KeyPairStore;
  surfacing: TriggerDropSurfacingDependencies;
  logger: ServerLogger;
}

/**
 * Drop reasons posted into the frame's conversation. Each is raised only after
 * the platform signature verified, so the frame came from the platform.
 * `signature_invalid` is handled separately: an unverified frame proves
 * nothing, including which conversation it names, so it is never posted.
 */
const SURFACEABLE_DROP_REASONS = new Set<VerificationDropReason>([
  'machine_id_mismatch',
  'timestamp_window',
  'nonce_replay',
]);

const DEFAULT_SIGNATURE_INVALID_THRESHOLD = 3;

/** Owns verification-drop state, user surfacing, and machine-identity recovery. */
export class TriggerDropRecoverySurface {
  private readonly machineIdentityReconciler: MachineIdentityReconciler;
  // Consecutive `signature_invalid` drops across all frames; reset on the next
  // successful verification or a successful reconcile.
  private signatureInvalidCount = 0;
  private signatureReconcileInFlight = false;
  // Reasons already surfaced per conversation, so one unresolved reason yields
  // exactly one message until a successful verification resets the conversation.
  private readonly surfacedReasons = new Map<string, Set<string>>();
  // Per-conversation guard so concurrent drops don't fire overlapping
  // reconciles for the same conversation.
  private readonly reconcileInFlight = new Set<string>();
  // The machineId the shared verifier is currently bound to. Updated in place
  // after recovery so later reconciles compare against the recovered identity.
  private currentMachineId: string;
  private readonly signatureInvalidThreshold: number;

  public constructor(private readonly dependencies: TriggerDropRecoverySurfaceDependencies) {
    const machineDirectory = new GeneratedMachineDirectory(dependencies.machinesApi);
    this.machineIdentityReconciler = new MachineIdentityReconciler({
      machineDirectory,
      keyPairStore: dependencies.keyPairStore,
      logger: dependencies.logger,
    });
    this.currentMachineId = dependencies.surfacing.initialMachineId;
    this.signatureInvalidThreshold =
      dependencies.surfacing.signatureInvalidThreshold ?? DEFAULT_SIGNATURE_INVALID_THRESHOLD;
  }

  private resolveContext(event: PlatformWebSocketEvent): DropSurfacingContext | null {
    const conversationId = typeof event.conversationId === 'string' ? event.conversationId : null;
    const organizationId = typeof event.organizationId === 'string' ? event.organizationId : null;
    const projectId =
      (typeof event.projectId === 'string' ? event.projectId : null) ??
      this.dependencies.surfacing.projectContext.currentProjectId;
    if (!conversationId || !organizationId || !projectId) return null;
    return { organizationId, projectId, conversationId };
  }

  private async postDeduped(
    context: DropSurfacingContext,
    reasonKey: DropNoticeReason | 'recovered',
  ): Promise<void> {
    const { logger, surfacing } = this.dependencies;
    const surfaced = this.surfacedReasons.get(context.conversationId) ?? new Set<string>();
    if (surfaced.has(reasonKey)) return;
    surfaced.add(reasonKey);
    this.surfacedReasons.set(context.conversationId, surfaced);
    try {
      if (reasonKey === 'recovered') {
        await postRecoveryNoticeMessage({ poster: surfacing.poster, ...context });
      } else {
        await postDropNoticeMessage({ poster: surfacing.poster, ...context, reason: reasonKey });
      }
    } catch (error) {
      logger.error('trigger-verification.drop_surfacing.post_failed', {
        conversationId: context.conversationId,
        reasonKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async reconcileAndSurface(
    context: DropSurfacingContext,
    reason: DropNoticeReason,
  ): Promise<void> {
    const { logger, verifier } = this.dependencies;
    if (this.reconcileInFlight.has(context.conversationId)) return;
    this.reconcileInFlight.add(context.conversationId);
    try {
      const outcome = await this.machineIdentityReconciler.reconcile(this.currentMachineId);
      if (outcome.kind === 'reloaded') {
        verifier.reload({
          serverSigningPublicKey: Buffer.from(outcome.serverSigningPublicKeyB64, 'base64'),
          expectedMachineId: outcome.machineId,
        });
        this.currentMachineId = outcome.machineId;
        this.signatureInvalidCount = 0;
        await this.postDeduped(context, 'recovered');
        return;
      }
      // Reconcile could not resolve a unique machine — the only recourse is a
      // manual re-pair, so surface the actionable error for this reason.
      await this.postDeduped(context, reason);
    } catch (error) {
      logger.error('trigger-verification.drop_surfacing.reconcile_failed', {
        conversationId: context.conversationId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.reconcileInFlight.delete(context.conversationId);
    }
  }

  /**
   * Repeated bad signatures can mean this machine holds a stale server key, so
   * recovery is retried against the API. The outcome stays in the local log
   * because no conversation from an unverified frame can be trusted.
   */
  private async reconcileAfterSignatureFailures(): Promise<void> {
    const { logger, verifier } = this.dependencies;
    if (this.signatureReconcileInFlight) return;
    this.signatureReconcileInFlight = true;
    try {
      const outcome = await this.machineIdentityReconciler.reconcile(this.currentMachineId);
      if (outcome.kind === 'reloaded') {
        verifier.reload({
          serverSigningPublicKey: Buffer.from(outcome.serverSigningPublicKeyB64, 'base64'),
          expectedMachineId: outcome.machineId,
        });
        this.currentMachineId = outcome.machineId;
        this.signatureInvalidCount = 0;
        logger.info('trigger-verification.drop_surfacing.signature_recovered', {
          machineId: outcome.machineId,
        });
        return;
      }
      logger.warn('trigger-verification.drop_surfacing.signature_needs_repair', {
        reason: outcome.reason,
      });
    } catch (error) {
      logger.error('trigger-verification.drop_surfacing.reconcile_failed', {
        reason: 'signature_invalid',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.signatureReconcileInFlight = false;
    }
  }

  public handleDrop(event: PlatformWebSocketEvent, reason: VerificationDropReason): void {
    if (reason === 'signature_invalid') {
      this.signatureInvalidCount += 1;
      // A single bad signature can be transient; only reconcile once frames
      // have failed repeatedly against the loaded key.
      if (this.signatureInvalidCount >= this.signatureInvalidThreshold) {
        void this.reconcileAfterSignatureFailures();
      }
      return;
    }
    if (!SURFACEABLE_DROP_REASONS.has(reason)) return;
    const context = this.resolveContext(event);
    if (!context) {
      this.dependencies.logger.warn('trigger-verification.drop_surfacing.no_context', {
        reason,
        conversationId: event.conversationId,
      });
      return;
    }

    if (reason === 'machine_id_mismatch') {
      // A stale machineId can be recovered without user action — try first.
      void this.reconcileAndSurface(context, 'machine_id_mismatch');
      return;
    }
    // timestamp_window | nonce_replay — not recoverable by reconcile; surface
    // the reason directly so the user can act (fix clock) or understand it.
    void this.postDeduped(context, reason as DropNoticeReason);
  }

  public reset(conversationId: string): void {
    this.signatureInvalidCount = 0;
    this.surfacedReasons.delete(conversationId);
  }
}
