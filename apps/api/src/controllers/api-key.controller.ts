import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  IsNotEmpty,
  ArrayNotEmpty,
  IsISO8601,
  IsBoolean,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ApiKeyService } from '../services/api-key.service';
import { ApiKeyId, OrganizationId } from '../types';

// DTOs for API key management
export class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  name?: string; // ValidationPipe will ensure this is provided and valid

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayNotEmpty()
  scopes?: string[]; // ValidationPipe will ensure this is provided and valid

  @IsOptional()
  @IsISO8601()
  expiresAt?: string; // ISO date string
}

export class UpdateApiKeyDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string; // ISO date string
}

export class ApiKeyResponseDto {
  constructor(
    public id: string,
    public prefix: string,
    public name: string,
    public scopes: string[],
    public createdAt: string,
    public updatedAt: string,
    public isActive: boolean,
    public createdBy: string,
    public description?: string,
    public lastUsedAt?: string,
    public lastUsedIp?: string,
    public expiresAt?: string,
  ) {}
}

export class ApiKeyWithSecretDto extends ApiKeyResponseDto {
  constructor(
    public key: string, // The actual API key - only returned on creation/rotation
    id: string,
    prefix: string,
    name: string,
    scopes: string[],
    createdAt: string,
    updatedAt: string,
    isActive: boolean,
    createdBy: string,
    description?: string,
    lastUsedAt?: string,
    lastUsedIp?: string,
    expiresAt?: string,
  ) {
    super(
      id,
      prefix,
      name,
      scopes,
      createdAt,
      updatedAt,
      isActive,
      createdBy,
      description,
      lastUsedAt,
      lastUsedIp,
      expiresAt,
    );
  }
}

