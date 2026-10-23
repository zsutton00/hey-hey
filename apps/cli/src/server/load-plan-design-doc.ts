import { z } from 'zod';
import type { ServerLogger } from './logger';

const planDesignDocReferenceSchema = z
  .object({
    id: z.string().uuid(),
    template: z.string().min(1),
  })
  .passthrough();

const planDesignDocReferencesEnvelopeSchema = z
  .object({
    data: z.array(planDesignDocReferenceSchema),
  })
  .passthrough();

const designDocSectionSchema = z.object({
  key: z.string().min(1),
  order: z.number().int(),
  materializedMarkdown: z.string(),
});

const designDocEnvelopeSchema = z
  .object({
    data: z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1),
        sections: z.array(designDocSectionSchema).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export interface PlanDesignDoc {
  id: string;
  title: string;
  sections: Record<string, string>;
}

export interface LoadPlanDesignDocDependencies {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  logger: ServerLogger;
}

export interface LoadPlanDesignDocInput {
  organizationId: string;
  projectId: string;
  /** Canonical PLAN work-item task ID. */
  taskId: string;
  accessToken: string;
}

const encode = (value: string): string => encodeURIComponent(value);

const compactSections = (
  sections: readonly z.infer<typeof designDocSectionSchema>[],
): Record<string, string> => {
  const compacted: Record<string, string> = {};
  const orderedSections = [...sections].sort(
    (left, right) => left.order - right.order || left.key.localeCompare(right.key),
  );
  for (const section of orderedSections) {
    const value = section.materializedMarkdown.trim();
    if (value) compacted[section.key] = value;
  }
  return compacted;
};

const read = async <T>(
  dependencies: LoadPlanDesignDocDependencies,
  url: string,
  action: string,
  schema: z.ZodType<T>,
  accessToken: string,
): Promise<T> => {
  dependencies.logger.debug('plan_design_doc.read_started', { action, url });
  const response = await dependencies.fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const responseText = await response.text();
  if (!response.ok) {
    dependencies.logger.warn('plan_design_doc.read_http_failed', {
      action,
      url,
      status: response.status,
    });
    throw new Error(`${action} failed (${String(response.status)}): ${responseText.slice(0, 500)}`);
  }
  let parsed: ReturnType<typeof schema.safeParse>;
  try {
    parsed = schema.safeParse(JSON.parse(responseText));
  } catch {
    dependencies.logger.warn('plan_design_doc.read_json_failed', { action, url });
    throw new Error(`${action} returned malformed JSON.`);
  }
  if (!parsed.success) {
    const issues = parsed.error.issues.map(({ code, path }) => `${path.join('.')} ${code}`);
    dependencies.logger.warn('plan_design_doc.read_validation_failed', { action, url, issues });
    throw new Error(`${action} failed boundary validation: ${issues.join('; ')}`);
  }
  dependencies.logger.debug('plan_design_doc.read_completed', { action, url });
  return parsed.data;
};

export const loadPlanDesignDoc = async (
  dependencies: LoadPlanDesignDocDependencies,
  input: LoadPlanDesignDocInput,
): Promise<PlanDesignDoc | null> => {
  const baseUrl = dependencies.apiBaseUrl.replace(/\/$/u, '');
  const designDocsUrl = new URL(
    `${baseUrl}/organizations/${encode(input.organizationId)}/design-docs`,
  );
  designDocsUrl.searchParams.set('projectId', input.projectId);
  designDocsUrl.searchParams.set('taskId', input.taskId);

  const designDocs = await read(
    dependencies,
    designDocsUrl.toString(),
    'Plan design document list read',
    planDesignDocReferencesEnvelopeSchema,
    input.accessToken,
  );
  const designDocId = designDocs.data.find(({ template }) => template === 'PLAN_DOCUMENT')?.id;
  if (!designDocId) {
    dependencies.logger.debug('plan_design_doc.reference_missing', {
      taskId: input.taskId,
      designDocCount: designDocs.data.length,
    });
    return null;
  }

  const designDoc = await read(
    dependencies,
    `${baseUrl}/organizations/${encode(input.organizationId)}/design-docs/${encode(designDocId)}`,
    'Plan design document read',
    designDocEnvelopeSchema,
    input.accessToken,
  );
  if (designDoc.data.id !== designDocId) {
    dependencies.logger.warn('plan_design_doc.identity_mismatch', {
      taskId: input.taskId,
      requestedDesignDocId: designDocId,
      returnedDesignDocId: designDoc.data.id,
    });
    throw new Error('Plan design document read returned a different design document.');
  }
  const sections = compactSections(designDoc.data.sections ?? []);
  if (Object.keys(sections).length === 0) {
    dependencies.logger.debug('plan_design_doc.sections_empty', {
      taskId: input.taskId,
      designDocId,
    });
    return null;
  }

  dependencies.logger.debug('plan_design_doc.resolved', {
    taskId: input.taskId,
    designDocId,
    sectionCount: Object.keys(sections).length,
  });
  return { id: designDoc.data.id, title: designDoc.data.name, sections };
};
