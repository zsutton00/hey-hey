import {
  RelatedEntitiesPayload,
  RelatedEntityDto,
  SecondaryActionConfig,
  SecondaryActionHandler,
} from 'src/generated';
import { v4 as uuidv4 } from 'uuid';

type RelatedEntitiesSecondaryActionInput = {
  fieldId: string;
  relatedEntities?: RelatedEntityDto[] | null;
};

export const buildRelatedEntitiesSecondaryActions = (
  input: RelatedEntitiesSecondaryActionInput,
): SecondaryActionConfig[] => {
  if (!input.relatedEntities?.length) {
    return [];
  }

  return [
    {
      id: uuidv4(),
      type: SecondaryActionConfig.TypeEnum.FieldAction,
      presentation: SecondaryActionConfig.PresentationEnum.Inline,
      label: 'Related entities',
      fieldId: input.fieldId,
      handler: SecondaryActionHandler.RelatedEntities,
      payload: {
        handlerType: 'related_entities',
        relatedEntities: input.relatedEntities,
      } as RelatedEntitiesPayload,
    },
  ];
};
