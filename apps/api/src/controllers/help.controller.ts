import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { SkipTransform } from '../common/decorators/skip-transform.decorator';
import {
  HelpNodeWithBody,
  HelpSearchResponse,
  HelpTreeResponse,
} from '../generated';
import { HelpService } from '../services/help.service';
import {
  HelpAssetNotFoundError,
  HelpAssetPathError,
  HelpAssetService,
} from '../services/help-asset.service';

const DEFAULT_HELP_SEARCH_MAX_RESULTS = 10;
const MAX_HELP_SEARCH_MAX_RESULTS = 100;

@ApiTags('Help')
@Controller('api/v1/help')
export class HelpController {
  constructor(
    private readonly helpService: HelpService,
    private readonly helpAssetService: HelpAssetService,
  ) {}

  @Public()
  @SkipTransform()
  @Get('assets/*assetPath')
  @ApiOperation({
    summary: 'Get a repository-managed help asset',
    description:
      'Returns a checked-in Help image as raw bytes. The path must remain below the packaged Help assets directory.',
  })
  @ApiParam({
    name: 'assetPath',
    description: 'Repository-relative path below the Help assets directory.',
  })
  @ApiProduces(
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/avif',
  )
  @ApiResponse({
    status: 200,
    description: 'Help image retrieved successfully as raw bytes.',
    content: {
      'image/png': { schema: { type: 'string', format: 'binary' } },
      'image/jpeg': { schema: { type: 'string', format: 'binary' } },
      'image/gif': { schema: { type: 'string', format: 'binary' } },
      'image/webp': { schema: { type: 'string', format: 'binary' } },
      'image/svg+xml': { schema: { type: 'string', format: 'binary' } },
      'image/avif': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid or unsafe asset path.' })
  @ApiResponse({ status: 404, description: 'Help asset not found.' })
  async getAsset(
    @Param('assetPath') assetPath: string | string[],
  ): Promise<StreamableFile> {
    try {
      const asset = await this.helpAssetService.readAsset(
        normalizeAssetPathParam(assetPath),
      );
      return new StreamableFile(asset.body, {
        type: asset.mediaType,
        length: asset.body.length,
      });
    } catch (error) {
      if (error instanceof HelpAssetPathError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof HelpAssetNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  @Public()
  @Get('tree')
  @ApiOperation({
    summary: 'Get help tree',
    description:
      'Returns the shallow, globally scoped help browse tree from help_node rows.',
  })
  async getTree(): Promise<HelpTreeResponse> {
    return this.helpService.getTree();
  }

  @Public()
  @Get('search')
  @ApiOperation({
    summary: 'Search help',
    description:
      'Searches globally scoped help nodes by title and body and returns ranked snippet results.',
  })
  async search(
    @Query('q') query: string | undefined,
    @Query('maxResults') maxResults: string | undefined,
  ): Promise<HelpSearchResponse> {
    return this.helpService.searchHelpNodes(
      requireSearchQuery(query),
      parseMaxResults(maxResults),
    );
  }

  @Public()
  @Get('nodes/*idOrSlugPath')
  @ApiOperation({
    summary: 'Get help node',
    description:
      'Returns one globally scoped help node with its body and ordered demos.',
  })
  async getNode(
    @Param('idOrSlugPath') idOrSlugPath: string | string[],
  ): Promise<HelpNodeWithBody> {
    const node = await this.helpService.findByIdOrSlugPath(
      normalizeIdOrSlugPathParam(idOrSlugPath),
    );

    if (!node) {
      throw new NotFoundException('Help node not found');
    }

    return node;
  }
}

function normalizeIdOrSlugPathParam(idOrSlugPath: string | string[]): string {
  return Array.isArray(idOrSlugPath) ? idOrSlugPath.join('/') : idOrSlugPath;
}

function normalizeAssetPathParam(assetPath: string | string[]): string {
  return Array.isArray(assetPath) ? assetPath.join('/') : assetPath;
}

function requireSearchQuery(query: string | undefined): string {
  if (typeof query !== 'string') {
    throw new BadRequestException('q query parameter is required');
  }

  return query;
}

function parseMaxResults(maxResults: string | undefined): number {
  if (maxResults === undefined) {
    return DEFAULT_HELP_SEARCH_MAX_RESULTS;
  }

  const parsed = Number(maxResults);
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_HELP_SEARCH_MAX_RESULTS
  ) {
    throw new BadRequestException(
      'maxResults must be an integer from 1 to 100',
    );
  }

  return parsed;
}
