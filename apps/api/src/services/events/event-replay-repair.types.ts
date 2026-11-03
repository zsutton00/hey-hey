import { DebugEventReplayRequestDto } from '@hey-hey/contracts/api/models';

export interface EventReplayCaller {
  userId: string;
  organizationId: string;
}

export type EventReplayRequest = DebugEventReplayRequestDto;
