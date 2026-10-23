import type {
  AgentSessionEntryDto,
  ContextRelatedEntityDto,
  EntityPromptTemplateSyntaxVersion,
  FeatureHierarchyEntryDto,
  FullEntityContextDto,
  Influence,
  MaterializedDesignDocSection,
  MaterializedWorkItemSection,
  ProposalApprovalDto,
  ProposalEdgeDeclaration,
  ProposalResponseDto,
  RelatedEntityViaDto,
} from '../shared/api/generated/api';
import {
  ENTITY_PROMPT_TEMPLATE_LANGUAGES,
  type EntityPromptTemplateLanguage,
} from '../shared/api/generated/entity-prompt-template-language';
import type { CurrentEntityDto } from '../agents/entity-context/types';

/** Values which the entity prompt-template validator permits in a substitution. */
export type EntityPromptTemplateValue = string | number | boolean;

export interface EntityPromptTemplateRenderInput {
  entity: CurrentEntityDto;
  context: FullEntityContextDto;
}

export class EntityPromptTemplateRenderError extends Error {
  public constructor(
    message: string,
    public readonly boundary: 'syntax' | 'unsupported_path' | 'missing_path' | 'value',
  ) {
    super(message);
    this.name = 'EntityPromptTemplateRenderError';
  }
}

const pathPattern = /^[a-z][A-Za-z0-9_]*(?:\.[a-z][A-Za-z0-9_]*)*$/u;

const structuredTemplatePaths = new Set([
  'entity.sections',
  'context.relatedEntities',
  'context.featureHierarchy',
  'context.proposals',
  'context.agentSessions',
]);

const STRUCTURED_COLLECTION_BYTE_LIMIT = 32 * 1024;
const STRUCTURED_SUBSTITUTION_AGGREGATE_BYTE_LIMIT = 128 * 1024;
const AGENT_SESSION_LIMIT = 5;
const RELATED_ENTITY_VIA_LIMIT = 5;

const compareStrings = (
  left: string | null | undefined,
  right: string | null | undefined,
): number => {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  return left < right ? -1 : 1;
};

const compareNumbers = (
  left: number | null | undefined,
  right: number | null | undefined,
): number => {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  return left < right ? -1 : 1;
};

const compareDescendingStrings = (
  left: string | null | undefined,
  right: string | null | undefined,
): number => compareStrings(right, left);

const serializeJsonCollection = (collection: readonly object[]): string =>
  JSON.stringify(collection, null, 2);

const serializeWholeEntriesWithinBudget = (
  collection: readonly object[],
  byteLimit: number,
): string => {
  let low = 0;
  let high = collection.length;
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2);
    if (
      Buffer.byteLength(serializeJsonCollection(collection.slice(0, candidate)), 'utf8') <=
      byteLimit
    ) {
      low = candidate;
    } else {
      high = candidate - 1;
    }
  }
  return serializeJsonCollection(collection.slice(0, low));
};

type JsonLike =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly JsonLike[]
  | { readonly [key: string]: JsonLike };

const canonicalizeJsonValue = (value: JsonLike): JsonLike => {
  if (Array.isArray(value)) return value.map(canonicalizeJsonValue);
  if (value !== null && typeof value === 'object') {
    const record = value as { readonly [key: string]: JsonLike };
    return Object.fromEntries(
      Object.keys(record)
        .sort(compareStrings)
        .map((key) => [key, canonicalizeJsonValue(record[key])]),
    );
  }
  return value;
};

const canonicalizeProposalUpdates = (updates: ProposalResponseDto['updates']): JsonLike =>
  canonicalizeJsonValue(updates as object as { readonly [key: string]: JsonLike });

type MaterializedEntitySection = MaterializedDesignDocSection | MaterializedWorkItemSection;

const projectEntitySections = (entity: CurrentEntityDto): object[] | null => {
  if (!('sections' in entity) || !Array.isArray(entity.sections)) return null;

  const sections = (entity.sections as readonly MaterializedEntitySection[])
    .map((section) => ({
      id: section.id,
      key: section.key,
      order: section.order,
      materializedMarkdown: section.materializedMarkdown,
      ...(section.crdtSnapshotSeq === undefined
        ? {}
        : { crdtSnapshotSeq: section.crdtSnapshotSeq }),
    }))
    .sort(
      (left, right) =>
        compareNumbers(left.order, right.order) ||
        compareStrings(left.key, right.key) ||
        compareStrings(left.id, right.id),
    );

  return sections;
};

