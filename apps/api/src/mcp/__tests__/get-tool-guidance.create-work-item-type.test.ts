import { createHash } from 'node:crypto';
import {
  CREATE_WORK_ITEM_TYPE_AUTHORING_AXES,
  CREATE_WORK_ITEM_TYPE_CAPABILITY_AXES,
  WORK_ITEM_TYPE_PARENTAGE_GUIDANCE,
} from '../tools/work-item-type-proposal-tools.provider';
import {
  CREATE_WORK_ITEM_TYPE_REVIEW_INSTRUCTION,
  CREATE_WORK_ITEM_TYPE_REVIEW_QUESTIONS,
} from '../tools/work-item-type-review-contract';
import { TOOL_GUIDANCE } from '../tools/tool-guidance';

describe('create_work_item_type guidance', () => {
  const guidance = TOOL_GUIDANCE.create_work_item_type.body;

  it('renders the complete guidance contract', () => {
    expect(createHash('sha256').update(guidance).digest('hex')).toBe(
      '4134c06eb5411ea4e3850ef604f8a4e669dca9a209b6e01d29c29cc2eae09ad7',
    );
  });

  it('documents source sections and explicit launch configuration', () => {
    expect(guidance).toContain(
      'HTML/CSS sections use `kind: html/css`; structured',
    );
    expect(guidance).toContain('mockups use `kind: structured-mockup`');
    expect(guidance).toContain('Both omit `schemaRef`');
    expect(guidance).toContain('choose `acceptedConfigKinds` explicitly');
  });

  it.each(CREATE_WORK_ITEM_TYPE_AUTHORING_AXES)(
    'covers authorable axis %s',
    (axis) => {
      expect(guidance).toContain(`\`${axis}\``);
    },
  );

  it.each(CREATE_WORK_ITEM_TYPE_CAPABILITY_AXES)(
    'covers named capability %s',
    (capability) => {
      expect(guidance).toContain(`\`${capability}\``);
    },
  );

  it.each(CREATE_WORK_ITEM_TYPE_REVIEW_QUESTIONS)(
    'asks $title exactly once',
    ({ prompt }) => {
      expect(guidance.split(prompt)).toHaveLength(2);
    },
  );

  it('requires one complete guessed-answer review and a user reply', () => {
    expect(guidance).toContain('every question below exactly once');
    expect(guidance).toContain('### 1. Identity, purpose, and success');
    expect(guidance).toContain(
      '**Question:** What should this type be called?',
    );
    expect(guidance).toContain('> **It sounds like:** Networking Opportunity.');
    expect(guidance).toContain('> **My read is:**');
    expect(guidance).toContain('> **Based on your description:**');
    expect(guidance).toContain(
      'do not repeat one mechanical label for every answer',
    );
    expect(guidance).toContain('Never\ncopy them as canned answers');
    expect(guidance).toContain('Replace every sample with your real inference');
    expect(guidance).toContain('Use Backlog, Active, and Completed.');
    expect(guidance).not.toContain('Use New, Active, and Resolved.');
    expect(guidance).toContain(
      'Replace `$customType` with the proposed display name',
    );
    expect(guidance).toContain(CREATE_WORK_ITEM_TYPE_REVIEW_INSTRUCTION);
    expect(guidance).toContain("stop and wait for\nthe user's reply");
    expect(guidance).toContain(
      'This fixed review replaces improvised follow-up questions',
    );
  });

  it('asks only the selected user-answerable product questions', () => {
    expect(
      CREATE_WORK_ITEM_TYPE_REVIEW_QUESTIONS.map(({ title }) => title),
    ).toEqual([
      'Identity, purpose, and success',
      'Information people need',
      'Creation and organization',
      'Progress and resolution',
      'Connections and collected work',
      'Goal tracking',
      'Sidebar',
    ]);
    expect(guidance).toContain(
      '**Question:** Do you want Goals to be able to track $customType?',
    );
    expect(guidance).toContain(
      '**Question:** Do you want $customType to appear in the sidebar?',
    );
    expect(guidance).toContain(
      'Should one also gather related work from elsewhere in the project without moving that work underneath it?',
    );
  });

  it('keeps TRACKS separate from generic edges and legacy capabilities', () => {
    expect(guidance).toContain(
      '`edgeTargets` and capability flags do not\n  authorize TRACKS',
    );
    expect(guidance).toContain('legacy aliases such as `canBeTrackedByGoals`');
    expect(guidance).toContain(
      'use `edgeTargets` only for the\n  non-TRACKS typed edges',
    );
    expect(guidance).toContain('Treat this as abstract-container behavior');
    expect(guidance).toContain('into a broad RELATED_TO policy');
    expect(guidance).toContain(
      'Do not ask the user\n  to choose edge vocabulary',
    );
  });

  it('explains automatic TASK parent-axis normalization', () => {
    expect(guidance).toContain(WORK_ITEM_TYPE_PARENTAGE_GUIDANCE);
    expect(guidance).toContain('type keys such as STANDARD');
    expect(guidance).toContain(
      'TASK is added to allowedParentEntityTypes automatically',
    );
  });
});
