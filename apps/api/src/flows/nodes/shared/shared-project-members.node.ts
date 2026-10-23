import { Injectable } from '@nestjs/common';
import { UIHints } from 'src/generated';
import {
  NodeResult,
  NodeType,
  OnboardingFlowContext,
} from '../../../types/flow-internal.types';
import { SHARED_NODES } from '../../constants/node-ids';
import { ActionNodeBase } from '../base/';

/**
 * Shared Project Members Node - Team setup
 *
 * Presents team member invitation UI with email input.
 * This is a skippable step.
 */
@Injectable()
export class SharedProjectMembersNode extends ActionNodeBase<OnboardingFlowContext> {
  readonly id = SHARED_NODES.PROJECT_MEMBERS;
  readonly title = 'Invite Team Members';
  readonly skippable = true;
  readonly uiHints: UIHints = {
    expectedElements: [
      {
        type: 'team_members',
        count: 1,
        label: 'Team Member Email Addresses',
        required: false,
      },
    ],
    estimatedCount: 1,
    layoutHint: 'form' as const,
  };

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.LLM_QUESTIONS,
      archive: false,
      message:
        "Excellent! Now let's set up your project team. I can suggest potential members based on your connected integrations.",
      data: {
        detectedIntent: 'team_setup',
        intentConfidence: 0.9,
        skippable: true,
      },
      uiElements: [
        {
          id: 'team_members',
          type: 'team_members' as const,
          label: 'Team Member Email Addresses',
          placeholder: '',
          required: false,
          influences: [],
        },
      ],
      uiHints: {
        expectedElements: [
          {
            type: 'team_members',
            count: 1,
            label: 'Team Member Email Addresses',
            required: false,
          },
        ],
        estimatedCount: 1,
        layoutHint: 'form',
      },
    };
  }
}
