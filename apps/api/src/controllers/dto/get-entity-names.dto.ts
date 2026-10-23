import { ApiProperty } from '@nestjs/swagger';
import { EntityType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class EntityLookupItemDto {
  @ApiProperty({
    description: 'The unique identifier of the entity.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  @IsUUID()
  entityId!: string;

  @ApiProperty({
    description: 'The type of the entity.',
    enum: EntityType,
    example: EntityType.TASK,
  })
  @IsEnum(EntityType)
  entityType!: EntityType;
}

export class GetEntityNamesDto {
  @ApiProperty({
    description: 'Array of entity id/type pairs to look up.',
    type: [EntityLookupItemDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EntityLookupItemDto)
  entities!: EntityLookupItemDto[];
}

export class EntityNameDto {
  @ApiProperty({
    description: 'The unique identifier of the entity.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  entityId!: string;

  @ApiProperty({
    description: 'The type of the entity.',
    enum: EntityType,
    example: EntityType.TASK,
  })
  entityType!: EntityType;

  @ApiProperty({
    description: 'The name of the entity.',
    example: 'My Task',
    nullable: true,
    required: false,
  })
  entityName?: string;
}
