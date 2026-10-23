import { ApiProperty } from '@nestjs/swagger';
import { EntitySearchResult } from '../../generated/model/entitySearchResult';
import { EntityType } from '../../generated/model/entityType';

export class EntitySearchResultDto implements EntitySearchResult {
  @ApiProperty({
    description: 'The unique identifier for the entity.',
    example: 'clxvf72p0000108l9g1f2d3h4',
  })
  entityId!: string;

  @ApiProperty({
    description: 'The type of the entity.',
    enum: EntityType,
    example: EntityType.Artifact,
  })
  entityType!: EntityType;

  @ApiProperty({
    description: 'The name of the entity.',
    example: 'John Doe',
  })
  entityName!: string;

  @ApiProperty({
    description: 'The similarity score of the search result.',
    example: 0.987,
  })
  similarity!: number;

  @ApiProperty({
    description: 'The status of the entity from its source table.',
    example: 'REFINING_DESCRIPTION',
    required: false,
    nullable: true,
  })
  status?: string | null;
}
