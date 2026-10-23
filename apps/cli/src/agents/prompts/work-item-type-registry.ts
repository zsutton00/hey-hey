import { z } from 'zod';

import { extractOrganizationIdFromToken } from '../../auth/index';
import {
  AgentEdgeCategory,
  AgentEdgeDirection,
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  Configuration,
  DiagramElementRoleDefinitionNotationEnum,
  DiagramReferenceTargetRuleEntityTypeEnum,
  EntityType,
  ReportType,
  WorkItemIconKey,
  WorkItemColorKey,
  WorkItemTypeEffectiveSource,
  WorkItemTypeGraphAction,
  WorkItemTypeGraphEndpointRole,
  WorkItemTypeGraphReadExpansionDeduplicateByEnum,
  WorkItemTypeGraphReadExpansionHopDirectionEnum,
  WorkItemTypeGraphReadExpansionHopRelationshipTypeEnum,
  WorkItemTypeGraphReadExpansionProjectionKindEnum,
  WorkItemTypeGraphReadExpansionSeedEnum,
  WorkItemTypeLifecycleStatus,
  WorkItemTypeRole,
  WorkItemTypeScalarField,
  WorkItemTypeSectionDefinitionKindEnum,
  WorkItemTypesApi,
  WorkStatus,
  WorkItemConfigKind,
} from '../../shared/api/index';
import type {
  WorkItemTypeAgentGuidance,
  WorkItemTypeGuidanceContext,
  WorkItemTypeGuidanceExample,
  WorkItemTypeCapabilities,
  DiagramElementPolicy,
  DiagramElementRoleDefinition,
  DiagramReferenceTargetRule,
  WorkItemTypeDefinitionDto,
  WorkItemTypeEdgeTarget,
  WorkItemTypeGraphCapability,
  WorkItemTypeGraphDirectionRule,
  WorkItemTypeGraphEndpointRule,
  WorkItemTypeGraphLayoutDeclaration,
  WorkItemTypeGraphLayoutPreferenceDeclaration,
  WorkItemTypeGraphReadExpansion,
  WorkItemTypeGraphReadExpansionEndpoint,
  WorkItemTypeGraphReadExpansionHop,
  WorkItemTypeGraphRelationshipDeclaration,
  WorkItemTypeGraphSearchableMetaLinkTarget,
  WorkItemTypeSectionDefinition,
  WorkItemTypeSummaryDto,
  WorkItemTypeTracking,
  WorkItemTypeWritingStandards,
} from '../../shared/api/index';

type ContractValue<T extends object, K extends keyof T> =
  T extends Required<Pick<T, K>> ? T[K] : T[K] | undefined;

// Zod 3 includes `undefined` in optional object inputs while
// `exactOptionalPropertyTypes` keeps generated DTO outputs omission-based.
// Preserve those input semantics without weakening the generated output type.
type ZodInputFor<T> = T extends readonly (infer Item)[]
  ? ZodInputFor<Item>[]
  : T extends object
    ? { [K in keyof T]?: ZodInputFor<T[K]> | undefined }
    : T;

type ZodShapeFor<T extends object> = {
  [K in keyof T]-?: z.ZodType<ContractValue<T, K>, z.ZodTypeDef, ZodInputFor<ContractValue<T, K>>>;
};

/**
 * Resolves the API base URL the same way the rotate command does: the bare
 * origin from `HEYHEY_API_URL` (default production) with the `/api/v1` suffix
 * the generated client paths are written against.
 */
const resolveApiBaseUrl = (): string => {
  const configured = process.env['HEYHEY_API_URL']?.trim();
  const raw = configured && configured.length > 0 ? configured : 'https://heyhey.dev';
  return raw.endsWith('/api/v1') ? raw : `${raw.replace(/\/$/u, '')}/api/v1`;
};

const htmlCssDimensionsShape = {
  width: z.number().int().min(1),
  height: z.number().int().min(1),
};
const htmlCssDimensionsSchema = z.object(htmlCssDimensionsShape).strict();

