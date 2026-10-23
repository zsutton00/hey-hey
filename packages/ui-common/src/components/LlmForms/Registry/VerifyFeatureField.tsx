import { Box, Stack, Typography } from "@mui/material";
import { useMemo } from "react";
import {
  EntityType,
  type VerifyFeaturePayload,
  type VerifyImpactedEntityReference,
} from "../../../api";
import {
  entityNameKey,
  useEntityNames,
  type EntityNameLookup,
} from "../../../data/hooks/useEntityNames";
import { resolvePreviewEntityType } from "../../../utils/mentionFormatting";
import { MentionBadgeInner } from "../../SmarterTextAreaCard/MentionBadge";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";
import type { FieldComponentProps } from "./types";

const ENTITY_TYPES: ReadonlySet<string> = new Set(Object.values(EntityType));

// The suggestion carries only type plus id; work-item subtypes (FEATURE,
// MOCKUP, DECISION, ...) resolve their names through the TASK lookup.
const toNameLookupType = (entityType: string): EntityType | undefined => {
  const base = resolvePreviewEntityType(entityType).toUpperCase();
  return ENTITY_TYPES.has(base) ? (base as EntityType) : undefined;
};

const getUniqueImpactedEntities = (
  entities: VerifyImpactedEntityReference[] | undefined,
): VerifyImpactedEntityReference[] => {
  const seen = new Set<string>();

  return (entities ?? []).filter((entity) => {
    const identity = `${entity.entityType}:${entity.entityId}`;
    if (seen.has(identity)) return false;

    seen.add(identity);
    return true;
  });
};

export function VerifyFeatureField({
  value,
  context,
}: FieldComponentProps<VerifyFeaturePayload>) {
  const impactedEntities = useMemo(
    () => getUniqueImpactedEntities(value?.impactedEntities),
    [value?.impactedEntities],
  );
  const nameLookups = useMemo(
    () =>
      impactedEntities.flatMap((entity): EntityNameLookup[] => {
        const entityType = toNameLookupType(entity.entityType);
        return entityType ? [{ entityId: entity.entityId, entityType }] : [];
      }),
    [impactedEntities],
  );
  const { names } = useEntityNames({
    organizationId: context.organizationId,
    entities: nameLookups,
  });
  const nameFor = (entity: VerifyImpactedEntityReference): string => {
    const entityType = toNameLookupType(entity.entityType);
    return (
      (entityType && names.get(entityNameKey(entity.entityId, entityType))) ||
      entity.entityId
    );
  };

  return (
    <Box data-testid="verify-feature-field">
      <MarkdownRenderer allowMentionEscapes>
        {value?.explanation ?? ""}
      </MarkdownRenderer>
      {impactedEntities.length > 0 && (
        <Stack data-testid="verify-feature-impacted-entities" spacing={0.5}>
          <Typography color="text.secondary" variant="caption">
            Possibly affected
          </Typography>
          <Stack
            direction="row"
            flexWrap="wrap"
            spacing={0.5}
            sx={{ rowGap: 0.5 }}
          >
            {impactedEntities.map((entity) => (
              <MentionBadgeInner
                key={`${entity.entityType}-${entity.entityId}`}
                mention={{
                  entityType: entity.entityType,
                  entityId: entity.entityId,
                  entityName: nameFor(entity),
                }}
                mode="full"
              />
            ))}
          </Stack>
        </Stack>
      )}
    </Box>
  );
}
