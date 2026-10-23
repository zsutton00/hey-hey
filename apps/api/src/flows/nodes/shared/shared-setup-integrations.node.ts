import { Injectable } from '@nestjs/common';
import { UIHints } from 'src/generated';
import {
  NodeResult,
  NodeType,
  OnboardingFlowContext,
  QuestionsNodeBase,
} from '../../../types/flow-internal.types';
import { SHARED_NODES } from '../../constants/node-ids';

/**
 * Shared Setup Integrations Node - Connect external tools
 *
 * Presents integration selector UI to connect GitHub, Jira, etc.
 * This is a skippable step in the onboarding flow.
 */
@Injectable()
export class SharedSetupIntegrationsNode extends QuestionsNodeBase<OnboardingFlowContext> {
  readonly id = SHARED_NODES.SETUP_INTEGRATIONS;
  readonly title = 'Connect Integrations';
  readonly skippable = true;
  readonly uiHints: UIHints = {
    expectedElements: [
      {
        type: 'integration_selector',
        count: 1,
        label: 'Select integrations to connect',
        required: false,
      },
    ],
    estimatedCount: 1,
    layoutHint: 'form' as const,
  };

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.QUESTIONS,
      archive: false,
      message:
        "Great! Now let's connect your external tools and services to get the most out of your project workspace.",
      data: {
        detectedIntent: '',
        intentConfidence: 0,
        skippable: true,
      },
      uiElements: [
        {
          id: 'integration_selector',
          type: 'integration_selector' as const,
          label: 'Select integrations to connect',
          availableIntegrations: ['github', 'jira'],
          influences: [],
        },
      ],
      uiHints: {
        expectedElements: [
          {
            type: 'integration_selector',
            count: 1,
            label: 'Select integrations to connect',
            required: false,
          },
        ],
        estimatedCount: 1,
        layoutHint: 'form',
      },
    };
  }
}