const htmlCssSizeBreakpointShape = {
  minContainerWidth: z.number().int().min(0),
  inline: htmlCssDimensionsSchema,
  page: htmlCssDimensionsSchema,
};
const htmlCssSizeBreakpointSchema = z.object(htmlCssSizeBreakpointShape).strict();

const htmlCssSizeProfileShape = {
  key: z.string().min(1),
  label: z.string().min(1),
  breakpoints: z.array(htmlCssSizeBreakpointSchema).min(1),
};
const htmlCssSizeProfileSchema = z.object(htmlCssSizeProfileShape).strict();

const diagramElementRoleDefinitionShape = {
  key: z.string(),
  label: z.string().min(1),
  notation: z.nativeEnum(DiagramElementRoleDefinitionNotationEnum),
} satisfies ZodShapeFor<DiagramElementRoleDefinition>;
const diagramElementRoleDefinitionSchema = z.object(diagramElementRoleDefinitionShape).strict();

const diagramReferenceTargetRuleShape = {
  entityType: z.nativeEnum(DiagramReferenceTargetRuleEntityTypeEnum),
  workItemTypeKeys: z.array(z.string()).optional(),
} satisfies ZodShapeFor<DiagramReferenceTargetRule>;
const diagramReferenceTargetRuleSchema = z
  .object(diagramReferenceTargetRuleShape)
  .strict()
  .transform(
    (value): DiagramReferenceTargetRule => ({
      entityType: value.entityType,
      ...(value.workItemTypeKeys !== undefined ? { workItemTypeKeys: value.workItemTypeKeys } : {}),
    }),
  );

const diagramElementPolicyShape = {
  roles: z.array(diagramElementRoleDefinitionSchema).min(1),
  referenceTargets: z.array(diagramReferenceTargetRuleSchema),
} satisfies ZodShapeFor<DiagramElementPolicy>;
const diagramElementPolicySchema = z.object(diagramElementPolicyShape).strict();

/** One content section of a work-item type, with its per-section writing standard. */
const sectionShape = {
  key: z.string(),
  label: z.string(),
  writingStandard: z.string().nullable().optional(),
  kind: z.nativeEnum(WorkItemTypeSectionDefinitionKindEnum).optional(),
  schemaRef: z.string().nullable().optional(),
  required: z.boolean().optional(),
  sizeProfiles: z.array(htmlCssSizeProfileSchema).min(1).optional(),
  defaultSizeKey: z.string().min(1).optional(),
  // Validate registry-only Diagram policy without projecting it into startup prompt content.
  diagramElementPolicy: diagramElementPolicySchema.optional(),
} satisfies ZodShapeFor<WorkItemTypeSectionDefinition>;
const sectionSchema = z
  .object(sectionShape)
  .strict()
  .transform(
    (value): WorkItemTypeSectionDefinition => ({
      key: value.key,
      label: value.label,
      ...(value.writingStandard !== undefined ? { writingStandard: value.writingStandard } : {}),
      ...(value.kind !== undefined ? { kind: value.kind } : {}),
      ...(value.schemaRef !== undefined ? { schemaRef: value.schemaRef } : {}),
      ...(value.required !== undefined ? { required: value.required } : {}),
    }),
  );

/** A typed edge an item of this type may originate, and the type keys it may target. */
const edgeTargetShape = {
  edgeType: z.nativeEnum(AgentEdgeType),
  targetTypeKeys: z.array(z.string()),
} satisfies ZodShapeFor<WorkItemTypeEdgeTarget>;
const edgeTargetSchema = z.object(edgeTargetShape).strict();

/** Type-level authoring prose, split by create / edit authoring mode. */
const writingStandardsShape = {
  create: z.string(),
  edit: z.string(),
} satisfies ZodShapeFor<WorkItemTypeWritingStandards>;
const writingStandardsSchema = z.object(writingStandardsShape).strict();

/** Inbound TRACKS authorization owned by the target work-item type. */
const trackingShape = {
  allowedSourceEntityTypes: z.array(z.nativeEnum(EntityType)),
  allowedSourceTaskTypes: z.array(z.string()),
} satisfies ZodShapeFor<WorkItemTypeTracking>;
const trackingSchema = z.object(trackingShape).strict();