const projectRelatedEntityVia = (via: RelatedEntityViaDto) => ({
  entityId: via.entityId,
  entityType: via.entityType,
  displayName: via.displayName,
  relationship: via.relationship,
});

const relatedEntityPriority = (entry: ContextRelatedEntityDto): number => {
  if ((entry.via?.length ?? 0) > 0 || entry.relationship === 'sibling-via-parent') return 2;
  if (entry.relationship === 'parent') return 1;
  return 0;
};

const projectRelatedEntities = (context: FullEntityContextDto): object[] | null => {
  if (!Array.isArray(context.relatedEntities)) return null;

  const relatedEntities = [...context.relatedEntities]
    .sort(
      (left, right) =>
        relatedEntityPriority(left) - relatedEntityPriority(right) ||
        compareStrings(left.entityType, right.entityType) ||
        compareStrings(left.entityId, right.entityId) ||
        compareStrings(left.relationship, right.relationship) ||
        compareStrings(left.displayName, right.displayName),
    )
    .map((entry: ContextRelatedEntityDto) => ({
      entityId: entry.entityId,
      entityType: entry.entityType,
      displayName: entry.displayName,
      relationship: entry.relationship,
      ...(entry.status === undefined ? {} : { status: entry.status }),
      ...(entry.taskType === undefined ? {} : { taskType: entry.taskType }),
      ...(entry.source === undefined ? {} : { source: entry.source }),
      ...(entry.reasoning === undefined ? {} : { reasoning: entry.reasoning }),
      ...(entry.via === undefined
        ? {}
        : {
            via: entry.via
              .map(projectRelatedEntityVia)
              .sort(
                (left, right) =>
                  compareStrings(left.entityType, right.entityType) ||
                  compareStrings(left.entityId, right.entityId) ||
                  compareStrings(left.relationship, right.relationship) ||
                  compareStrings(left.displayName, right.displayName),
              )
              .slice(0, RELATED_ENTITY_VIA_LIMIT),
          }),
    }));

  return relatedEntities;
};

const projectFeatureHierarchy = (context: FullEntityContextDto): object[] | null => {
  if (!Array.isArray(context.featureHierarchy)) return null;

  const featureHierarchy = context.featureHierarchy
    .map((entry: FeatureHierarchyEntryDto) => ({
      id: entry.id,
      name: entry.name,
      relationshipType: entry.relationshipType,
      ...(entry.tag === undefined ? {} : { tag: entry.tag }),
      ...(entry.description === undefined ? {} : { description: entry.description }),
      ...(entry.descriptionFullLength === undefined
        ? {}
        : { descriptionFullLength: entry.descriptionFullLength }),
      ...(entry.source === undefined ? {} : { source: entry.source }),
      ...(entry.relationship === undefined ? {} : { relationship: entry.relationship }),
      ...(entry.distance === undefined ? {} : { distance: entry.distance }),
      ...(entry.direction === undefined ? {} : { direction: entry.direction }),
      ...(entry.parentTaskId === undefined ? {} : { parentTaskId: entry.parentTaskId }),
      ...(entry.reasoning === undefined ? {} : { reasoning: entry.reasoning }),
    }))
    .sort(
      (left, right) =>
        compareStrings(left.relationshipType, right.relationshipType) ||
        compareNumbers(left.distance, right.distance) ||
        compareStrings(left.relationship, right.relationship) ||
        compareStrings(left.direction, right.direction) ||
        compareStrings(left.id, right.id) ||
        compareStrings(left.name, right.name),
    );

  return featureHierarchy;
};

