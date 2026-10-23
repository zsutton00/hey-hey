import { DebugEventReplayRequestDto } from '../../generated';

export interface EventReplayCaller {
  userId: string;
  organizationId: string;
}

export type EventReplayRequest = DebugEventReplayRequestDto;
