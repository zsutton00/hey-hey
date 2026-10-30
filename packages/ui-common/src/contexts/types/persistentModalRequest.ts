import { z } from "zod";
import { EntityType, TargetEntityType } from "../../api";
import { PROJECT_COLLECTION_KINDS } from "../PreviewHostContext";
import { OPEN_ITEM_ENTITY_TYPES } from "../../types/openItems";

const scope = {
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
};
const discuss = z
  .object({
    type: z.literal("discuss"),
    ...scope,
    entityId: z.string().min(1),
    entityType: z.union([
      z.nativeEnum(EntityType),
      z.nativeEnum(TargetEntityType),
    ]),
    entityTitle: z.string().optional(),
    initialValue: z.string().optional(),
  })
  .strict();
const triage = z.object({ type: z.literal("triage"), ...scope }).strict();
const preview = z
  .object({
    type: z.literal("preview"),
    ...scope,
    target: z.union([
      z
        .object({
          entityType: z.enum(OPEN_ITEM_ENTITY_TYPES),
          entityId: z.string().min(1),
        })
        .strict(),
      z
        .object({
          kind: z.literal("project_collection"),
          collection: z.enum(PROJECT_COLLECTION_KINDS),
        })
        .strict(),
    ]),
  })
  .strict();
const schema = z.discriminatedUnion("type", [discuss, triage, preview]);
export type PersistentModalRequest = z.infer<typeof schema>;
export type DiscussOpeningRequest = z.infer<typeof discuss>;

/** Inspect descriptors before parsing: accessors must never execute at this boundary. */
export function isPlainOpeningData(
  value: unknown,
  ancestors = new Set<object>(),
): boolean {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean"
  )
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (
    Array.isArray(value)
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  )
    return false;
  ancestors.add(value);
  const valid = Reflect.ownKeys(value).every((key) => {
    if (
      typeof key !== "string" ||
      key === "__proto__" ||
      key === "current" ||
      key === "$$typeof"
    )
      return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      !!descriptor &&
      "value" in descriptor &&
      isPlainOpeningData(descriptor.value, ancestors)
    );
  });
  ancestors.delete(value);
  return valid;
}
export function copyPersistentModalRequest(
  value: unknown,
): PersistentModalRequest | null {
  if (!isPlainOpeningData(value)) return null;
  const parsed = schema.safeParse(value);
  // Zod constructs fresh objects and arrays; no caller-owned reference is retained.
  return parsed.success ? parsed.data : null;
}
export function persistentModalIdentity(
  request: PersistentModalRequest,
): string {
  const prefix = `${request.organizationId}:${request.projectId}:${request.type}`;
  switch (request.type) {
    case "discuss":
      return `${prefix}:${request.entityType}:${request.entityId}`;
    case "triage":
      return prefix;
    case "preview":
      return "kind" in request.target
        ? `${prefix}:collection:${request.target.collection}`
        : `${prefix}:${request.target.entityType}:${request.target.entityId}`;
  }
}
