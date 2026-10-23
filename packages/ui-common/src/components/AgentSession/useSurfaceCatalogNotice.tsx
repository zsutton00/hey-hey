import type { ReactNode } from "react";
import {
  CatalogMachineRequiredAlert,
  CatalogUnavailableAlert,
} from "./RuntimeModelSelector";
import {
  type RuntimeModelCatalogSource,
  useRuntimeModelCatalog,
} from "./useRuntimeModelCatalog";

/**
 * For a surface that has no model picker but still launches with the
 * addressed CLI's models: the alert to show when that catalog cannot be had
 * (no machine, or the read failed), else null. While the catalog is loading
 * the surface keeps its own loading state.
 */
export const useSurfaceCatalogNotice = (
  catalogSource: RuntimeModelCatalogSource | null,
  testIdPrefix: string,
): ReactNode | null => {
  const state = useRuntimeModelCatalog(catalogSource);
  if (state.status === "error") {
    return (
      <CatalogUnavailableAlert
        testIdPrefix={testIdPrefix}
        error={state.error}
      />
    );
  }
  if (catalogSource === null && state.status === "idle") {
    return <CatalogMachineRequiredAlert testIdPrefix={testIdPrefix} />;
  }
  return null;
};
