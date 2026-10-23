import { z } from 'zod';
import {
  Configuration,
  ConversationsApi,
  EntityContextApi,
  EntityType,
  ImplementationHintsApi,
  type ImplementationHintDto,
  type MessageRecordDto,
} from '../../shared/api/generated';
import type { EntitySource } from './entity-source';
import { createGraphReader, type LoadEntitySource } from './graph-reader';
import type { EntityRef, GraphReader } from './types';

const citationSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  entityTitle: z.string(),
});

/** The part of an entity's context the walk reads; the platform may add to the rest. */
const contextSchema = z
  .object({
    entityId: z.string().min(1),
    entityType: z.string().min(1),
    taskType: z.string().min(1).optional(),
    displayName: z.string(),
    relatedEntities: z
      .array(
        z
          .object({
            entityId: z.string().min(1),
            entityType: z.string().min(1),
            taskType: z.string().min(1).optional(),
            displayName: z.string(),
            relationship: z.string().min(1),
            reasoning: z.string().optional(),
          })
          .passthrough(),
      )
      .default([]),
    content: z
      .object({
        sections: z.record(z.string()),
        requirementsSection: z
          .object({
            records: z.array(
              z
                .object({
                  statement: z.string(),
                  fulfilledBy: z.array(citationSchema),
                  designedBy: z.array(citationSchema),
                  contracts: z.array(citationSchema),
                })
                .passthrough(),
            ),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

/**
 * Work items of every type, plans included, are Tasks to the platform. Every other entity is
 * loaded by its own type, named by the lowercase `EntityType` that search hits and citations carry.
 */
const ENTITY_TYPE_BY_KIND: Readonly<Record<string, EntityType>> = Object.fromEntries(
  Object.values(EntityType)
    .filter((type) => type !== EntityType.Task)
    .map((type) => [type.toLowerCase(), type]),
);

const entityTypeOf = (kind: string): EntityType => ENTITY_TYPE_BY_KIND[kind] ?? EntityType.Task;

/** How the walk names an entity's kind: a work item by its type, anything else by its entity type. */
const kindOf = ({ entityType, taskType }: { entityType: string; taskType?: string | undefined }) =>
  (taskType ?? entityType).toLowerCase();

const citationOf = ({ entityType, entityId, entityTitle }: z.infer<typeof citationSchema>) => ({
  id: entityId,
  kind: kindOf({ entityType }),
  title: entityTitle,
});

/** An entity's canonical context (`get_context`) as the walk's source for it. */
export const sourceFromContext = (context: unknown): EntitySource => {
  const parsed = contextSchema.parse(context);
  const { sections, requirementsSection } = parsed.content;
  const requirements = (requirementsSection?.records ?? []).map((record) => ({
    statement: record.statement,
    fulfilledBy: record.fulfilledBy.map(citationOf),
    designedBy: record.designedBy.map(citationOf),
    contracts: record.contracts.map(citationOf),
  }));
  const body = Object.entries(sections)
    .filter(([, markdown]) => markdown.trim() !== '')
    .map(([key, markdown]) => `### ${key}\n\n${markdown.trim()}`);
  if (!('requirements' in sections) && requirements.length > 0) {
    body.push(
      `### requirements\n\n${requirements.map(({ statement }) => `- ${statement}`).join('\n')}`,
    );
  }
  return {
    id: parsed.entityId,
    kind: kindOf(parsed),
    title: parsed.displayName,
    text: [`# ${parsed.displayName}`, ...body].join('\n\n'),
    edges: parsed.relatedEntities.map((related) => ({
      id: related.entityId,
      kind: kindOf(related),
      title: related.displayName,
      relationship: related.relationship,
      ...(related.reasoning ? { reasoning: related.reasoning } : {}),
    })),
    requirements,
  };
};

export interface LiveReaderDeps {
  auth: { getAccessToken(): Promise<string> };
  apiBaseUrl: string;
  organizationId: string;
  projectId: string;
}

/** A message has no context of its own: its text is what the sender wrote, and it links to nothing. */
export const sourceFromMessage = (message: MessageRecordDto): EntitySource => {
  const text =
    message.type === 'USER'
      ? (message.data.comment ?? '')
      : [message.data.title, message.data.response].filter((part) => part).join('\n\n');
  const firstLine = text.split('\n')[0]?.slice(0, 80);
  const title =
    (message.type === 'SYSTEM' ? message.data.title : undefined) ??
    (firstLine === undefined || firstLine === '' ? 'Message' : firstLine);
  return {
    id: message.id,
    kind: 'message',
    title,
    text: `# ${title}\n\n${text}`.trimEnd(),
    edges: [],
    requirements: [],
  };
};

/** A hint is read as its feature, description and hint text; it links to nothing. */
export const sourceFromHint = (hint: ImplementationHintDto): EntitySource => ({
  id: hint.id,
  kind: 'implementation_hint',
  title: hint.featureName,
  text: [`# ${hint.featureName}`, hint.description, hint.hint]
    .filter((part) => part !== undefined && part !== '')
    .join('\n\n'),
  edges: [],
  requirements: [],
});

/**
 * Loads one entity's source from the live project graph: one platform read each. Messages and
 * implementation hints have their own reads; every other entity is read through its context.
 */
export const createLiveSourceLoader =
  (deps: LiveReaderDeps): LoadEntitySource =>
  async (ref) => {
    const accessToken = await deps.auth.getAccessToken();
    const configuration = new Configuration({ accessToken, basePath: deps.apiBaseUrl });
    if (ref.kind === 'message') {
      const response = await new ConversationsApi(configuration).getMessage({
        id: ref.id,
        projectId: deps.projectId,
        organizationId: deps.organizationId,
      });
      return sourceFromMessage(requiredData(response.data.data, ref));
    }
    if (ref.kind === 'implementation_hint') {
      const response = await new ImplementationHintsApi(configuration).getImplementationHint({
        organizationId: deps.organizationId,
        hintId: ref.id,
      });
      return sourceFromHint(requiredData(response.data.data, ref));
    }
    const response = await new EntityContextApi(configuration).getEntityContext({
      organizationId: deps.organizationId,
      projectId: deps.projectId,
      entityType: entityTypeOf(ref.kind),
      entityId: ref.id,
      includeRelatedEntities: true,
      includeFeatureHierarchy: false,
      includePlan: false,
      includeProposals: false,
      includeAvailableMcpTools: false,
    });
    return sourceFromContext(response.data.data);
  };

const requiredData = <T>(data: T | undefined, ref: EntityRef): T => {
  if (data === undefined) throw new Error(`The platform returned no ${ref.kind} ${ref.id}.`);
  return data;
};

/** A reader over the live project graph. */
export const createLiveReader = (
  focal: EntityRef,
  deps: LiveReaderDeps,
  known: readonly EntityRef[] = [],
): GraphReader => createGraphReader(focal, createLiveSourceLoader(deps), known);
