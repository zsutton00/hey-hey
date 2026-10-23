import { Injectable } from '@nestjs/common';
import { FeatureListLifecycleService } from '../../../services/feature-list/feature-list-lifecycle.service';
import { REPOSITORY_IMPORT_NODES } from '../../constants/node-ids';
import { OnboardingGenerateFeaturesNode } from '../onboarding/onboarding-generate-features.node';

/** Import-owned adapter around the shared Feature proposal lifecycle. */
@Injectable()
export class RepositoryImportGenerateFeaturesNode extends OnboardingGenerateFeaturesNode {
  readonly id = REPOSITORY_IMPORT_NODES.GENERATE_FEATURES;

  constructor(featureListLifecycle: FeatureListLifecycleService) {
    super(featureListLifecycle);
  }
}
