import type { MessageStatus as GeneratedMessageStatus } from '@hey-hey/contracts/api/models';
import { MessageStatus as GeneratedMessageStatusValue } from '@hey-hey/contracts/api/models';

export const STREAMING_READY_STATUS = 'streaming_ready' as const;

export const MessageStatus = {
  ...GeneratedMessageStatusValue,
  StreamingReady: STREAMING_READY_STATUS,
} as const satisfies Record<
  string,
  GeneratedMessageStatus | typeof STREAMING_READY_STATUS
>;

export type MessageStatus =
  | GeneratedMessageStatus
  | typeof STREAMING_READY_STATUS;

export const MESSAGE_STATUS_VALUES = Object.values(MessageStatus);