const projectInfluence = (influence: Influence) => ({
  entityId: influence.entityId,
  entityType: influence.entityType,
  ...(influence.entityTitle === undefined ? {} : { entityTitle: influence.entityTitle }),
  ...(influence.taskType === undefined ? {} : { taskType: influence.taskType }),
  reasoning: influence.reasoning,
  reasonType: influence.reasonType,
  ...(influence.confidence === undefined ? {} : { confidence: influence.confidence }),
});

const projectProposalEdge = (edge: ProposalEdgeDeclaration) => ({
  targetEntityId: edge.targetEntityId,
  targetEntityType: edge.targetEntityType,
  ...(edge.targetEntityTitle === undefined ? {} : { targetEntityTitle: edge.targetEntityTitle }),
  edgeType: edge.edgeType,
  ...(edge.description === undefined ? {} : { description: edge.description }),
});

const projectProposalApproval = (approval: ProposalApprovalDto) => ({
  userId: approval.userId,
  type: approval.type,
  ...(approval.reason === undefined ? {} : { reason: approval.reason }),
  createdAt: approval.createdAt,
});

const projectProposalMaterialization = (
  materialization: NonNullable<ProposalResponseDto['materialization']>,
) => ({
  state: materialization.state,
  attemptCount: materialization.attemptCount,
  ...(materialization.lastError === undefined ? {} : { lastError: materialization.lastError }),
  ...(materialization.lastAttemptedAt === undefined
    ? {}
    : { lastAttemptedAt: materialization.lastAttemptedAt }),
  ...(materialization.publishedAt === undefined
    ? {}
    : { publishedAt: materialization.publishedAt }),
  ...(materialization.fencesReleasedAt === undefined
    ? {}
    : { fencesReleasedAt: materialization.fencesReleasedAt }),
  operations: materialization.operations
    .map((operation) => ({
      operationIndex: operation.operationIndex,
      operationKind: operation.operationKind,
      status: operation.status,
      attemptCount: operation.attemptCount,
      ...(operation.lastError === undefined ? {} : { lastError: operation.lastError }),
      ...(operation.lastAttemptedAt === undefined
        ? {}
        : { lastAttemptedAt: operation.lastAttemptedAt }),
      ...(operation.completedAt === undefined ? {} : { completedAt: operation.completedAt }),
    }))
    .sort(
      (left, right) =>
        compareNumbers(left.operationIndex, right.operationIndex) ||
        compareStrings(left.operationKind, right.operationKind),
    ),
});

