import { Injectable } from '@nestjs/common';
import { ContextResolutionService } from '../../../context/services/context-resolution.service';
import { ContextType, ContextScope } from '../../../context/interfaces';
import { OrganizationRole } from '../../../generated';
import { FeatureFlagService } from '../../../services/feature-flag/feature-flag.service';
import { ONBOARDING_NODES } from '../../constants/node-ids';
import {
  OnboardingFlowContext,
  NodeResult,
  NodeType,
} from '../../../types/flow-internal.types';
import { MutableContextHandle } from '../../../utils/mutable-context';
import { OpenerNodeBase } from '../base/';
import { ContextAuthContext } from 'src/auth/types';

interface OrganizationalInsightsData {
  totalProjects: number;
  organizationalMaturity: 'early' | 'growing' | 'established';
  maturityDistribution: {
    active: number;
    completed: number;
    onboarding: number;
  };
}

/**
 * Onboarding Welcome Node - First node in onboarding flow
 *
 * Presents welcome message and initial project setup questions.
 * Optionally includes organizational intelligence if feature is enabled.
 */
@Injectable()
export class OnboardingWelcomeNode extends OpenerNodeBase<OnboardingFlowContext> {
  readonly id = ONBOARDING_NODES.WELCOME;
  readonly title = 'Project Concept';
  startMessage = 'Gathering our thoughts...';

  constructor(
    private featureFlagService: FeatureFlagService,
    private contextResolutionService: ContextResolutionService,
  ) {
    super();
  }

  async execute(
    tracker: MutableContextHandle<OnboardingFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();

    // Check if organizational intelligence is enabled for this organization
    const orgIntelligenceEnabled = await this.featureFlagService.isEnabled(
      'organizational_intelligence',
      {
        organizationId: context.core.organizationId,
        projectId: context.core.projectId,
      },
    );

    // Get organizational intelligence when feature is enabled
    let organizationalInsights = null;
    if (orgIntelligenceEnabled) {
      try {
        const contextResult =
          await this.contextResolutionService.resolveContext({
            type: ContextType.PROJECT,
            scope: ContextScope.ORGANIZATION,
            organizationId: context.core.organizationId,
            projectId: context.core.projectId,
            maxResults: 5,
            correlationId: context.core.workflowId,
            authContext: buildAuthContext(context),
          });

        organizationalInsights = contextResult.artifacts.find(
          (artifact) => artifact.type === 'ORGANIZATIONAL_INSIGHT',
        );
      } catch (error) {
        // Log error but don't fail the entire flow
        console.warn('Failed to fetch organizational intelligence:', error);
      }
    }

    return {
      type: NodeType.QUESTIONS,
      message:
        "Welcome! I'm here to help you set up your project and create a roadmap. Let's start with understanding what you're building and the context around it.",
      uiElements: [
        {
          type: 'textarea',
          id: 'project_concept',
          label: 'Project Concept',
          placeholder: 'Tell me about your project idea...',
          multiline: true,
          required: true,
          influences: [],
        },
        {
          type: 'select',
          id: 'project_maturity',
          label: 'How would you describe the current state of this project?',
          required: true,
          influences: [],
          options: [
            {
              value: 'greenfield',
              label: 'New/Greenfield - Starting from scratch',
            },
            {
              value: 'early',
              label: 'Early - Some work complete',
            },
            {
              value: 'mature',
              label: 'Existing/Mature - Already in development or production',
            },
            {
              value: 'legacy',
              label:
                'Legacy - No longer under active development. Maintenance only.',
            },
          ],
        },
        {
          type: 'select',
          id: 'team_size',
          label: 'What is your team size for this project?',
          required: true,
          influences: [],
          options: [
            {
              value: 'solo',
              label: 'Solo (1 person)',
            },
            {
              value: 'small',
              label: 'Small team (2-5 people)',
            },
            {
              value: 'medium',
              label: 'Medium team (6-15 people)',
            },
            {
              value: 'large',
              label: 'Large team (16+ people)',
            },
          ],
        },
        {
          type: 'select',
          id: 'project_age',
          label: 'How long has this project existed?',
          required: true,
          influences: [],
          options: [
            { value: 'not_started', label: 'Not started yet' },
            {
              value: 'less_than_six_months',
              label: 'Less than six months',
            },
            {
              value: 'six_to_twenty_four_months',
              label: 'Six to twenty-four months',
            },
            { value: 'more_than_two_years', label: 'More than two years' },
          ],
        },
        ...(orgIntelligenceEnabled
          ? [
              {
                type: 'select' as const,
                id: 'org_context',
                label: organizationalInsights?.data
                  ? `How does this project relate to your organization? (${(organizationalInsights.data as OrganizationalInsightsData).totalProjects} existing projects)`
                  : 'How does this project relate to your organization?',
                required: true,
                influences: [],
                options: organizationalInsights?.data
                  ? [
                      {
                        value: 'new_initiative',
                        label: `New initiative within existing organization (${(organizationalInsights.data as OrganizationalInsightsData).organizationalMaturity} org)`,
                      },
                      {
                        value: 'expansion',
                        label:
                          'Expansion of existing organizational capabilities',
                      },
                      {
                        value: 'replacement',
                        label:
                          'Replacing/upgrading existing organizational systems',
                      },
                      ...(((
                        organizationalInsights.data as OrganizationalInsightsData
                      ).organizationalMaturity === 'early'
                        ? [
                            {
                              value: 'foundational',
                              label:
                                'Foundational project for growing organization',
                            },
                          ]
                        : []) as Array<{ value: string; label: string }>),
                    ]
                  : [
                      {
                        value: 'new_company',
                        label: 'New company/startup - This is our main focus',
                      },
                      {
                        value: 'new_initiative',
                        label: 'New initiative within existing organization',
                      },
                      {
                        value: 'expansion',
                        label:
                          'Expansion of existing organizational capabilities',
                      },
                      {
                        value: 'replacement',
                        label:
                          'Replacing/upgrading existing organizational systems',
                      },
                    ],
              },
            ]
          : [
              {
                type: 'select' as const,
                id: 'org_context',
                label: 'How does this project relate to your organization?',
                required: true,
                influences: [],
                options: [
                  {
                    value: 'new_company',
                    label: 'New company/startup',
                  },
                  {
                    value: 'existing_org',
                    label: 'Part of existing organization',
                  },
                  {
                    value: 'hobby',
                    label: 'Hobby/Personal project',
                  },
                ],
              },
            ]),
      ],
      data: {
        type: 'QUESTIONS',
        detectedIntent: '',
        intentConfidence: 0,
      },
    } as NodeResult;
  }
}

function buildAuthContext(
  context: OnboardingFlowContext,
): ContextAuthContext | undefined {
  const userId = context.core.user?.id;
  const organizationId = context.core.organizationId;

  if (!userId || !organizationId) {
    return undefined;
  }

  const authContext: ContextAuthContext = {
    sub: userId,
    currentOrgId: organizationId,
    orgMemberships: [
      {
        orgId: organizationId,
        role: normalizeRole(context.core.user?.role),
      },
    ],
  };

  const projectId = context.core.projectId;
  if (projectId) {
    authContext.projectIds = [projectId];
  }

  return authContext;
}

function normalizeRole(role?: string): OrganizationRole {
  switch ((role || '').toUpperCase()) {
    case 'OWNER':
      return 'OWNER';
    case 'ADMIN':
      return 'ADMIN';
    case 'VIEWER':
      return 'VIEWER';
    default:
      return 'MEMBER';
  }
}
