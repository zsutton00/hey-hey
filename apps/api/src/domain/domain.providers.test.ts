import { ClassProvider, Provider } from '@nestjs/common';
import { SERVICE_TOKEN_FACTORY } from '../services/proposal/pending-edge.service';
import { OrganizationProjectEntitlementService } from '../services/organization-project-entitlement.service';
import { WorkItemTypeLifecycleService } from '../services/tasks/work-item-type-lifecycle.service';
import { DOMAIN_EXPORTS, DOMAIN_SERVICES } from './domain.providers';

describe('domain providers', () => {
  it('exports the service token factory for consumers outside the domain module', () => {
    expect(DOMAIN_EXPORTS).toContain(SERVICE_TOKEN_FACTORY);
  });

  it('exports the work-item type lifecycle owner', () => {
    expect(DOMAIN_EXPORTS).toContain(WorkItemTypeLifecycleService);
  });

  it('exports the organization project entitlement service', () => {
    expect(DOMAIN_EXPORTS).toContain(OrganizationProjectEntitlementService);
  });

  it('selects the hosted entitlement service unless the process is a local application', () => {
    expect(entitlementProvider(DOMAIN_SERVICES).useClass).toBe(
      OrganizationProjectEntitlementService,
    );
  });

  it('selects the local entitlement service in a local application', () => {
    const previous = { ...process.env };
    process.env.DEPLOYMENT_ENVIRONMENT = 'local';
    process.env.HEYHEY_LOCAL_APPLICATION = 'true';
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const local = require('./domain.providers') as {
          DOMAIN_SERVICES: Provider[];
        };
        expect(
          entitlementProvider(local.DOMAIN_SERVICES, true).useClass.name,
        ).toBe('LocalOrganizationProjectEntitlementService');
      });
    } finally {
      process.env = previous;
    }
  });
});

// Module-registry-isolated copies have distinct class identities, so match those by name.
function entitlementProvider(
  providers: Provider[],
  byName = false,
): ClassProvider {
  const provider = providers.find(
    (candidate): candidate is ClassProvider =>
      'provide' in candidate &&
      (byName
        ? (candidate.provide as { name?: string }).name ===
          OrganizationProjectEntitlementService.name
        : candidate.provide === OrganizationProjectEntitlementService),
  );
  if (!provider) {
    throw new Error('entitlement provider not declared');
  }
  return provider;
}
