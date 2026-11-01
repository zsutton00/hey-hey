import { Box, Stack, Typography } from "@mui/material";
import { useMemo } from "react";
import type {
  VerifyFeaturePayload,
  VerifyImpactedEntityReference,
} from "../../../api";
import { MentionBadgeInner } from "../../SmarterTextAreaCard/MentionBadge";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";
import type { FieldComponentProps } from "./types";

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
}: FieldComponentProps<VerifyFeaturePayload>) {
  const impactedEntities = useMemo(
    () => getUniqueImpactedEntities(value?.impactedEntities),
    [value?.impactedEntities],
  );
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
                  // Saved references that predate titles fall back to the id.
                  entityName: entity.title ?? entity.entityId,
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