const projectProposal = (proposal: NonNullable<FullEntityContextDto['proposals']>[number]) => ({
  id: proposal.id,
  organizationId: proposal.organizationId,
  projectId: proposal.projectId,
  ...(proposal.groupMembership === undefined
    ? {}
    : {
        groupMembership: {
          groupId: proposal.groupMembership.groupId,
          memberId: proposal.groupMembership.memberId,
          memberOrder: proposal.groupMembership.memberOrder,
          revision: proposal.groupMembership.revision,
          lifecycle: proposal.groupMembership.lifecycle,
        },
      }),
  type: proposal.type,
  action: proposal.action,
  status: proposal.status,
  targetEntityId: proposal.targetEntityId,
  targetEntityType: proposal.targetEntityType,
  ...(proposal.title === undefined ? {} : { title: proposal.title }),
  ...(proposal.eli5 !== undefined
    ? { eli5: proposal.eli5 }
    : {}),
  ...('updates' in proposal
    ? { updates: canonicalizeProposalUpdates(proposal.updates) }
    : {
        changes: proposal.changes
          .map((change) => ({
            path: change.path,
            type: change.type,
            ...(change.diff === undefined ? {} : { diff: change.diff }),
            ...(change.diffTruncated === undefined ? {} : { diffTruncated: change.diffTruncated }),
            ...(change.diffOmittedCharacters === undefined
              ? {}
              : { diffOmittedCharacters: change.diffOmittedCharacters }),
            ...(change.unavailableReason === undefined
              ? {}
              : { unavailableReason: change.unavailableReason }),
            ...(change.searchedProposalCount === undefined
              ? {}
              : { searchedProposalCount: change.searchedProposalCount }),
            ...(change.proposedPreview === undefined
              ? {}
              : { proposedPreview: change.proposedPreview }),
            ...(change.proposedLength === undefined
              ? {}
              : { proposedLength: change.proposedLength }),
            ...(change.proposedPreviewTruncated === undefined
              ? {}
              : { proposedPreviewTruncated: change.proposedPreviewTruncated }),
          }))
          .sort((left, right) => compareStrings(left.path, right.path)),
      }),
  requestorId: proposal.requestorId,
  requiredApprovals: proposal.requiredApprovals,
  ...(proposal.influences === undefined
    ? {}
    : {
        influences: proposal.influences
          .map(projectInfluence)
          .sort(
            (left, right) =>
              compareStrings(left.entityType, right.entityType) ||
              compareStrings(left.entityId, right.entityId) ||
              compareStrings(left.reasonType, right.reasonType),
          ),
      }),
  ...(proposal.generatedWithVersion === undefined
    ? {}
    : { generatedWithVersion: proposal.generatedWithVersion }),
  ...(proposal.validationSessionId === undefined
    ? {}
    : { validationSessionId: proposal.validationSessionId }),
  ...(proposal.conversationId === undefined ? {} : { conversationId: proposal.conversationId }),
  ...(proposal.messageId === undefined ? {} : { messageId: proposal.messageId }),
  ...(proposal.edges === undefined
    ? {}
    : {
        edges: proposal.edges
          .map(projectProposalEdge)
          .sort(
            (left, right) =>
              compareStrings(left.targetEntityType, right.targetEntityType) ||
              compareStrings(left.targetEntityId, right.targetEntityId) ||
              compareStrings(left.edgeType, right.edgeType),
          ),
      }),
  approvals: proposal.approvals
    .map(projectProposalApproval)
    .sort(
      (left, right) =>
        compareStrings(left.createdAt, right.createdAt) ||
        compareStrings(left.userId, right.userId) ||
        compareStrings(left.type, right.type),
    ),
  ...(proposal.materialization === undefined
    ? {}
    : { materialization: projectProposalMaterialization(proposal.materialization) }),
  createdAt: proposal.createdAt,
  updatedAt: proposal.updatedAt,
});

const projectProposals = (context: FullEntityContextDto): object[] | null => {
  if (!Array.isArray(context.proposals)) return null;

  const proposals = context.proposals
    .map(projectProposal)
    .sort(
      (left, right) =>
        compareDescendingStrings(left.createdAt, right.createdAt) ||
        compareStrings(left.id, right.id),
    );

  return proposals;
};

const projectAgentSessions = (context: FullEntityContextDto): object[] | null => {
  if (!Array.isArray(context.agentSessions)) return null;

  const agentSessions = context.agentSessions
    .map((entry: AgentSessionEntryDto) => ({
      entityId: entry.entityId,
      entityType: entry.entityType,
      displayName: entry.displayName,
      ...(entry.status === undefined ? {} : { status: entry.status }),
    }))
    .slice(0, AGENT_SESSION_LIMIT);

  return agentSessions;
};

/**
 * Structured identifiers use one deterministic JSON formatter. Arrays are
 * sorted by these keys: entity sections use order, key, id; related entities
 * and their via pivots use entityType, entityId, relationship, displayName;
 * feature hierarchy uses relationshipType, distance, relationship, direction,
 * id, name; proposals use createdAt descending then id; proposal child arrays
 * use their identity or position fields; agent sessions use entityType,
 * entityId, displayName, status. Object fields are emitted in the explicit
 * projection order below, except proposal updates, whose object keys are
 * recursively sorted while array order is preserved. Undefined optional
 * fields are omitted, while explicit null values are preserved. An absent
 * collection is missing and therefore fails closed; a present empty
 * collection renders as [].
 * Proposal requestorContext is intentionally omitted because it is free-form
 * request metadata rather than durable entity context.
 */
const projectStructuredCollection = (
  path: string,
  input: EntityPromptTemplateRenderInput,
): object[] | null => {
  switch (path) {
    case 'entity.sections':
      return projectEntitySections(input.entity);
    case 'context.relatedEntities':
      return projectRelatedEntities(input.context);
    case 'context.featureHierarchy':
      return projectFeatureHierarchy(input.context);
    case 'context.proposals':
      return projectProposals(input.context);
    case 'context.agentSessions':
      return projectAgentSessions(input.context);
    default:
      return null;
  }
};

