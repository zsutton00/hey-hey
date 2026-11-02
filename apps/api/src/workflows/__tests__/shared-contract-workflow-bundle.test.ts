import { bundleWorkflowCode } from '@temporalio/worker';
import * as path from 'path';
import {
  SystemMessageResponseType,
  WorkflowName,
} from '@hey-hey/contracts/api/models';

describe('shared generated models in workflow bundles', () => {
  jest.setTimeout(30_000);

  it('keeps runtime enums serializable without bundling API transports or browser packages', async () => {
    const serialized = JSON.stringify({
      responseType: SystemMessageResponseType.Questions,
      workflowName: WorkflowName.TaskGeneration,
    });

    expect(serialized).toBe(
      '{"responseType":"QUESTIONS","workflowName":"task-generation"}',
    );

    const bundle = await bundleWorkflowCode({
      workflowsPath: require.resolve('../workers'),
      ignoreModules: [
        'stream',
        '@nestjs/common',
        '@nestjs/core',
        '@nestjs/axios',
        'reflect-metadata',
      ],
      webpackConfigHook: (config) => {
        config.module = config.module || {};
        config.module.exprContextCritical = false;
        config.resolve = config.resolve || {};

        const existingAliases = config.resolve.alias;
        config.resolve.alias = {
          ...(existingAliases && !Array.isArray(existingAliases)
            ? existingAliases
            : {}),
          src: path.resolve(__dirname, '../..'),
        };

        config.externals = config.externals || [];
        if (Array.isArray(config.externals)) {
          config.externals.push(/generated\/api/);
          config.externals.push(/@nestjs\//);
        }

        return config;
      },
    });

    expect(bundle.code).not.toMatch(
      /node_modules(?:\/\.pnpm\/[^/]+\/node_modules)?\/(?:axios|@nestjs\/|jsdom|happy-dom)(?:\/|$)/,
    );
  });
});
