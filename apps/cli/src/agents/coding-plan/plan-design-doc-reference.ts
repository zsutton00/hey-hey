import { z } from 'zod';
import type { LocalPromptDesignDocInput } from '../../shared/agent-bridge-contract/generated/api';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';

export interface FetchPlanDesignDocReferenceInput {
  organizationId: string;
  projectId: string;
  planId: string;
  deps: PromptTypeHandlerDeps;
}

const contextRelatedEntitySchema = z
  .object({
    entityId: z.string().min(1),
    entityType: z.string().min(1),
    displayName: z.string().optional(),
  })
  .passthrough();

const entityContextSchema = z
  .object({
    entityId: z.string().min(1),
    entityType: z.string().min(1),
    displayName: z.string().optional(),
    relatedEntities: z.array(contextRelatedEntitySchema).optional(),
    content: z
      .object({
        sections: z.record(z.string()),
      })
      .optional(),
  })
  .passthrough();

const contextEnvelopeSchema = z
  .object({
    data: entityContextSchema.nullable().optional(),
  })
  .passthrough();

type EntityContext = z.infer<typeof entityContextSchema>;

const encode = (value: string): string => encodeURIComponent(value);

const buildContextUrl = (input: {
  apiBaseUrl: string;
  organizationId: string;
  projectId: string;
  entityType: string;
  entityId: string;
}): string =>
  `${input.apiBaseUrl}/organizations/${encode(input.organizationId)}` +
  `/projects/${encode(input.projectId)}` +
  `/entities/${encode(input.entityType)}/${encode(input.entityId)}/context`;

const fetchEntityContext = async (input: {
  organizationId: string;
  projectId: string;
  entityType: 'TASK' | 'DESIGN_DOC';
  entityId: string;
  deps: PromptTypeHandlerDeps;
}): Promise<EntityContext | null> => {
  const { organizationId, projectId, entityType, entityId, deps } = input;

  let accessToken: string;
  try {
    accessToken = await deps.auth.getAccessToken();
  } catch (error) {
    deps.logger.warn('coding_plan.plan_design_doc_reference.auth_failed', {
      organizationId,
      projectId,
      entityType,
      entityId,
      error,
    });
    return null;
  }

  const url = buildContextUrl({
    apiBaseUrl: deps.apiBaseUrl,
    organizationId,
    projectId,
    entityType,
    entityId,
  });

  try {
    const response = await deps.fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      deps.logger.warn('coding_plan.plan_design_doc_reference.http_error', {
        organizationId,
        projectId,
        entityType,
        entityId,
        status: response.status,
      });
      return null;
    }

    const rawBody = await response.json();
    const direct = entityContextSchema.safeParse(rawBody);
    if (direct.success) {
      return direct.data;
    }

    const envelope = contextEnvelopeSchema.safeParse(rawBody);
    if (envelope.success) {
      return envelope.data.data ?? null;
    }

    deps.logger.warn('coding_plan.plan_design_doc_reference.malformed_body', {
      organizationId,
      projectId,
      entityType,
      entityId,
    });
    return null;
  } catch (error) {
    deps.logger.warn('coding_plan.plan_design_doc_reference.fetch_failed', {
      organizationId,
      projectId,
      entityType,
      entityId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
};

const compactSections = (sections: Record<string, string>): Record<string, string> => {
  const compacted: Record<string, string> = {};
  for (const key of Object.keys(sections).sort()) {
    const value = sections[key]?.trim();
    if (value) {
      compacted[key] = value;
    }
  }
  return compacted;
};

export const fetchPlanDesignDocReference = async ({
  organizationId,
  projectId,
  planId,
  deps,
}: FetchPlanDesignDocReferenceInput): Promise<LocalPromptDesignDocInput | null> => {
  deps.logger.debug('coding_plan.plan_design_doc_reference.resolve_start', {
    organizationId,
    projectId,
    planId,
  });

  const planContext = await fetchEntityContext({
    organizationId,
    projectId,
    entityType: 'TASK',
    entityId: planId,
    deps,
  });
  if (!planContext) {
    deps.logger.debug('coding_plan.plan_design_doc_reference.plan_context_missing', {
      organizationId,
      projectId,
      planId,
    });
    return null;
  }

  const designDocRelation = planContext.relatedEntities?.find(
    (entity) => entity.entityType === 'DESIGN_DOC',
  );
  if (!designDocRelation) {
    deps.logger.debug('coding_plan.plan_design_doc_reference.no_design_doc_relation', {
      organizationId,
      projectId,
      planId,
    });
    return null;
  }

  const designDocContext = await fetchEntityContext({
    organizationId,
    projectId,
    entityType: 'DESIGN_DOC',
    entityId: designDocRelation.entityId,
    deps,
  });
  if (!designDocContext) {
    deps.logger.debug('coding_plan.plan_design_doc_reference.design_doc_context_missing', {
      organizationId,
      projectId,
      planId,
      designDocId: designDocRelation.entityId,
    });
    return null;
  }

  const sections = compactSections(designDocContext.content?.sections ?? {});
  if (Object.keys(sections).length === 0) {
    deps.logger.debug('coding_plan.plan_design_doc_reference.design_doc_empty', {
      organizationId,
      projectId,
      planId,
      designDocId: designDocRelation.entityId,
    });
    return null;
  }

  const title = designDocContext.displayName?.trim() || designDocRelation.displayName?.trim();
  deps.logger.debug('coding_plan.plan_design_doc_reference.resolved', {
    organizationId,
    projectId,
    planId,
    designDocId: designDocContext.entityId,
    hasTitle: Boolean(title),
    sectionCount: Object.keys(sections).length,
  });

  return {
    id: designDocContext.entityId,
    ...(title ? { title } : {}),
    sections,
  };
};
