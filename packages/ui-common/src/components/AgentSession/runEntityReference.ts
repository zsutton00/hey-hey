import {
  RunEntityReferenceEntityTypeEnum,
  type RunEntityReference,
} from "../../api";

const ENTITY_TYPE_BY_KEY: Readonly<
  Record<string, RunEntityReference["entityType"]>
> = Object.fromEntries(
  Object.values(RunEntityReferenceEntityTypeEnum).map((value) => [value, value])
);

export const buildRunEntityReference = (
  entityType: string,
  entityId: string
): RunEntityReference => {
  const canonicalType = entityType.trim().toUpperCase().replace(/-/g, "_");
  const resolvedType = ENTITY_TYPE_BY_KEY[canonicalType];
  const resolvedId = entityId.trim();
  if (!resolvedType || !resolvedId) {
    throw new Error("Run entity scope must contain a supported type and id.");
  }
  return { entityType: resolvedType, entityId: resolvedId };
};
