import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type McpServerState = 'starting' | 'ready' | 'shutting_down';

@Injectable()
export class McpHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpHealthService.name);
  private state: McpServerState = 'starting';
  private readonly shutdownTimeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.shutdownTimeoutMs = this.config.get<number>(
      'MCP_SHUTDOWN_TIMEOUT_MS',
      5000,
    );
  }

  onModuleInit(): void {
    this.state = 'ready';
    this.logger.log('MCP server is ready');
  }

  async onModuleDestroy(): Promise<void> {
    this.state = 'shutting_down';
    this.logger.log(
      `MCP server shutting down (timeout: ${this.shutdownTimeoutMs}ms)`,
    );

    await new Promise<void>((resolve) =>
      setTimeout(resolve, this.shutdownTimeoutMs),
    );

    this.logger.log('MCP server shutdown complete');
  }

  getState(): McpServerState {
    return this.state;
  }

  isReady(): boolean {
    return this.state === 'ready';
  }
}
