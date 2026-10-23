import { useMemo } from "react";
import { RelatedEntityDtoWriterPayloadModeEnum } from "../../../api";
import type { RelatedEntityDto } from "../../../types/secondaryActions";
import { EntityEvidenceBrowser } from "../../shared/EntityEvidenceBrowser";

export interface RelatedEntitiesProps {
  entities: RelatedEntityDto[];
  organizationId: string;
  projectId: string;
  messageId?: string;
  label?: string;
  showPreview?: boolean;
}

const isHighImportanceEntity = (entity: RelatedEntityDto): boolean =>
  entity.selectedForHydration === true &&
  entity.hydrated === true &&
  entity.writerPayloadMode ===
    RelatedEntityDtoWriterPayloadModeEnum.FullDocument;

export const RelatedEntities = ({
  entities,
  organizationId: _organizationId,
  projectId: _projectId,
  messageId: _messageId,
  label,
  showPreview: _showPreview = true,
}: RelatedEntitiesProps) => {
  const groups = useMemo(
    () => [
      {
        id: "related-entities",
        label: `Related entities (${String(entities.length)})`,
        items: entities.map((entity) => ({
          id: entity.entityId,
          entityType: entity.entityType,
          title: entity.entityName,
          subtitle: entity.entityType,
          highlighted: isHighImportanceEntity(entity),
        })),
      },
    ],
    [entities],
  );

  return (
    <EntityEvidenceBrowser
      groups={groups}
      title={label || "Related entities"}
      modalTitle={label || "Related entities"}
      emptyText="No related entities available."
      dataTestId="related-entities-secondary-action"
      listDataTestId="related-entities-list"
    />
  );
};