const readEntitySection = (entity: CurrentEntityDto, key: string): string | null => {
  if (!('sections' in entity) || !Array.isArray(entity.sections)) return null;
  const section = entity.sections.find((candidate) => candidate.key === key);
  return section?.materializedMarkdown ?? null;
};

const readEntityPath = (
  entity: CurrentEntityDto,
  path: string,
): EntityPromptTemplateValue | null => {
  switch (path) {
    case 'entity.id':
      return entity.id;
    case 'entity.name':
      return 'name' in entity && typeof entity.name === 'string' ? entity.name : null;
    case 'entity.title':
      return 'title' in entity && typeof entity.title === 'string' ? entity.title : null;
    case 'entity.type':
      return 'type' in entity && typeof entity.type === 'string' ? entity.type : null;
    case 'entity.status':
      return 'status' in entity && typeof entity.status === 'string' ? entity.status : null;
    case 'entity.description':
      return 'description' in entity && typeof entity.description === 'string'
        ? entity.description
        : readEntitySection(entity, 'description');
    case 'entity.outcome':
      return 'outcome' in entity && typeof entity.outcome === 'string' ? entity.outcome : null;
    case 'entity.summary':
      return 'summary' in entity && typeof entity.summary === 'string' ? entity.summary : null;
    case 'entity.acceptanceCriteria':
      return readEntitySection(entity, 'acceptanceCriteria');
    default: {
      const sectionMatch = /^entity\.sections\.([a-z][A-Za-z0-9_]*)$/u.exec(path);
      return sectionMatch?.[1] ? readEntitySection(entity, sectionMatch[1]) : null;
    }
  }
};

const readContextPath = (
  context: FullEntityContextDto,
  path: string,
): EntityPromptTemplateValue | null => {
  switch (path) {
    case 'context.entityId':
      return context.entityId;
    case 'context.entityType':
      return context.entityType;
    case 'context.taskType':
      return context.taskType ?? null;
    case 'context.displayName':
      return context.displayName;
    case 'context.createdAt':
      return context.createdAt;
    case 'context.content.status':
      return context.content?.status ?? null;
    case 'context.content.priority':
      return context.content?.priority ?? null;
    case 'context.content.dueDate':
      return context.content?.dueDate ?? null;
    default: {
      const sectionMatch = /^context\.content\.sections\.([a-z][A-Za-z0-9_]*)$/u.exec(path);
      if (!sectionMatch?.[1]) return null;
      return context.content?.sections[sectionMatch[1]] ?? null;
    }
  }
};

const readPath = (
  path: string,
  input: EntityPromptTemplateRenderInput,
): EntityPromptTemplateValue | null => {
  if (path.startsWith('entity.')) return readEntityPath(input.entity, path);
  if (path.startsWith('context.')) return readContextPath(input.context, path);
  return null;
};

const languageFor = (
  syntaxVersion: EntityPromptTemplateSyntaxVersion,
): EntityPromptTemplateLanguage => {
  const languages: Readonly<Record<string, EntityPromptTemplateLanguage>> =
    ENTITY_PROMPT_TEMPLATE_LANGUAGES;
  const language = languages[syntaxVersion];
  if (!language) {
    throw new EntityPromptTemplateRenderError(
      `Entity prompt template syntax version "${syntaxVersion}" is not supported.`,
      'syntax',
    );
  }
  return language;
};

const isSupportedPath = (path: string, language: EntityPromptTemplateLanguage): boolean =>
  pathPattern.test(path) &&
  (language.supportedPaths.includes(path) ||
    language.pathFamilies.some((family) => new RegExp(family.pattern, 'u').test(path)));