const graphLayoutShape = {
  sectionKey: z.string(),
  schemaRef: z.string(),
} satisfies ZodShapeFor<WorkItemTypeGraphLayoutDeclaration>;
const graphLayoutSchema = z.object(graphLayoutShape).strict();

const graphLayoutPreferenceShape = {
  sectionKey: z.string(),
  schemaRef: z.string(),
} satisfies ZodShapeFor<WorkItemTypeGraphLayoutPreferenceDeclaration>;
const graphLayoutPreferenceSchema = z.object(graphLayoutPreferenceShape).strict();

const graphEndpointShape = {
  role: z.nativeEnum(WorkItemTypeGraphEndpointRole),
  entityTypes: z.array(z.nativeEnum(AgentEdgeEndpointEntityType)),
  workItemTypeKeys: z.array(z.string()).optional(),
} satisfies ZodShapeFor<WorkItemTypeGraphEndpointRule>;
const graphEndpointSchema = z
  .object(graphEndpointShape)
  .strict()
  .transform(
    (value): WorkItemTypeGraphEndpointRule => ({
      role: value.role,
      entityTypes: value.entityTypes,
      ...(value.workItemTypeKeys !== undefined ? { workItemTypeKeys: value.workItemTypeKeys } : {}),
    }),
  );

const graphDirectionShape = {
  required: z.boolean().optional(),
  allowedDirections: z.array(z.nativeEnum(AgentEdgeDirection)).optional(),
  predicateRequired: z.boolean().optional(),
} satisfies ZodShapeFor<WorkItemTypeGraphDirectionRule>;
const graphDirectionSchema = z
  .object(graphDirectionShape)
  .strict()
  .transform(
    (value): WorkItemTypeGraphDirectionRule => ({
      ...(value.required !== undefined ? { required: value.required } : {}),
      ...(value.allowedDirections !== undefined
        ? { allowedDirections: value.allowedDirections }
        : {}),
      ...(value.predicateRequired !== undefined
        ? { predicateRequired: value.predicateRequired }
        : {}),
    }),
  );

const graphRelationshipShape = {
  edgeType: z.nativeEnum(AgentEdgeType),
  category: z.nativeEnum(AgentEdgeCategory),
  sourceEndpoint: graphEndpointSchema,
  targetEndpoint: graphEndpointSchema,
  direction: graphDirectionSchema.optional(),
  metadataSchemaRef: z.string().nullable().optional(),
} satisfies ZodShapeFor<WorkItemTypeGraphRelationshipDeclaration>;
const graphRelationshipSchema = z
  .object(graphRelationshipShape)
  .strict()
  .transform(
    (value): WorkItemTypeGraphRelationshipDeclaration => ({
      edgeType: value.edgeType,
      category: value.category,
      sourceEndpoint: value.sourceEndpoint,
      targetEndpoint: value.targetEndpoint,
      ...(value.direction !== undefined ? { direction: value.direction } : {}),
      ...(value.metadataSchemaRef !== undefined
        ? { metadataSchemaRef: value.metadataSchemaRef }
        : {}),
    }),
  );

const graphReadExpansionEndpointShape = {
  entityTypes: z.array(z.nativeEnum(AgentEdgeEndpointEntityType)).min(1),
  workItemTypeKeys: z.array(z.string()).optional(),
} satisfies ZodShapeFor<WorkItemTypeGraphReadExpansionEndpoint>;
const graphReadExpansionEndpointSchema = z
  .object(graphReadExpansionEndpointShape)
  .strict()
  .transform(
    (value): WorkItemTypeGraphReadExpansionEndpoint => ({
      entityTypes: value.entityTypes,
      ...(value.workItemTypeKeys !== undefined ? { workItemTypeKeys: value.workItemTypeKeys } : {}),
    }),
  );

const graphReadExpansionHopShape = {
  relationshipType: z.nativeEnum(WorkItemTypeGraphReadExpansionHopRelationshipTypeEnum),
  direction: z.nativeEnum(WorkItemTypeGraphReadExpansionHopDirectionEnum),
  target: graphReadExpansionEndpointSchema,
} satisfies ZodShapeFor<WorkItemTypeGraphReadExpansionHop>;
const graphReadExpansionHopSchema = z
  .object(graphReadExpansionHopShape)
  .strict()
  .transform(
    (value): WorkItemTypeGraphReadExpansionHop => ({
      relationshipType: value.relationshipType,
      direction: value.direction,
      target: value.target,
    }),
  );

