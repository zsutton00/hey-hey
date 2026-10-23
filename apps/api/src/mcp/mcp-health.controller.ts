import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { McpHealthService, McpServerState } from './mcp-health.service';

interface McpHealthResponse {
  status: McpServerState;
  name: string;
  version: string;
  timestamp: string;
}

@ApiTags('mcp')
@Controller('mcp')
export class McpHealthController {
  private readonly serverName: string;
  private readonly serverVersion: string;

  constructor(
    private readonly health: McpHealthService,
    config: ConfigService,
  ) {
    this.serverName = config.get<string>('MCP_SERVER_NAME', 'hey-hey-mcp');
    this.serverVersion = config.get<string>('MCP_SERVER_VERSION', '1.0.0');
  }

  @Get('health')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'MCP server health check' })
  @ApiResponse({
    status: 200,
    description: 'Server is ready',
  })
  @ApiResponse({
    status: 503,
    description: 'Server is not ready or shutting down',
  })
  getHealth(@Res() res: Response): void {
    const body: McpHealthResponse = {
      status: this.health.getState(),
      name: this.serverName,
      version: this.serverVersion,
      timestamp: new Date().toISOString(),
    };

    const httpStatus = this.health.isReady()
      ? HttpStatus.OK
      : HttpStatus.SERVICE_UNAVAILABLE;

    res.status(httpStatus).json(body);
  }
}
