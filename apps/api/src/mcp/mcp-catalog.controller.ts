import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Optional,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { McpRegistryDiscoveryService } from '@rekog/mcp-nest';
import { zodToJsonSchema } from 'zod-to-json-schema';

export interface McpToolEntry {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  isActive: boolean;
}

export interface McpCatalogResponse {
  tools: McpToolEntry[];
  count: number;
}

@ApiTags('mcp')
@Controller('mcp')
export class McpCatalogController {
  private readonly logger = new Logger(McpCatalogController.name);

  constructor(
    @Optional()
    @Inject(McpRegistryDiscoveryService)
    private readonly registry?: McpRegistryDiscoveryService,
  ) {
    if (!registry) {
      this.logger.warn(
        'McpRegistryDiscoveryService not available; ' +
          'tool catalog will be empty',
      );
    }
  }

  @Get('tools')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List registered MCP tools',
    description:
      'Returns the tool catalog with all registered tools, ' +
      'their parameters, and descriptions.',
  })
  @ApiResponse({
    status: 200,
    description: 'Tool catalog returned successfully',
  })
  getToolCatalog(): McpCatalogResponse {
    const tools = this.discoverTools();
    return {
      tools,
      count: tools.length,
    };
  }

  private discoverTools(): McpToolEntry[] {
    if (!this.registry) {
      return [];
    }

    const moduleIds = this.registry.getMcpModuleIds();
    const tools: McpToolEntry[] = [];

    for (const moduleId of moduleIds) {
      const discovered = this.registry.getTools(moduleId);
      for (const tool of discovered) {
        tools.push({
          name: tool.metadata.name,
          description: tool.metadata.description,
          inputSchema: tool.metadata.parameters
            ? (zodToJsonSchema(tool.metadata.parameters, {
                target: 'jsonSchema7',
                $refStrategy: 'none',
              }) as Record<string, unknown>)
            : undefined,
          outputSchema: tool.metadata.outputSchema
            ? (zodToJsonSchema(tool.metadata.outputSchema, {
                target: 'jsonSchema7',
                $refStrategy: 'none',
              }) as Record<string, unknown>)
            : undefined,
          isActive: true,
        });
      }
    }

    return tools;
  }
}
