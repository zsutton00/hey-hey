import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AgentSessionServicePlaceKind,
  ReportAgentSessionServicePlacesDto,
  ReportedAgentSessionServicePlace,
} from '@hey-hey/contracts/api/models';

const PLACE_KINDS = Object.values(AgentSessionServicePlaceKind);

const isWorktree = (place: ReportedServicePlaceDto): boolean =>
  place.kind === AgentSessionServicePlaceKind.Worktree;

export class ReportedServicePlaceDto implements ReportedAgentSessionServicePlace {
  @IsUUID()
  serviceId!: string;

  @IsIn(PLACE_KINDS)
  kind!: AgentSessionServicePlaceKind;

  // Null is a detached MAIN_FOLDER; a WORKTREE always names its branch.
  @ValidateIf(
    (place: ReportedServicePlaceDto) =>
      isWorktree(place) || place.branch !== null,
  )
  @IsString()
  @IsNotEmpty()
  branch!: string | null;

  // Required for a WORKTREE; ignored for a MAIN_FOLDER.
  @ValidateIf(
    (place: ReportedServicePlaceDto) =>
      isWorktree(place) || place.worktreePath !== undefined,
  )
  @IsString()
  @IsNotEmpty()
  worktreePath?: string;
}

export class ReportAgentSessionServicePlacesRequestDto implements ReportAgentSessionServicePlacesDto {
  @IsUUID()
  machineId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((place: ReportedServicePlaceDto) => place.serviceId)
  @ValidateNested({ each: true })
  @Type(() => ReportedServicePlaceDto)
  places!: ReportedServicePlaceDto[];
}
