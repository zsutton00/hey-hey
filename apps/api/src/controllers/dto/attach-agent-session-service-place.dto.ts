import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { AttachAgentSessionServicePlaceDto } from '@hey-hey/contracts/api/models';

export class AttachAgentSessionServicePlaceRequestDto
  implements AttachAgentSessionServicePlaceDto
{
  @IsUUID()
  machineId!: string;

  @IsUUID()
  serviceId!: string;

  @IsString()
  @IsNotEmpty()
  branch!: string;

  @IsString()
  @IsNotEmpty()
  worktreePath!: string;

  @IsString()
  @IsNotEmpty()
  requestId!: string;
}
