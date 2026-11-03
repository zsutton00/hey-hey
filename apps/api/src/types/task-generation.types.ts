import type { TaskStub } from '@hey-hey/contracts/api/models';

export type TaskStubSourceType = TaskStub.SourceTypeEnum;

export type TaskStubStatus =
  | 'suggested'
  | 'approved'
  | 'rejected'
  | 'user_added';

export interface TaskStubSessionState {
  round: number;
  stubs: TaskStub[];
  latestSourceSummary?: string;
}

export interface TaskStubFeedbackPayload {
  approvedStubIds?: string[];
  rejectedStubIds?: string[];
  userAddedStubs?: Array<{
    title: string;
    shortDescription: string;
    sourceType?: TaskStubSourceType;
  }>;
}
