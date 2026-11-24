import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  AdmissionEnvelopeAuthorization,
  CliReadWorkspaceServicePlacesListRequest,
  CliReadWorkspaceServicePlacesListRequestOperationEnum,
} from '@hey-hey/contracts/api/models';

export const MAX_SERVICE_PLACE_SERVICE_IDS = 20;

/** Mirrors the OpenAPI constraints on `CliReadWorkspaceServicePlacesListRequest`. */
export class ListMachineServicePlacesRequestDto implements CliReadWorkspaceServicePlacesListRequest {
  @IsIn(Object.values(CliReadWorkspaceServicePlacesListRequestOperationEnum))
  operation!: CliReadWorkspaceServicePlacesListRequestOperationEnum;

  // The admission evidence is verified in full by the grant service.
  @IsObject()
  authorization!: AdmissionEnvelopeAuthorization;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SERVICE_PLACE_SERVICE_IDS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  serviceIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  branchQuery?: string;
}
