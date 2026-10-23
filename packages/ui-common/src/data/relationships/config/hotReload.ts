import { loadConfig } from "./configLoader";

export function setupHotReload(configModulePath: string): void {
  if (!import.meta.hot) return;

  import.meta.hot.accept(configModulePath, (mod) => {
    if (!mod) return;

    const raw = mod.default ?? mod;
    try {
      loadConfig(raw);
      console.info("[invalidation-config] Hot-reloaded successfully");
    } catch (err) {
      console.error("[invalidation-config] Hot-reload validation failed:", err);
    }
  });
}
