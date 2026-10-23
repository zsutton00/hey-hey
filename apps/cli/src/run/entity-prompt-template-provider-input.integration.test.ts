import { describe, expect, it, vi } from 'vitest';
import {
  EntityPromptTemplateEffectiveDtoLifecycleStateEnum,
  EntityPromptTemplateEffectiveDtoValidationStatusEnum,
  EntityPromptTemplateSelectorEntityType,
  EntityPromptTemplateSyntaxVersion,
  type EntityPromptTemplateSelectorDto,
} from '../shared/api/generated/api';
import {
  RunEntityReferenceEntityTypeEnum,
  type RunEntityReference,
} from '../shared/agent-bridge-contract/generated/api';
import { createTestOAuthClient } from '../auth/oauth-client.test-support';
import { EntityContextLoader } from '../agents/entity-context/entity-context-loader';
import type { LoadedEntityPromptContext } from '../agents/entity-context/types';
import { SubmissionToolAuth } from '../agents/submission-tools/submission-tool-auth';
import { NOOP_LOGGER } from '../server/logger';
import {
  AgentStartupPromptInput,
  type EntityPromptTemplatesApiClient,
} from '../commands/agent-startup-prompt-input';
import { projectProviderSessionStartupInput } from './provider-session-startup-input';

interface CanonicalCase {
  name: string;
  entityType: RunEntityReference['entityType'];
  workItemTypeKey?: string;
  templateKey: string;
  heading: string;
  body: string;
}

const structuredContextSuffix =
  '\n\n### Related entities:\n\n{{context.relatedEntities}}.\n\n### Feature hierarchy:\n\n{{context.featureHierarchy}}.\n\n### Proposals:\n\n{{context.proposals}}.\n\n### Agent sessions:\n\n{{context.agentSessions}}.';

const canonicalContent = (entry: CanonicalCase): string =>
  `\n\n## ${entry.heading}\n\n### Context identity:\n\n{{context.entityId}} / {{context.entityType}}.\n\n${entry.body}${structuredContextSuffix}`;

const canonicalCases: readonly CanonicalCase[] = [
  {
    name: 'project',
    entityType: RunEntityReferenceEntityTypeEnum.Project,
    templateKey: 'entity_context.project',
    heading: 'Project',
    body: 'Project body: {{entity.name}};\n\nstatus: {{entity.status}}.',
  },
  {
    name: 'plan',
    entityType: RunEntityReferenceEntityTypeEnum.Task,
    workItemTypeKey: 'PLAN',
    templateKey: 'entity_context.work_item.plan',
    heading: 'Plan',
    body: 'Plan body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}}.',
  },
  {
    name: 'design doc',
    entityType: RunEntityReferenceEntityTypeEnum.DesignDoc,
    templateKey: 'entity_context.design_doc',
    heading: 'Design Doc',
    body: 'Design Doc body: {{entity.name}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.',
  },
  {
    name: 'agent session',
    entityType: RunEntityReferenceEntityTypeEnum.AgentSession,
    templateKey: 'entity_context.agent_session',
    heading: 'Agent Session',
    body: 'Agent Session body: {{entity.title}};\n\nstatus: {{entity.status}}.',
  },
  {
    name: 'task',
    entityType: RunEntityReferenceEntityTypeEnum.Task,
    workItemTypeKey: 'STANDARD',
    templateKey: 'entity_context.work_item.standard',
    heading: 'Task',
    body: 'Task body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.',
  },
  {
    name: 'feature',
    entityType: RunEntityReferenceEntityTypeEnum.Task,
    workItemTypeKey: 'FEATURE',
    templateKey: 'entity_context.work_item.feature',
    heading: 'Feature',
    body: 'Feature body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.',
  },
  {
    name: 'goal',
    entityType: RunEntityReferenceEntityTypeEnum.Task,
    workItemTypeKey: 'GOAL',
    templateKey: 'entity_context.work_item.goal',
    heading: 'Goal',
    body: 'Goal body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.',
  },
  {
    name: 'bug',
    entityType: RunEntityReferenceEntityTypeEnum.Task,
    workItemTypeKey: 'BUG',
    templateKey: 'entity_context.work_item.bug',
    heading: 'Bug',
    body: 'Bug body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.',
  },
  {
    name: 'contract',
    entityType: RunEntityReferenceEntityTypeEnum.Task,
    workItemTypeKey: 'CONTRACT',
    templateKey: 'entity_context.work_item.contract',
    heading: 'Contract',
    body: 'Contract body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.',
  },
  {
    name: 'task monitor',
    entityType: RunEntityReferenceEntityTypeEnum.Task,
    workItemTypeKey: 'TASK_MONITOR',
    templateKey: 'entity_context.work_item.task_monitor',
    heading: 'Task Monitor',
    body: 'Task Monitor body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.',
  },
  {
    name: 'diagram',
    entityType: RunEntityReferenceEntityTypeEnum.Task,
    workItemTypeKey: 'DIAGRAM',
    templateKey: 'entity_context.work_item.diagram',
    heading: 'Diagram',
    body: 'Diagram body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.',
  },
  {
    name: 'diagram element',
    entityType: RunEntityReferenceEntityTypeEnum.Task,
    workItemTypeKey: 'DIAGRAM_ELEMENT',
    templateKey: 'entity_context.work_item.diagram_element',
    heading: 'Diagram Element',
    body: 'Diagram Element body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.',
  },
];