const graphReadExpansionShape = {
  key: z.string().min(1),
  seed: z.nativeEnum(WorkItemTypeGraphReadExpansionSeedEnum),
  path: z.array(graphReadExpansionHopSchema).min(1).max(5),
  projectionKind: z.nativeEnum(WorkItemTypeGraphReadExpansionProjectionKindEnum),
  deduplicateBy: z.nativeEnum(WorkItemTypeGraphReadExpansionDeduplicateByEnum),
  excludeRoot: z.boolean().optional(),
  limit: z.number().int().min(1).max(500),
} satisfies ZodShapeFor<WorkItemTypeGraphReadExpansion>;
const graphReadExpansionSchema = z
  .object(graphReadExpansionShape)
  .strict()
  .transform(
    (value): WorkItemTypeGraphReadExpansion => ({
      key: value.key,
      seed: value.seed,
      path: value.path,
      projectionKind: value.projectionKind,
      deduplicateBy: value.deduplicateBy,
      ...(value.excludeRoot !== undefined ? { excludeRoot: value.excludeRoot } : {}),
      limit: value.limit,
    }),
  );

const graphSearchableMetaLinkTargetShape = {
  edgeType: z.nativeEnum(AgentEdgeType),
  targetEntityTypes: z.array(z.nativeEnum(AgentEdgeEndpointEntityType)),
  targetWorkItemTypeKeys: z.array(z.string()).optional(),
} satisfies ZodShapeFor<WorkItemTypeGraphSearchableMetaLinkTarget>;
const graphSearchableMetaLinkTargetSchema = z
  .object(graphSearchableMetaLinkTargetShape)
  .strict()
  .transform(
    (value): WorkItemTypeGraphSearchableMetaLinkTarget => ({
      edgeType: value.edgeType,
      targetEntityTypes: value.targetEntityTypes,
      ...(value.targetWorkItemTypeKeys !== undefined
        ? { targetWorkItemTypeKeys: value.targetWorkItemTypeKeys }
        : {}),
    }),
  );

const graphCapabilityShape = {
  nodeChildType: z.string(),
  layout: graphLayoutSchema,
  layoutPreference: graphLayoutPreferenceSchema.optional(),
  // Same {sectionKey, schemaRef} declaration shape as layoutPreference.
  groups: graphLayoutPreferenceSchema.optional(),
  readableRelationships: z.array(graphRelationshipSchema),
  editableRelationships: z.array(graphRelationshipSchema),
  searchableMetaLinkTargets: z.array(graphSearchableMetaLinkTargetSchema).optional(),
  rendererKey: z.string(),
  editorKey: z.string(),
  supportedActions: z.array(z.nativeEnum(WorkItemTypeGraphAction)),
  readExpansions: z.array(graphReadExpansionSchema).optional(),
} satisfies ZodShapeFor<WorkItemTypeGraphCapability>;
const graphCapabilitySchema = z
  .object(graphCapabilityShape)
  .strict()
  .transform(
    (value): WorkItemTypeGraphCapability => ({
      nodeChildType: value.nodeChildType,
      layout: value.layout,
      ...(value.layoutPreference !== undefined ? { layoutPreference: value.layoutPreference } : {}),
      ...(value.groups !== undefined ? { groups: value.groups } : {}),
      readableRelationships: value.readableRelationships,
      editableRelationships: value.editableRelationships,
      ...(value.searchableMetaLinkTargets !== undefined
        ? { searchableMetaLinkTargets: value.searchableMetaLinkTargets }
        : {}),
      rendererKey: value.rendererKey,
      editorKey: value.editorKey,
      supportedActions: value.supportedActions,
      ...(value.readExpansions !== undefined ? { readExpansions: value.readExpansions } : {}),
    }),
  );