const renderSubstitution = (
  path: string,
  input: EntityPromptTemplateRenderInput,
  language: EntityPromptTemplateLanguage,
  structuredBudget: { remaining: number },
): string => {
  if (!isSupportedPath(path, language)) {
    throw new EntityPromptTemplateRenderError(
      `Entity prompt template path "${path}" is not supported.`,
      'unsupported_path',
    );
  }

  if (structuredTemplatePaths.has(path)) {
    const collection = projectStructuredCollection(path, input);
    if (collection === null) {
      throw new EntityPromptTemplateRenderError(
        `Entity prompt template path "${path}" is missing from the loaded input.`,
        'missing_path',
      );
    }
    if (structuredBudget.remaining < Buffer.byteLength('[]', 'utf8')) {
      throw new EntityPromptTemplateRenderError(
        'Entity prompt template structured substitutions exceed the aggregate byte limit.',
        'value',
      );
    }
    const perCollectionLimit =
      path === 'context.proposals'
        ? structuredBudget.remaining
        : Math.min(STRUCTURED_COLLECTION_BYTE_LIMIT, structuredBudget.remaining);
    const rendered = serializeWholeEntriesWithinBudget(collection, perCollectionLimit);
    structuredBudget.remaining = Math.max(
      0,
      structuredBudget.remaining - Buffer.byteLength(rendered, 'utf8'),
    );
    return rendered;
  }

  const value = readPath(path, input);
  if (value === null) {
    throw new EntityPromptTemplateRenderError(
      `Entity prompt template path "${path}" is missing from the loaded input.`,
      'missing_path',
    );
  }

  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new EntityPromptTemplateRenderError(
      `Entity prompt template path "${path}" is not renderable.`,
      'value',
    );
  }

  // Use concatenation rather than String.replace's replacement-string form so
  // values containing `$&`, backslashes, or template markers remain data.
  return String(value);
};

/**
 * Render one validated entity prompt template without evaluating code or
 * recursively interpreting substituted values. A preceding backslash escapes
 * a literal `{{...}}` sequence.
 */
export const renderEntityPromptTemplate = (
  template: string,
  syntaxVersion: EntityPromptTemplateSyntaxVersion,
  input: EntityPromptTemplateRenderInput,
): string => {
  const language = languageFor(syntaxVersion);
  if (template.length === 0) {
    throw new EntityPromptTemplateRenderError(
      'Entity prompt template content must not be empty.',
      'syntax',
    );
  }

  const chunks: string[] = [];
  const structuredBudget = { remaining: STRUCTURED_SUBSTITUTION_AGGREGATE_BYTE_LIMIT };
  let cursor = 0;
  while (cursor < template.length) {
    const open = template.indexOf('{{', cursor);
    const closeWithoutOpen = template.indexOf('}}', cursor);
    if (open === -1) {
      if (closeWithoutOpen !== -1) {
        throw new EntityPromptTemplateRenderError(
          'Entity prompt template contains an unexpected closing delimiter.',
          'syntax',
        );
      }
      chunks.push(template.slice(cursor));
      break;
    }
    if (closeWithoutOpen !== -1 && closeWithoutOpen < open) {
      throw new EntityPromptTemplateRenderError(
        'Entity prompt template contains an unexpected closing delimiter.',
        'syntax',
      );
    }

    const escaped = open > 0 && template[open - 1] === '\\';
    chunks.push(template.slice(cursor, escaped ? open - 1 : open));
    const close = template.indexOf('}}', open + 2);
    if (close === -1) {
      throw new EntityPromptTemplateRenderError(
        'Entity prompt template contains an unterminated substitution.',
        'syntax',
      );
    }

    const expression = template.slice(open + 2, close).trim();
    if (!expression || expression.includes('{') || expression.includes('}')) {
      throw new EntityPromptTemplateRenderError(
        'Entity prompt template contains malformed substitution syntax.',
        'syntax',
      );
    }
    if (escaped) {
      if (!isSupportedPath(expression, language)) {
        throw new EntityPromptTemplateRenderError(
          `Entity prompt template path "${expression}" is not supported.`,
          'unsupported_path',
        );
      }
      chunks.push(`{{${expression}}}`);
    } else {
      chunks.push(renderSubstitution(expression, input, language, structuredBudget));
    }
    cursor = close + 2;
  }

  return chunks.join('');
};

/** Alias used by callers that describe the operation as projection. */
export const renderEntityPromptTemplateInput = renderEntityPromptTemplate;
