import { describe, expect, it, vi } from 'vitest';

import { SystemMessageDataTypeEnum } from '../../../shared/api/index';
import { createTestMessagePoster } from '../../../run/run.test-support';
import type { CreateMessageBody } from '../../../run/types';
import { postDropNoticeMessage } from '../drop-notice-message';

const makePoster = (): {
  poster: ReturnType<typeof createTestMessagePoster>;
  createOutOfBand: ReturnType<typeof vi.fn>;
} => {
  const createOutOfBand = vi.fn(async () => 'message-id');
  return {
    poster: createTestMessagePoster({ createOutOfBand }),
    createOutOfBand,
  };
};

describe('postDropNoticeMessage (machine_revoked)', () => {
  it('posts a re-pair ERROR notice with a user notification into the conversation', async () => {
    const { poster, createOutOfBand } = makePoster();

    await postDropNoticeMessage({
      poster,
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      reason: 'machine_revoked',
    });

    expect(createOutOfBand).toHaveBeenCalledOnce();
    const args = createOutOfBand.mock.calls[0]![0] as {
      organizationId: string;
      projectId: string;
      conversationId: string;
      dto: CreateMessageBody;
    };
    expect(args.organizationId).toBe('org-1');
    expect(args.projectId).toBe('proj-1');
    expect(args.conversationId).toBe('conv-1');
    expect(args.dto.data.type).toBe(SystemMessageDataTypeEnum.Error);
    expect(args.dto.data.title).toMatch(/re-paired/u);
    expect(args.dto.data.triggerNotification).toBe(true);
  });
});
