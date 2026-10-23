import { Injectable } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { Module } from '@nestjs/core/injector/module';

// Types for dependency analysis
type ConstructorFunction = new (...args: unknown[]) => unknown;
type DependencyType = ConstructorFunction | undefined;
type ProviderToken = string | symbol | ConstructorFunction | object;

interface ServiceInstance {
  module: string;
  instance: object;
  scope: string;
}

@Injectable()
export class DependencyAnalyzer {
  constructor(private readonly modulesContainer: ModulesContainer) {}

  analyzeDependencies() {
    console.log('=== NestJS Dependency Analysis ===');

    for (const [moduleKey, module] of this.modulesContainer.entries()) {
      const moduleName = this.getModuleName(module, moduleKey);
      console.log(`\n📦 Module: ${moduleName}`);

      // Analyze providers
      this.analyzeProviders(module);

      // Analyze controllers
      this.analyzeControllers(module);
    }
  }

  private analyzeProviders(module: Module) {
    if (module.providers.size === 0) return;

    console.log('  🔧 Providers:');
    for (const [providerToken, provider] of module.providers.entries()) {
      const tokenName = this.getTokenName(providerToken);
      console.log(`    - ${tokenName}`);

      if (provider.instance) {
        console.log(`      ↳ Instance: ${provider.instance.constructor.name}`);
      }

      // Show dependencies (constructor parameters)
      if (provider.metatype) {
        const dependencies: DependencyType[] =
          Reflect.getMetadata('design:paramtypes', provider.metatype) || [];
        if (dependencies.length > 0) {
          console.log(
            `      ↳ Dependencies:`,
            dependencies.map((dep: DependencyType) => dep?.name || 'Unknown'),
          );
        }
      }
    }
  }

  private analyzeControllers(module: Module) {
    if (module.controllers.size === 0) return;

    console.log('  🎮 Controllers:');
    for (const [controllerToken, controller] of module.controllers.entries()) {
      const controllerName = this.getTokenName(controllerToken);
      console.log(`    - ${controllerName}`);

      if (controller.metatype) {
        const dependencies: DependencyType[] =
          Reflect.getMetadata('design:paramtypes', controller.metatype) || [];
        if (dependencies.length > 0) {
          console.log(
            `      ↳ Dependencies:`,
            dependencies.map((dep: DependencyType) => dep?.name || 'Unknown'),
          );
        }
      }
    }
  }

  analyzeSpecificService(serviceName: string) {
    console.log(`\n=== Analyzing ${serviceName} ===`);

    for (const [moduleKey, module] of this.modulesContainer.entries()) {
      const moduleName = this.getModuleName(module, moduleKey);

      for (const [providerToken, provider] of module.providers.entries()) {
        const tokenName = this.getTokenName(providerToken);

        if (tokenName === serviceName || tokenName?.includes(serviceName)) {
          console.log(`Found ${serviceName} in module: ${moduleName}`);
          console.log(`Provider type:`, provider.scope);
          console.log(`Instance:`, provider.instance?.constructor.name);

          if (provider.metatype) {
            const dependencies: DependencyType[] =
              Reflect.getMetadata('design:paramtypes', provider.metatype) || [];
            console.log(
              `Dependencies:`,
              dependencies.map((dep: DependencyType) => dep?.name || 'Unknown'),
            );
          }
        }
      }
    }
  }

  private getTokenName(token: ProviderToken): string {
    if (typeof token === 'string') {
      return token;
    }
    if (typeof token === 'symbol') {
      return token.toString();
    }
    if (token && typeof token === 'function') {
      return token.name || 'Anonymous';
    }
    if (token && typeof token === 'object' && 'name' in token) {
      return (token as { name: string }).name;
    }
    return token?.toString() || 'Unknown';
  }

  private getModuleName(module: Module, moduleKey: string): string {
    // Try to get the module class name
    if (module.metatype && module.metatype.name) {
      return module.metatype.name;
    }

    // Fallback to the module key (hash)
    return `Unknown Module (${moduleKey.substring(0, 8)}...)`;
  }

  analyzeMultipleInstanceIssues() {
    console.log('\n🚨 === MULTIPLE INSTANCE ANALYSIS ===');
    console.log(
      '⚠️  Checking for services that might have multiple instances...\n',
    );

    const serviceInstances = new Map<string, ServiceInstance[]>();

    for (const [moduleKey, module] of this.modulesContainer.entries()) {
      const moduleName = this.getModuleName(module, moduleKey);

      for (const [providerToken, provider] of module.providers.entries()) {
        const tokenName = this.getTokenName(providerToken);

        if (provider.instance) {
          if (!serviceInstances.has(tokenName)) {
            serviceInstances.set(tokenName, []);
          }

          const instances = serviceInstances.get(tokenName);
          if (!instances) {
            throw new Error(
              `Failed to track service instances for ${tokenName}`,
            );
          }
          instances.push({
            module: moduleName,
            instance: provider.instance as object,
            scope: provider.scope?.toString() || 'DEFAULT',
          });
        }
      }
    }

    // Report services with multiple instances
    let foundIssues = false;
    for (const [serviceName, instances] of serviceInstances.entries()) {
      if (instances.length > 1) {
        foundIssues = true;
        console.log(`🔥 MULTIPLE INSTANCES: ${serviceName}`);
        instances.forEach((instance, index) => {
          const instanceId = Object.prototype.hasOwnProperty.call(
            instance.instance,
            'constructor',
          )
            ? (instance.instance as { constructor: { name: string } })
                .constructor.name
            : 'Unknown';
          console.log(
            `   ${index + 1}. Module: ${instance.module} | Scope: ${instance.scope} | Instance: ${instanceId}`,
          );
        });
        console.log('');
      }
    }

    if (!foundIssues) {
      console.log(
        '✅ No obvious multiple instance issues found in current context.',
      );
    } else {
      console.log('💡 TIP: Multiple instances can cause issues with:');
      console.log('   - Event publishers sending duplicate events');
      console.log('   - Singleton state being inconsistent');
      console.log('   - Resource leaks (DB connections, etc.)');
      console.log('   - Memory usage issues');
    }

    console.log('\n🔍 Consider consolidating to a single application context.');
    console.log('📚 See: https://docs.nestjs.com/application-context\n');
  }
}
