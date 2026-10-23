import {
  MiddlewareConsumer,
  Module,
  NestModule,
  UseGuards,
} from '@nestjs/common';
import { McpModule, McpTransportType } from '@rekog/mcp-nest';
import { McpRequestLoggingMiddleware } from './middleware/mcp-request-logging.middleware';
import { Public } from '../auth/decorators/public.decorator';
import { OptionalAuthGuard } from '../auth/guards/optional-auth.guard';
import { ServiceModule } from '../services/service/service.module';
import { McpHealthService } from './mcp-health.service';
import { McpHealthController } from './mcp-health.controller';
import { McpCatalogController } from './mcp-catalog.controller';
import { SearchCacheService } from './tools/search-cache.service';
import { SearchToolsProvider } from './tools/search-tools.provider';
import { LintRecoveryStore } from './tools/lint-recovery.store';
import { ProposalToolsProvider } from './tools/proposal-tools.provider';
import { ProposalGroupToolsProvider } from './tools/proposal-group-tools.provider';
import { WorkItemTypeProposalToolsProvider } from './tools/work-item-type-proposal-tools.provider';
import { WorkItemTypeToolsProvider } from './tools/work-item-type-tools.provider';
import { ImplementationHintToolsProvider } from './tools/implementation-hint-tools.provider';
import { AgentSessionToolsProvider } from './tools/agent-session-tools.provider';
import { ServiceToolsProvider } from './tools/service-tools.provider';
import { GetContextToolsProvider } from './tools/get-context-tools.provider';
import { GetFeatureSyncContextToolsProvider } from './tools/get-feature-sync-context-tools.provider';
import { ListFeaturesToolsProvider } from './tools/list-features-tools.provider';
import { ListGoalsToolsProvider } from './tools/list-goals-tools.provider';
import { GoalTracksToolsProvider } from './tools/goal-tracks-tools.provider';
import { EdgeToolsProvider } from './tools/edge-tools.provider';
import { GetFullEntityToolsProvider } from './tools/get-full-entity-tools.provider';
import { GetReportSchemaToolsProvider } from './tools/get-report-schema-tools.provider';
import { GetToolGuidanceToolsProvider } from './tools/get-tool-guidance-tools.provider';
import { GetReportBodyToolsProvider } from './tools/get-report-body-tools.provider';
import { ListReportsByEntityToolsProvider } from './tools/list-reports-by-entity-tools.provider';
import { RecentlyViewedToolsProvider } from './tools/recently-viewed-tools.provider';
import { PlanToolsProvider } from './tools/plan-tools.provider';
import { GetDiagramToolsProvider } from './tools/get-diagram-tools.provider';
import { HelpService } from '../services/help.service';
import { readHintsEnabled } from '../config/hints.config';
import {
  HINT_READ_TOOL_PROVIDERS,
  HINT_WRITE_TOOL_PROVIDERS,
} from './tools/hint-tools.provider';

// Tools are registered at boot, so the deployment switch decides whether
// agents are offered hint tools at all.
const hintToolProviders = readHintsEnabled()
  ? [...HINT_WRITE_TOOL_PROVIDERS, ...HINT_READ_TOOL_PROVIDERS]
  : [];

@Module({
  imports: [
    McpModule.forRoot({
      name: process.env.MCP_SERVER_NAME ?? 'hey-hey-mcp',
      version: process.env.MCP_SERVER_VERSION ?? '1.0.0',
      transport: [McpTransportType.SSE, McpTransportType.STREAMABLE_HTTP],
      decorators: [Public(), UseGuards(OptionalAuthGuard)],
    }),
    ServiceModule,
  ],
  controllers: [McpHealthController, McpCatalogController],
  providers: [
    McpHealthService,
    SearchCacheService,
    HelpService,
    SearchToolsProvider,
    LintRecoveryStore,
    ProposalToolsProvider,
    ProposalGroupToolsProvider,
    WorkItemTypeProposalToolsProvider,
    WorkItemTypeToolsProvider,
    ImplementationHintToolsProvider,
    AgentSessionToolsProvider,
    ServiceToolsProvider,
    GetContextToolsProvider,
    GetFeatureSyncContextToolsProvider,
    ListFeaturesToolsProvider,
    ListGoalsToolsProvider,
    GoalTracksToolsProvider,
    EdgeToolsProvider,
    GetFullEntityToolsProvider,
    GetReportSchemaToolsProvider,
    GetToolGuidanceToolsProvider,
    GetReportBodyToolsProvider,
    ListReportsByEntityToolsProvider,
    RecentlyViewedToolsProvider,
    PlanToolsProvider,
    GetDiagramToolsProvider,
    ...hintToolProviders,
  ],
  exports: [McpHealthService],
})
export class McpServerModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(McpRequestLoggingMiddleware).forRoutes('mcp');
  }
}