const capabilitiesShape = {
  requiresParent: z.boolean().optional(),
  planEligible: z.boolean().optional(),
  hasSetInitialStatus: z.boolean().optional(),
  rendersInline: z.boolean().optional(),
  showsInExplorerSidebar: z.boolean().optional(),
  graph: graphCapabilitySchema.optional(),
} satisfies ZodShapeFor<WorkItemTypeCapabilities>;
const capabilitiesSchema = z
  .object(capabilitiesShape)
  .strict()
  .transform(
    (value): WorkItemTypeCapabilities => ({
      ...(value.requiresParent !== undefined ? { requiresParent: value.requiresParent } : {}),
      ...(value.planEligible !== undefined ? { planEligible: value.planEligible } : {}),
      ...(value.hasSetInitialStatus !== undefined
        ? { hasSetInitialStatus: value.hasSetInitialStatus }
        : {}),
      ...(value.rendersInline !== undefined ? { rendersInline: value.rendersInline } : {}),
      ...(value.showsInExplorerSidebar !== undefined
        ? { showsInExplorerSidebar: value.showsInExplorerSidebar }
        : {}),
      ...(value.graph !== undefined ? { graph: value.graph } : {}),
    }),
  );

/**
 * The full type definition. Required fields mirror the generated
 * {@link WorkItemTypeDefinitionDto} contract; closed enum arrays are validated
 * from their generated runtime values rather than duplicated locally.
 */
const guidanceExampleShape = {
  title: z.string().min(1),
  guidance: z.string().min(1),
} satisfies ZodShapeFor<WorkItemTypeGuidanceExample>;
const guidanceExampleSchema = z.object(guidanceExampleShape).strict();
const guidanceContextShape = {
  focalTypeKeys: z.array(z.string().min(1)).min(1),
  guidance: z.string().min(1),
  examples: z.array(guidanceExampleSchema).optional(),
} satisfies ZodShapeFor<WorkItemTypeGuidanceContext>;
const guidanceContextSchema = z
  .object(guidanceContextShape)
  .strict()
  .transform(
    (value): WorkItemTypeGuidanceContext => ({
      focalTypeKeys: value.focalTypeKeys,
      guidance: value.guidance,
      ...(value.examples !== undefined ? { examples: value.examples } : {}),
    }),
  );
const agentGuidanceShape = {
  overview: z.string().min(1),
  examples: z.array(guidanceExampleSchema).optional(),
  contexts: z.array(guidanceContextSchema).optional(),
} satisfies ZodShapeFor<WorkItemTypeAgentGuidance>;
const agentGuidanceSchema = z
  .object(agentGuidanceShape)
  .strict()
  .transform(
    (value): WorkItemTypeAgentGuidance => ({
      overview: value.overview,
      ...(value.examples !== undefined ? { examples: value.examples } : {}),
      ...(value.contexts !== undefined ? { contexts: value.contexts } : {}),
    }),
  );

