/**
 * Helpers for posting a user-visible SYSTEM message into the affected
 * conversation when a signed trigger is dropped at verification, and when the
 * CLI recovers its machine identity afterward. Without this, a dropped trigger
 * is a silent log line and "the session never starts" is invisible to the user.
 *
 * No platform-API SystemMessageData subtype is purpose-built for verification
 * drops, so these reuse the generic `ERROR` subtype with a `title`/`response`
 * naming the reason and recommending re-pair where appropriate. Posts route
 * through `MessagePoster.createOutOfBand` so the standard retry +
 * failure-persistence guarantees apply, mirroring session-monitor-message.ts.
 */

import { MessageStatus, MessageType, SystemMessageDataTypeEnum } from '../../shared/api/index';
import type { SystemMessageData } from '../../shared/api/index';
import type { MessagePoster } from '../../run/message-poster';
import type { CreateMessageBody } from '../../run/types';

/**
 * Drop reasons that are actionable enough to surface to the user. The other
 * `VerificationDropReason` values (schema, *_decode, user_id_mismatch,
 * allowlist, unknown_frame_type) signal a producer bug or an out-of-contract
 * frame the user cannot fix by re-pairing, so they stay log-only.
 * `signature_invalid` is also log-only: an unverified frame cannot be trusted
 * to name the conversation a notice would be posted into.
 */
export type DropNoticeReason =
  | 'machine_id_mismatch'
  | 'timestamp_window'
  | 'nonce_replay'
  // Surfaced from the WebSocket auth layer (not a verification drop) when the
  // platform reports this machine's credential has been revoked.
  | 'machine_revoked';

interface DropNoticeCopy {
  title: string;
  response: string;
}

const DROP_NOTICE_COPY: Record<DropNoticeReason, DropNoticeCopy> = {
  machine_id_mismatch: {
    title: 'This machine needs to be re-paired',
    response:
      'Hey Hey is sending work to a different machine identity than this one is set up with, ' +
      'so nothing here can start. Re-pair this machine from the Hey Hey web app to start ' +
      'receiving work again.',
  },
  timestamp_window: {
    title: "This machine's clock is out of sync",
    response:
      "Hey Hey dropped incoming work because this machine's clock is too far from the server's. " +
      'Set the system clock to update automatically, then try again.',
  },
  nonce_replay: {
    title: 'A repeated request was dropped',
    response:
      'Hey Hey dropped a repeated request to this machine to avoid running the same work twice. ' +
      'No action is needed.',
  },
  machine_revoked: {
    title: 'This machine needs to be re-paired',
    response:
      "Hey Hey revoked this machine's access, so nothing here can start. Re-pair this machine " +
      'from the Hey Hey web app to start receiving work again.',
  },
};

const RECOVERY_COPY: DropNoticeCopy = {
  title: 'This machine reconnected to its pairing',
  response:
    "Hey Hey noticed this machine's pairing was out of date and reconnected it automatically. " +
    'Work should start flowing again — no re-pair needed.',
};

export interface PostDropNoticeMessageArgs {
  poster: MessagePoster;
  organizationId: string;
  projectId: string;
  /** Conversation the dropped trigger was addressed to. */
  conversationId: string;
  reason: DropNoticeReason;
}

export interface PostRecoveryNoticeMessageArgs {
  poster: MessagePoster;
  organizationId: string;
  projectId: string;
  conversationId: string;
}

const postSystemNotice = async (
  poster: MessagePoster,
  ctx: { organizationId: string; projectId: string; conversationId: string },
  copy: DropNoticeCopy,
): Promise<string> => {
  const data: SystemMessageData = {
    type: SystemMessageDataTypeEnum.Error,
    title: copy.title,
    response: copy.response,
    // Drive a user notification — a non-starting session is exactly the kind of
    // failure the user needs pushed to them, not buried in the conversation.
    triggerNotification: true,
  };
  const dto: CreateMessageBody = {
    type: MessageType.System,
    status: MessageStatus.Completed,
    projectId: ctx.projectId,
    data,
    createdAt: new Date().toISOString(),
  };
  return poster.createOutOfBand({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    conversationId: ctx.conversationId,
    dto,
    // Posted out-of-band with no active Turn, so no provenance stamp.
    stamp: null,
  });
};

export const postDropNoticeMessage = (args: PostDropNoticeMessageArgs): Promise<string> =>
  postSystemNotice(args.poster, args, DROP_NOTICE_COPY[args.reason]);

export const postRecoveryNoticeMessage = (args: PostRecoveryNoticeMessageArgs): Promise<string> =>
  postSystemNotice(args.poster, args, RECOVERY_COPY);
