import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OrganizationGuard } from 'src/auth/guards/organization.guard';
import {
  CurrentOrganization,
  CurrentUser,
} from 'src/auth/decorators/current-user.decorator';
import { OrganizationId, UserId } from 'src/types';
import {
  CodingPromptService,
  CreateCodingPromptResearchExecutionInput,
} from '../services/coding-prompt.service';

class CreateCodingPromptResearchExecutionDto
  implements CreateCodingPromptResearchExecutionInput
{
  @ApiPropertyOptional({
    description: 'Task ID target for coding prompt research',
  })
  taskId?: string;

  @ApiPropertyOptional({
    description: 'Design doc ID target for coding prompt research',
  })
  designDocId?: string;

  @ApiPropertyOptional({
    description: 'Optional plan ID used to scope/validate target membership',
  })
  planId?: string;

  @ApiPropertyOptional({
    description: 'Service ID for scoping implementation hint searches',
  })
  serviceId?: string;
}

class CodingPromptResearchExecutionTargetDto {
  @ApiPropertyOptional()
  taskId?: string;

  @ApiPropertyOptional()
  designDocId?: string;

  @ApiPropertyOptional()
  planId?: string;

  @ApiProperty({ description: 'Resolved project ID for execution context' })
  projectId!: string;

  @ApiProperty({
    description: 'Resolved workflow about type',
    enum: ['task', 'design-doc'],
  })
  workflowAboutType!: 'task' | 'design-doc';

  @ApiProperty({ description: 'Resolved workflow about ID' })
  workflowAboutId!: string;
}

class CodingPromptResearchExecutionStartedDto {
  @ApiProperty()
  executionId!: string;

  @ApiProperty({ enum: ['STARTED'] })
  status!: 'STARTED';

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ type: CodingPromptResearchExecutionTargetDto })
  target!: CodingPromptResearchExecutionTargetDto;
}

@ApiTags('CodingPrompts')
@Controller('api/v1/organizations/:organizationId/coding-prompts')
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
export class CodingPromptController {
  constructor(private readonly codingPromptService: CodingPromptService) {}

  @Post('research-executions')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Create a coding prompt research execution',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiResponse({
    status: 202,
    description: 'Research execution accepted',
    type: CodingPromptResearchExecutionStartedDto,
  })
  async createResearchExecution(
    @Body() dto: CreateCodingPromptResearchExecutionDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
  ): Promise<CodingPromptResearchExecutionStartedDto> {
    const started = await this.codingPromptService.createResearchExecution(
      organizationId,
      userId,
      dto,
    );

    return started;
  }
}
