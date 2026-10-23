import {
  getCapabilityCatalogLoadState,
  type CapabilityCatalogRow,
} from '../../../../../packages/ui-common/src/components/AgentSession/capabilityCatalog';
import {
  CliReadRuntimeModelCatalogModelEffortsEnum,
  CliReadRuntimeModelCatalogProviderProviderEnum,
  type CliReadRuntimeModelCatalogProvider,
  type CliReadRuntimeModelCatalogResult,
} from '../../shared/agent-bridge-contract/generated/api';
import type { ServerLogger } from '../logger';

const EFFORT_IDS: readonly string[] = Object.values(CliReadRuntimeModelCatalogModelEffortsEnum);
const PROVIDER_IDS: readonly string[] = Object.values(
  CliReadRuntimeModelCatalogProviderProviderEnum,
);

const isEffort = (value: string): value is CliReadRuntimeModelCatalogModelEffortsEnum =>
  EFFORT_IDS.includes(value);

const isProvider = (value: string): value is CliReadRuntimeModelCatalogProviderProviderEnum =>
  PROVIDER_IDS.includes(value);

const toProvider = (
  row: CapabilityCatalogRow,
  logger: ServerLogger,
): CliReadRuntimeModelCatalogProvider | null => {
  const provider: string = row.provider;
  if (!isProvider(provider)) {
    logger.warn('runtime_model_catalog.provider.dropped', {
      provider,
      reason: 'the model catalog read does not carry this provider',
    });
    return null;
  }
  return {
    provider,
    models: row.models.map((model) => ({
      id: model.id,
      label: model.label,
      efforts: model.efforts.filter(
        (effort): effort is CliReadRuntimeModelCatalogModelEffortsEnum => {
          if (isEffort(effort)) return true;
          logger.warn('runtime_model_catalog.effort.dropped', {
            provider,
            model: model.id,
            effort,
            reason: 'the model catalog read does not carry this reasoning effort',
          });
          return false;
        },
      ),
      ...(model.serviceTiers ? { serviceTiers: [...model.serviceTiers] } : {}),
      ...(model.opencodeModelRef ? { opencodeModelRef: { ...model.opencodeModelRef } } : {}),
    })),
    ...(row.notice === undefined ? {} : { notice: row.notice }),
  };
};

/**
 * The catalog this process built from what each installed provider reported,
 * as the wire result. A provider or effort the wire cannot carry is left out
 * and logged, not a reason to answer nothing. Throws only when no catalog is
 * installed: a read never answers with a built-in stand-in.
 */
export const readRuntimeModelCatalogResult = (
  logger: ServerLogger,
): CliReadRuntimeModelCatalogResult => {
  const state = getCapabilityCatalogLoadState(null);
  if (state.status !== 'ready') {
    throw new Error('The model catalog is not ready.');
  }
  return {
    providers: state.catalog.flatMap((row) => {
      const provider = toProvider(row, logger);
      return provider ? [provider] : [];
    }),
  };
};