@ApiTags('API Keys')
@Controller('api/v1/organizations/:organizationId/api-keys')
@UseGuards(JwtAuthGuard, OrganizationGuard)
@ApiBearerAuth()
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new API key' })
  @ApiResponse({
    status: 201,
    description: 'API key created successfully',
    type: ApiKeyWithSecretDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async createApiKey(
    @Param('organizationId') organizationId: OrganizationId,
    @Body(ValidationPipe) createApiKeyDto: CreateApiKeyDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiKeyWithSecretDto> {
    // Validate scopes
    if (!createApiKeyDto.scopes || createApiKeyDto.scopes.length === 0) {
      throw new BadRequestException('At least one scope is required');
    }

    // Validate name
    if (!createApiKeyDto.name || createApiKeyDto.name.trim().length === 0) {
      throw new BadRequestException('API key name is required');
    }

    // Parse expiration date if provided
    let expiresAt: Date | undefined;
    if (createApiKeyDto.expiresAt) {
      expiresAt = new Date(createApiKeyDto.expiresAt);
      if (isNaN(expiresAt.getTime())) {
        throw new BadRequestException('Invalid expiration date format');
      }
      if (expiresAt <= new Date()) {
        throw new BadRequestException('Expiration date must be in the future');
      }
    }

    const apiKey = await this.apiKeyService.createApiKey({
      organizationId,
      createdBy: user.userId,
      name: createApiKeyDto.name.trim(),
      description: createApiKeyDto.description?.trim(),
      scopes: createApiKeyDto.scopes,
      expiresAt,
    });

    return {
      id: apiKey.id,
      key: apiKey.key,
      prefix: apiKey.prefix,
      name: apiKey.name,
      description: apiKey.description,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expiresAt?.toISOString(),
      createdAt: apiKey.createdAt.toISOString(),
      updatedAt: apiKey.createdAt.toISOString(), // Same as createdAt for new keys
      isActive: apiKey.isActive,
      createdBy: user.userId,
    };
  }

  @Get()
  @ApiOperation({ summary: 'List all API keys for the organization' })
  @ApiResponse({
    status: 200,
    description: 'API keys retrieved successfully',
    type: [ApiKeyResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getApiKeys(
    @Param('organizationId') organizationId: OrganizationId,
  ): Promise<ApiKeyResponseDto[]> {
    const apiKeys = await this.apiKeyService.getApiKeys(organizationId);

    return apiKeys.map((key) => ({
      id: key.id,
      prefix: key.prefix,
      name: key.name,
      description: key.description,
      scopes: key.scopes,
      lastUsedAt: key.lastUsedAt?.toISOString(),
      lastUsedIp: key.lastUsedIp,
      expiresAt: key.expiresAt?.toISOString(),
      createdAt: key.createdAt.toISOString(),
      updatedAt: key.updatedAt.toISOString(),
      isActive: key.isActive,
      createdBy: key.createdBy,
    }));
  }

  @Get(':keyId')
  @ApiOperation({ summary: 'Get details of a specific API key' })
  @ApiResponse({
    status: 200,
    description: 'API key retrieved successfully',
    type: ApiKeyResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'API key not found' })
  async getApiKey(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('keyId') keyId: string,
  ): Promise<ApiKeyResponseDto> {
    const apiKey = await this.apiKeyService.getApiKeyById(
      keyId as ApiKeyId,
      organizationId,
    );

    return {
      id: apiKey.id,
      prefix: apiKey.prefix,
      name: apiKey.name,
      description: apiKey.description,
      scopes: apiKey.scopes,
      lastUsedAt: apiKey.lastUsedAt?.toISOString(),
      lastUsedIp: apiKey.lastUsedIp,
      expiresAt: apiKey.expiresAt?.toISOString(),
      createdAt: apiKey.createdAt.toISOString(),
      updatedAt: apiKey.updatedAt.toISOString(),
      isActive: apiKey.isActive,
      createdBy: apiKey.createdBy,
    };
  }

  @Patch(':keyId')
  @ApiOperation({ summary: 'Update an API key' })
  @ApiResponse({
    status: 200,
    description: 'API key updated successfully',
    type: ApiKeyResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'API key not found' })
  async updateApiKey(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('keyId') keyId: string,
    @Body(ValidationPipe) updateApiKeyDto: UpdateApiKeyDto,
  ): Promise<ApiKeyResponseDto> {
    // Validate expiration date if provided
    let expiresAt: Date | undefined;
    if (updateApiKeyDto.expiresAt) {
      expiresAt = new Date(updateApiKeyDto.expiresAt);
      if (isNaN(expiresAt.getTime())) {
        throw new BadRequestException('Invalid expiration date format');
      }
      if (expiresAt <= new Date()) {
        throw new BadRequestException('Expiration date must be in the future');
      }
    }

    // Validate name if provided
    if (
      updateApiKeyDto.name !== undefined &&
      updateApiKeyDto.name.trim().length === 0
    ) {
      throw new BadRequestException('API key name cannot be empty');
    }

    // Validate scopes if provided
    if (
      updateApiKeyDto.scopes !== undefined &&
      updateApiKeyDto.scopes.length === 0
    ) {
      throw new BadRequestException('At least one scope is required');
    }

    const updateData: {
      name?: string;
      description?: string;
      scopes?: string[];
      isActive?: boolean;
      expiresAt?: Date;
    } = {};

    if (updateApiKeyDto.name !== undefined) {
      updateData.name = updateApiKeyDto.name.trim();
    }
    if (updateApiKeyDto.description !== undefined) {
      updateData.description = updateApiKeyDto.description?.trim();
    }
    if (updateApiKeyDto.scopes !== undefined) {
      updateData.scopes = updateApiKeyDto.scopes;
    }
    if (updateApiKeyDto.isActive !== undefined) {
      updateData.isActive = updateApiKeyDto.isActive;
    }
    if (expiresAt !== undefined) {
      updateData.expiresAt = expiresAt;
    }

    const apiKey = await this.apiKeyService.updateApiKey(
      keyId as ApiKeyId,
      organizationId,
      updateData,
    );

    return {
      id: apiKey.id,
      prefix: apiKey.prefix,
      name: apiKey.name,
      description: apiKey.description,
      scopes: apiKey.scopes,
      lastUsedAt: apiKey.lastUsedAt?.toISOString(),
      lastUsedIp: apiKey.lastUsedIp,
      expiresAt: apiKey.expiresAt?.toISOString(),
      createdAt: apiKey.createdAt.toISOString(),
      updatedAt: apiKey.updatedAt.toISOString(),
      isActive: apiKey.isActive,
      createdBy: apiKey.createdBy,
    };
  }

  @Delete(':keyId')
  @ApiOperation({ summary: 'Delete (revoke) an API key' })
  @ApiResponse({ status: 204, description: 'API key deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'API key not found' })
  async deleteApiKey(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('keyId') keyId: string,
  ): Promise<void> {
    await this.apiKeyService.deleteApiKey(keyId as ApiKeyId, organizationId);
  }

  @Post(':keyId/rotate')
  @ApiOperation({ summary: 'Rotate an API key (generate new secret)' })
  @ApiResponse({
    status: 200,
    description: 'API key rotated successfully',
    type: ApiKeyWithSecretDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'API key not found' })
  async rotateApiKey(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('keyId') keyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiKeyWithSecretDto> {
    const apiKey = await this.apiKeyService.rotateApiKey(
      keyId as ApiKeyId,
      organizationId,
    );

    return {
      id: apiKey.id,
      key: apiKey.key,
      prefix: apiKey.prefix,
      name: apiKey.name,
      description: apiKey.description,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expiresAt?.toISOString(),
      createdAt: apiKey.createdAt.toISOString(),
      updatedAt: new Date().toISOString(), // Updated now due to rotation
      isActive: apiKey.isActive,
      createdBy: user.userId,
    };
  }
}
