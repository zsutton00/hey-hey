import { describe, expect, it, vi } from "vitest";
import { createElement, createRef } from "react";
import {
  copyPersistentModalRequest,
  isPlainOpeningData,
} from "./persistentModalRequest";
import { createModalStore } from "../../state/modalDomain";
import { ModalType } from "./modalTypes";

const request = () => ({
  type: "preview" as const,
  organizationId: "org",
  projectId: "project",
  target: { entityType: "task" as const, entityId: "task" },
});
describe("persistent modal opening boundary", () => {
  it.each([
    () => {},
    { nested: [() => {}] },
    createElement("div"),
    createRef(),
    new Date(),
    new Map(),
    new (class Value {})(),
    Symbol("value"),
    { nested: { current: null } },
  ])("rejects executable or opaque values at every depth", (value) => {
    expect(isPlainOpeningData({ nested: [{ value }] })).toBe(false);
    expect(copyPersistentModalRequest({ ...request(), value })).toBeNull();
  });
  it("rejects accessors without executing them and rejects extra schema fields", () => {
    const get = vi.fn();
    const input = Object.defineProperty(request(), "callback", { get });
    expect(copyPersistentModalRequest(input)).toBeNull();
    expect(get).not.toHaveBeenCalled();
    const typedAccessor = Object.defineProperty(request(), "type", { get });
    expect(() => createModalStore().getState().open(typedAccessor)).toThrow(
      "Invalid modal opening request",
    );
    expect(get).not.toHaveBeenCalled();
    expect(
      copyPersistentModalRequest({ ...request(), metadata: { data: true } }),
    ).toBeNull();
  });
  it("rejects cycles and custom array properties", () => {
    const input: { child?: unknown } = {};
    input.child = input;
    expect(isPlainOpeningData(input)).toBe(false);
    const array = Object.assign([1], { callback: () => {} });
    expect(isPlainOpeningData(array)).toBe(false);
  });
  it("copies nested values so callers cannot change a retained subject", () => {
    const input = request();
    const copy = copyPersistentModalRequest(input);
    input.target.entityId = "other";
    expect(copy).toEqual({ ...request() });
    expect(copy).not.toBe(input);
  });
  it("preserves independent identities, restores without reseeding, and removes only accepted close", () => {
    const store = createModalStore();
    store.getState().open(request());
    const first = store.getState().instances[0];
    store.getState().minimize(first.id, "Preview");
    store
      .getState()
      .open({ type: "triage", organizationId: "org", projectId: "project" });
    const second = store.getState().instances[1];
    store.getState().minimize(second.id, "Triage");
    store.getState().open(request());
    expect(store.getState().instances).toHaveLength(2);
    expect(store.getState().instances[0]).toMatchObject({
      id: first.id,
      minimized: false,
    });
    expect(store.getState().instances[1].minimized).toBe(true);
    store.getState().acceptedClose(first.id);
    expect(store.getState().instances).toEqual([
      expect.objectContaining({ id: second.id, minimized: true }),
    ]);
  });
  it("keeps legacy callbacks intact and ineligible", () => {
    const store = createModalStore();
    const onSelect = vi.fn();
    store.getState().open({
      type: ModalType.ADVANCED_SEARCH,
      organizationId: "org",
      onSelect,
    });
    const instance = store.getState().instances[0];
    store.getState().minimize(instance.id, "Search");
    expect(store.getState().instances[0]).toMatchObject({
      minimized: false,
      persistent: false,
      config: { onSelect },
    });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
