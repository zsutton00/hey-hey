import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationStartRunRequestDtoProviderEnum } from "../../../api";
import { setCapabilityCatalogForTests } from "../capabilityCatalog";
import { TEST_CAPABILITY_CATALOG } from "../../../test/capabilityCatalogFixture";
import {
  MODEL_SELECTION_FAVORITES_STORAGE_KEY,
  deleteModelSelectionFavorite,
  getModelSelectionFavoritesSnapshot,
  reconcileModelSelectionConfiguration,
  renameModelSelectionFavorite,
  resetModelSelectionFavoritesForTests,
  saveModelSelectionFavorite,
  subscribeModelSelectionFavorites,
} from "../modelSelectionFavorites";

const selection = {
  provider: ConversationStartRunRequestDtoProviderEnum.Codex,
  model: "gpt-5.5",
  reasoningEffort: "high" as const,
  serviceTier: "priority" as const,
};

describe("modelSelectionFavorites", () => {
  beforeEach(() => {
    localStorage.clear();
    setCapabilityCatalogForTests(TEST_CAPABILITY_CATALOG);
    resetModelSelectionFavoritesForTests();
  });

  it("uses an empty collection for malformed and unsupported stored values", () => {
    localStorage.setItem(MODEL_SELECTION_FAVORITES_STORAGE_KEY, "not json");
    resetModelSelectionFavoritesForTests();
    expect(getModelSelectionFavoritesSnapshot()).toEqual([]);

    localStorage.setItem(
      MODEL_SELECTION_FAVORITES_STORAGE_KEY,
      JSON.stringify({ version: 2, favorites: [] }),
    );
    resetModelSelectionFavoritesForTests();
    expect(getModelSelectionFavoritesSnapshot()).toEqual([]);
  });

  it("validates trimmed case-insensitive names and preserves configuration through CRUD", () => {
    expect(saveModelSelectionFavorite("  Daily  ", selection)).toEqual({
      ok: true,
    });
    expect(saveModelSelectionFavorite("daily", selection)).toEqual({
      ok: false,
      reason: "duplicate-name",
    });
    expect(saveModelSelectionFavorite("  ", selection)).toEqual({
      ok: false,
      reason: "required-name",
    });

    const favorite = getModelSelectionFavoritesSnapshot()[0];
    expect(favorite).toMatchObject({ name: "Daily", ...selection });
    expect(renameModelSelectionFavorite(favorite.id, " Focus ")).toEqual({
      ok: true,
    });
    expect(getModelSelectionFavoritesSnapshot()[0]).toEqual({
      ...favorite,
      name: "Focus",
    });
    deleteModelSelectionFavorite(favorite.id);
    expect(getModelSelectionFavoritesSnapshot()).toEqual([]);
  });

  it("notifies same-window subscribers even when storage writes fail", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeModelSelectionFavorites(listener);
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });

    expect(saveModelSelectionFavorite("Local", selection)).toEqual({
      ok: true,
    });
    expect(listener).toHaveBeenCalled();
    expect(getModelSelectionFavoritesSnapshot()).toHaveLength(1);

    setItem.mockRestore();
    unsubscribe();
  });

  it("falls back safely when storage reads are unavailable", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    resetModelSelectionFavoritesForTests();
    expect(getModelSelectionFavoritesSnapshot()).toEqual([]);
    getItem.mockRestore();
  });

  it("adopts changes delivered by another browser context", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeModelSelectionFavorites(listener);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: MODEL_SELECTION_FAVORITES_STORAGE_KEY,
        newValue: JSON.stringify({
          version: 1,
          favorites: [{ id: "external", name: "External", ...selection }],
        }),
      }),
    );

    expect(getModelSelectionFavoritesSnapshot()).toEqual([
      { id: "external", name: "External", ...selection },
    ]);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("reconciles stale fields within a valid provider", () => {
    expect(
      reconcileModelSelectionConfiguration({
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        model: "removed-model",
        reasoningEffort: "max",
        serviceTier: "priority",
      }),
    ).toEqual({
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5.6-sol",
      reasoningEffort: "max",
      serviceTier: "priority",
    });
  });
});