const selectorFor = (entry: CanonicalCase): EntityPromptTemplateSelectorDto =>
  entry.workItemTypeKey
    ? {
        entityType: EntityPromptTemplateSelectorEntityType.WorkItem,
        workItemTypeKey: entry.workItemTypeKey,
      }
    : {
        entityType: (() => {
          switch (entry.entityType) {
            case RunEntityReferenceEntityTypeEnum.Project:
              return EntityPromptTemplateSelectorEntityType.Project;
            case RunEntityReferenceEntityTypeEnum.DesignDoc:
              return EntityPromptTemplateSelectorEntityType.DesignDoc;
            case RunEntityReferenceEntityTypeEnum.AgentSession:
              return EntityPromptTemplateSelectorEntityType.AgentSession;
            default:
              throw new Error(`Unsupported fixed selector ${entry.entityType}.`);
          }
        })(),
      };

const loadedContextFor = (entry: CanonicalCase): LoadedEntityPromptContext => ({
  kind: 'entity',
  focalEntity: { entityType: entry.entityType, entityId: 'entity-1' },
  entity: {
    id: 'entity-1',
    name: `Canonical ${entry.heading}`,
    title: `Canonical ${entry.heading}`,
    outcome: 'Canonical outcome',
    type: entry.workItemTypeKey ?? entry.entityType,
    status: 'ACTIVE',
    sections: [],
  } as never,
  context: {
    entityId: 'entity-1',
    entityType: entry.entityType,
    displayName: `Canonical ${entry.heading}`,
    createdAt: '2026-09-04T00:00:00.000Z',
    relatedEntities: [],
    featureHierarchy: [],
    proposals: [],
    agentSessions: [],
  } as never,
});

const resolveProviderInput = async (entry: CanonicalCase) => {
  const auth = new SubmissionToolAuth(createTestOAuthClient());
  const loader = new EntityContextLoader({
    auth,
    apiBaseUrl: 'https://api.test.local',
    logger: NOOP_LOGGER,
  });
  vi.spyOn(loader, 'load').mockResolvedValue(loadedContextFor(entry));
  const selector = selectorFor(entry);
  const content = canonicalContent(entry);
  const client = {
    getProjectEntityPromptTemplateCatalog: vi.fn().mockResolvedValue({
      data: {
        success: true,
        message: 'OK',
        data: {
          projectId: 'project-1',
          templates: [{ templateKey: entry.templateKey, effective: { selector } }],
        },
        timestamp: '2026-09-04T00:00:00.000Z',
        statusCode: 200,
      },
    }),
    getEffectiveEntityPromptTemplate: vi.fn().mockResolvedValue({
      data: {
        success: true,
        message: 'OK',
        data: {
          templateKey: entry.templateKey,
          selector,
          syntaxVersion: EntityPromptTemplateSyntaxVersion.V1,
          content,
          ownershipSource: { scope: 'CANONICAL' },
          revisionId: 'canonical-heading-revision',
          revisionNumber: 4,
          lifecycleState: EntityPromptTemplateEffectiveDtoLifecycleStateEnum.Published,
          validationStatus: EntityPromptTemplateEffectiveDtoValidationStatusEnum.Valid,
          publishedAt: '2026-09-04T00:00:00.000Z',
        },
        timestamp: '2026-09-04T00:00:00.000Z',
        statusCode: 200,
      },
    }),
  } as EntityPromptTemplatesApiClient;
  const owner = new AgentStartupPromptInput({
    auth,
    apiBaseUrl: 'https://api.test.local',
    logger: NOOP_LOGGER,
    entityContextLoader: loader,
    createClient: () => client,
  });
  const startupPromptInput = await owner.resolve({
    runEntity: { entityType: entry.entityType, entityId: 'entity-1' },
    organizationId: 'organization-1',
    projectId: 'project-1',
  });
  const projection = projectProviderSessionStartupInput({
    decision: 'first-turn-mint',
    prompt: 'SHARED SESSION PROMPT',
    startupPromptInput,
  });
  if (projection.input.kind !== 'turn') throw new Error('Expected provider turn input.');
  return projection.input.prompt;
};

describe('canonical entity prompt templates at the provider boundary', () => {
  it.each(canonicalCases)('preserves the $name heading boundary', async (entry) => {
    const providerInput = await resolveProviderInput(entry);
    expect(providerInput.startsWith(`\n\n## ${entry.heading}\n\n`)).toBe(true);
    expect(providerInput).toMatchSnapshot(entry.name);
  });
});