const definitionShape = {
  key: z.string(),
  name: z.string(),
  agentGuidance: agentGuidanceSchema.optional(),
  maintenanceGuidance: z.string().optional(),
  role: z.nativeEnum(WorkItemTypeRole),
  acceptedConfigKinds: z.array(z.nativeEnum(WorkItemConfigKind)).optional(),
  iconKey: z.nativeEnum(WorkItemIconKey).optional(),
  colorKey: z.nativeEnum(WorkItemColorKey).optional(),
  description: z.string().nullable().optional(),
  sections: z.array(sectionSchema),
  requiredScalars: z.array(z.nativeEnum(WorkItemTypeScalarField)).optional(),
  forbiddenScalars: z.array(z.nativeEnum(WorkItemTypeScalarField)).optional(),
  allowedStatuses: z.array(z.nativeEnum(WorkStatus)),
  allowedParentTypes: z.array(z.string()).optional(),
  edgeTargets: z.array(edgeTargetSchema).optional(),
  allowedParentEntityTypes: z.array(z.nativeEnum(EntityType)).optional(),
  tracking: trackingSchema.optional(),
  agentSettableStatuses: z.array(z.nativeEnum(WorkStatus)).optional(),
  anchorableReportTypes: z.array(z.nativeEnum(ReportType)).optional(),
  writingStandards: writingStandardsSchema.nullable().optional(),
  capabilities: capabilitiesSchema.optional(),
} satisfies ZodShapeFor<WorkItemTypeDefinitionDto>;
const definitionSchema = z
  .object(definitionShape)
  .strict()
  .transform(
    (value): WorkItemTypeDefinitionDto => ({
      key: value.key,
      name: value.name,
      ...(value.agentGuidance !== undefined ? { agentGuidance: value.agentGuidance } : {}),
      ...(value.maintenanceGuidance !== undefined
        ? { maintenanceGuidance: value.maintenanceGuidance }
        : {}),
      role: value.role,
      ...(value.acceptedConfigKinds !== undefined
        ? { acceptedConfigKinds: value.acceptedConfigKinds }
        : {}),
      ...(value.iconKey !== undefined ? { iconKey: value.iconKey } : {}),
      ...(value.colorKey !== undefined ? { colorKey: value.colorKey } : {}),
      ...(value.description !== undefined ? { description: value.description } : {}),
      sections: value.sections,
      ...(value.requiredScalars !== undefined ? { requiredScalars: value.requiredScalars } : {}),
      ...(value.forbiddenScalars !== undefined ? { forbiddenScalars: value.forbiddenScalars } : {}),
      allowedStatuses: value.allowedStatuses,
      ...(value.allowedParentTypes !== undefined
        ? { allowedParentTypes: value.allowedParentTypes }
        : {}),
      ...(value.edgeTargets !== undefined ? { edgeTargets: value.edgeTargets } : {}),
      ...(value.allowedParentEntityTypes !== undefined
        ? { allowedParentEntityTypes: value.allowedParentEntityTypes }
        : {}),
      ...(value.tracking !== undefined ? { tracking: value.tracking } : {}),
      ...(value.agentSettableStatuses !== undefined
        ? { agentSettableStatuses: value.agentSettableStatuses }
        : {}),
      ...(value.anchorableReportTypes !== undefined
        ? { anchorableReportTypes: value.anchorableReportTypes }
        : {}),
      ...(value.writingStandards !== undefined ? { writingStandards: value.writingStandards } : {}),
      ...(value.capabilities !== undefined ? { capabilities: value.capabilities } : {}),
    }),
  );

/** The list entry: the full definition plus the registry metadata that frames it. */
const summaryShape = {
  id: z.string(),
  definition: definitionSchema,
  status: z.nativeEnum(WorkItemTypeLifecycleStatus),
  projectId: z.string(),
  effectiveSource: z.nativeEnum(WorkItemTypeEffectiveSource),
} satisfies ZodShapeFor<WorkItemTypeSummaryDto>;
const summarySchema = z.object(summaryShape).strict();

const summariesSchema = z.array(summarySchema);

/**
 * Reads the active work-item types registered for a project and returns their
 * type definitions. The caller supplies an OAuth access token (resolved from
 * `oauthClient.getAccessToken`) and the session's project id; the organization
 * id is decoded from the token.
 *
 * The list payload is validated at the boundary before it is trusted — the
 * envelope's `data` array is optional on the wire, so an absent or malformed
 * payload throws rather than degrading to an empty or partial list. A failed
 * read likewise surfaces as a throw; callers never receive a stand-in result
 * that masks the failure.
 */
export const readActiveWorkItemTypeDefinitions = async (
  accessToken: string,
  projectId: string,
): Promise<WorkItemTypeDefinitionDto[]> => {
  const organizationId = extractOrganizationIdFromToken(accessToken);
  if (!organizationId) {
    throw new Error('Cannot read work-item types: no organization id in the access token.');
  }
  if (!projectId) {
    throw new Error('Cannot read work-item types: no project id for the session.');
  }

  const api = new WorkItemTypesApi(
    new Configuration({ accessToken, basePath: resolveApiBaseUrl() }),
  );

  const response = await api.organizationsOrganizationIdProjectsProjectIdWorkItemTypesGet({
    organizationId,
    projectId,
    status: WorkItemTypeLifecycleStatus.Active,
  });

  const summaries = summariesSchema.parse(response.data.data);

  return summaries.map((summary) => summary.definition);
};
