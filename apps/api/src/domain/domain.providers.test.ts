import { SERVICE_TOKEN_FACTORY } from '../services/proposal/pending-edge.service';
import { OrganizationProjectEntitlementService } from '../services/organization-project-entitlement.service';
import { WorkItemTypeLifecycleService } from '../services/tasks/work-item-type-lifecycle.service';
import { DOMAIN_EXPORTS } from './domain.providers';

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
});
