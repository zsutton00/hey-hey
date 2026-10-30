import { describe, expect, it, vi } from 'vitest';
import type { MachineOptions } from '../options/machine-options-store';
import { OptionsSource, type OptionsStore } from './options-source';

const fakeStore = (intentFirst = false, remoteToolCallViewing = true) => {
  let saved: MachineOptions = { intentFirst, remoteToolCallViewing, jevEnabled: true };
  const store = {
    read: vi.fn<OptionsStore['read']>(() => Promise.resolve(saved)),
    update: vi.fn<OptionsStore['update']>((patch) => {
      saved = { ...saved, ...patch };
      return Promise.resolve(saved);
    }),
  };
  return store;
};

describe('OptionsSource', () => {
  it('starts unset, then publishes the saved choice once it is read', async () => {
    const source = new OptionsSource(fakeStore(true), true, vi.fn());
    const observer = vi.fn();

    expect(source.observe(observer).snapshot).toEqual({
      intentFirst: null,
      remoteToolCallViewing: null,
      jevEnabled: null,
      jevKeyDefined: true,
    });
    await vi.waitFor(() =>
      expect(observer).toHaveBeenLastCalledWith({
        intentFirst: true,
        remoteToolCallViewing: true,
        jevEnabled: true,
        jevKeyDefined: true,
      }),
    );
  });

  it('saves a change, then publishes it', async () => {
    const store = fakeStore(false);
    const source = new OptionsSource(store, true, vi.fn());
    const observer = vi.fn();
    source.observe(observer);
    await vi.waitFor(() =>
      expect(observer).toHaveBeenLastCalledWith({
        intentFirst: false,
        remoteToolCallViewing: true,
        jevEnabled: true,
        jevKeyDefined: true,
      }),
    );

    await source.setIntentFirst(true);

    expect(store.update).toHaveBeenCalledWith({ intentFirst: true });
    expect(observer).toHaveBeenLastCalledWith({
      intentFirst: true,
      remoteToolCallViewing: true,
      jevEnabled: true,
      jevKeyDefined: true,
    });
  });

  it('keeps a saved change when an older read finishes afterwards', async () => {
    const store = fakeStore(false);
    let finishRead!: (options: MachineOptions) => void;
    store.read.mockReturnValue(new Promise((resolve) => (finishRead = resolve)));
    const source = new OptionsSource(store, true, vi.fn());
    const observer = vi.fn();
    source.observe(observer);

    await source.setIntentFirst(true);
    finishRead({ intentFirst: false, remoteToolCallViewing: true, jevEnabled: true });
    await Promise.resolve();

    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenLastCalledWith({
      intentFirst: true,
      remoteToolCallViewing: true,
      jevEnabled: true,
      jevKeyDefined: true,
    });
  });

  it('stops publishing to an observer that unsubscribed', async () => {
    const source = new OptionsSource(fakeStore(), true, vi.fn());
    const observer = vi.fn();
    const { unsubscribe } = source.observe(observer);
    await vi.waitFor(() => expect(observer).toHaveBeenCalled());
    unsubscribe();
    observer.mockClear();

    await source.setIntentFirst(true);

    expect(observer).not.toHaveBeenCalled();
  });

  it('reports a choice that cannot be read and leaves it unset', async () => {
    const store = fakeStore();
    store.read.mockRejectedValue(new Error('corrupt options'));
    const report = vi.fn();
    const observer = vi.fn();
    new OptionsSource(store, true, report).observe(observer);

    await vi.waitFor(() =>
      expect(report).toHaveBeenCalledWith('presentation.options_read_failed', {
        error: 'corrupt options',
      }),
    );
    expect(observer).not.toHaveBeenCalled();
  });

  it('rejects a failed write and keeps showing the previous choice', async () => {
    const store = fakeStore(false);
    const source = new OptionsSource(store, true, vi.fn());
    const observer = vi.fn();
    source.observe(observer);
    await vi.waitFor(() => expect(observer).toHaveBeenCalled());
    observer.mockClear();
    store.update.mockRejectedValue(new Error('disk full'));

    await expect(source.setIntentFirst(true)).rejects.toThrow('disk full');

    expect(observer).not.toHaveBeenCalled();
    expect(source.observe(vi.fn()).snapshot).toEqual({
      intentFirst: false,
      remoteToolCallViewing: true,
      jevEnabled: true,
      jevKeyDefined: true,
    });
  });

  it('saves the viewing choice without touching Intent-first', async () => {
    const store = fakeStore(true, true);
    const source = new OptionsSource(store, true, vi.fn());
    const observer = vi.fn();
    source.observe(observer);
    await vi.waitFor(() => expect(observer).toHaveBeenCalled());

    await source.setRemoteToolCallViewing(false);

    expect(store.update).toHaveBeenCalledWith({ remoteToolCallViewing: false });
    expect(observer).toHaveBeenLastCalledWith({
      intentFirst: true,
      remoteToolCallViewing: false,
      jevEnabled: true,
      jevKeyDefined: true,
    });
  });

  it('reports a missing Jev key and keeps the saved choice', async () => {
    const store = fakeStore(true, true);
    const source = new OptionsSource(store, false, vi.fn());
    const observer = vi.fn();
    source.observe(observer);
    await vi.waitFor(() =>
      expect(observer).toHaveBeenLastCalledWith({
        intentFirst: true,
        remoteToolCallViewing: true,
        jevEnabled: true,
        jevKeyDefined: false,
      }),
    );
    expect(store.update).not.toHaveBeenCalled();
  });

  it('saves the Jev without touching the other options', async () => {
    const store = fakeStore(true, true);
    const source = new OptionsSource(store, true, vi.fn());
    const observer = vi.fn();
    source.observe(observer);
    await vi.waitFor(() => expect(observer).toHaveBeenCalled());

    await source.setJevEnabled(false);

    expect(store.update).toHaveBeenCalledWith({ jevEnabled: false });
    expect(observer).toHaveBeenLastCalledWith({
      intentFirst: true,
      remoteToolCallViewing: true,
      jevEnabled: false,
      jevKeyDefined: true,
    });
  });
});
