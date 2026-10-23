import { DynamicModule, Module, Global, Provider } from '@nestjs/common';
import { HttpModule, HttpService } from '@nestjs/axios';
import {
  AsyncConfiguration,
  Configuration,
  ConfigurationFactory,
} from './configuration';

import { AdminService } from './api/admin.service';
import { AgentEdgesService } from './api/agentEdges.service';
import { HintsService } from './api/hints.service';
import { LifecycleService } from './api/lifecycle.service';
import { NodesService } from './api/nodes.service';
import { QueriesService } from './api/queries.service';
import { RelationshipsService } from './api/relationships.service';
import { TemplateGraphService } from './api/templateGraph.service';

@Global()
@Module({
  imports: [HttpModule],
  exports: [
    AdminService,
    AgentEdgesService,
    HintsService,
    LifecycleService,
    NodesService,
    QueriesService,
    RelationshipsService,
    TemplateGraphService,
  ],
  providers: [
    AdminService,
    AgentEdgesService,
    HintsService,
    LifecycleService,
    NodesService,
    QueriesService,
    RelationshipsService,
    TemplateGraphService,
  ],
})
export class ApiModule {
  public static forRoot(
    configurationFactory: () => Configuration,
  ): DynamicModule {
    return {
      module: ApiModule,
      providers: [{ provide: Configuration, useFactory: configurationFactory }],
    };
  }

  /**
   * Register the module asynchronously.
   */
  static forRootAsync(options: AsyncConfiguration): DynamicModule {
    const providers = [...this.createAsyncProviders(options)];
    return {
      module: ApiModule,
      imports: options.imports || [],
      providers,
      exports: providers,
    };
  }

  private static createAsyncProviders(options: AsyncConfiguration): Provider[] {
    if (options.useClass) {
      return [
        this.createAsyncConfigurationProvider(options),
        {
          provide: options.useClass,
          useClass: options.useClass,
        },
      ];
    }
    return [this.createAsyncConfigurationProvider(options)];
  }

  private static createAsyncConfigurationProvider(
    options: AsyncConfiguration,
  ): Provider {
    if (options.useFactory) {
      return {
        provide: Configuration,
        useFactory: options.useFactory,
        inject: options.inject || [],
      };
    }
    return {
      provide: Configuration,
      useFactory: async (optionsFactory: ConfigurationFactory) =>
        await optionsFactory.createConfiguration(),
      inject:
        (options.useExisting && [options.useExisting]) ||
        (options.useClass && [options.useClass]) ||
        [],
    };
  }

  constructor(httpService: HttpService) {}
}
