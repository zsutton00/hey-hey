import { z } from 'zod';
import type { CanonicalJsonValue } from '../../shared/canonical-json';
import { EntityType, RelationshipValue } from '../../shared/api/generated/api';

// JSON is narrowed at the HTTP boundary; each list member is then validated independently.
const jsonSchema: z.ZodType<CanonicalJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(jsonSchema),
  ]),
);
export const envelopeSchema = z.object({ data: jsonSchema });
const recordsSchema = z.array(jsonSchema);
export const collectionSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ABSENT') }),
  z.object({
    state: z.literal('PRESENT'),
    revision: z.number().int().positive(),
    items: recordsSchema,
    groups: recordsSchema,
  }),
]);
export const openItemSchema = z.object({
  entityType: z.nativeEnum(EntityType),
  entityId: z.string().uuid(),
  note: z.string().max(2000).nullable(),
  pinned: z.boolean(),
  position: z.string().min(1).max(64),
  groupId: z.string().uuid().nullable(),
  memberPosition: z.string().min(1).max(64).nullable(),
  revision: z.number().int().positive(),
  presentation: z.object({ label: z.string().min(1).max(300) }),
  lineage: z
    .array(z.object({ entityType: z.nativeEnum(EntityType), entityId: z.string().uuid() }))
    .max(16),
  removedAt: z.string().datetime({ offset: true }).nullable(),
  updatedAt: z.string().datetime({ offset: true }),
  goalTrackedWorkFilter: z.enum(['ACTIVE_AND_BACKLOG', 'ACTIVE', 'ALL', 'NONE']),
  goalCollapsed: z.boolean(),
});
export const groupSchema = z.object({
  groupId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  position: z.string().min(1).max(64),
  collapsed: z.boolean(),
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime({ offset: true }),
});
export const goalSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  dueDate: z.string().datetime({ offset: true }).nullable(),
});
export const goalsSchema = z.object({
  items: recordsSchema,
  userId: z.string(),
  windowDays: z.number(),
});
export const trackedSchema = z.object({
  targetEntityId: z.string().uuid(),
  targetEntityType: z.nativeEnum(EntityType),
  title: z.string().min(1),
  status: z.string().nullable().optional(),
});
export const goalDetailSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('GOAL'),
  trackedEntities: recordsSchema,
  archivedAt: z.string().nullable().optional(),
});
export const attentionPageSchema = z.object({
  events: recordsSchema,
  pagination: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
});
export const relatedSchema = z.object({
  entityId: z.string().uuid(),
  entityType: z.nativeEnum(EntityType),
  displayName: z.string().min(1),
  relationship: z.nativeEnum(RelationshipValue),
  status: z.string().optional(),
});
export const hierarchySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  relationship: z.string().optional(),
  distance: z.number().int().positive().optional(),
  relationshipType: z.string(),
  direction: z.enum(['inbound', 'outbound']).optional(),
  status: z.string().optional(),
});
export const contextSchema = z.object({
  entityId: z.string().uuid(),
  entityType: z.nativeEnum(EntityType),
  creatingProposalId: z.string().uuid().optional(),
  relatedEntities: recordsSchema,
  featureHierarchy: recordsSchema,
  content: z.object({ status: z.string().optional() }).optional(),
});
export const sourceProposalSchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  status: z.string(),
  targetEntityId: z.string().uuid(),
  targetEntityType: z.nativeEnum(EntityType),
  conversationId: z.string().uuid().optional(),
});
export const sourceConversationSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  status: z.string(),
  title: z.string().min(1).nullable().optional(),
});
