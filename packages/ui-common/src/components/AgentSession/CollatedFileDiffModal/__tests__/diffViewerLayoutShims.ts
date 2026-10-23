// jsdom reports zero layout for every element. That breaks the diff viewer's
// virtualizer in three ways: the viewport collapses to 0×0 (no rows windowed),
// the pane's `offsetTop` stays 0 (so `scrollMargin` is 0 and the auto-scroll
// effect bails), and `scrollHeight - clientHeight` is 0 (so any scrollToIndex
// offset is clamped back to 0). The shims here override the relevant layout
// getters on HTMLElement.prototype so the virtualizer sees a real, scrollable
// viewport. Call from a test's `beforeEach`, and call the returned handle's
// `restore()` from `afterEach`, so the shim does not leak into other suites.
//
// The shim also drives the dynamic row-measurement path in FullFileSplitView:
// the virtualizer's `measureElement` reads `el.getBoundingClientRect().height`,
// which jsdom returns as 0. Tests can register per-row, per-pane heights via
// `setRowHeights` so the union-and-align behavior actually exercises. A
// controllable ResizeObserver mock replaces the global no-op so tests can
// re-fire measurements after a simulated width change (`triggerResizeAll`).

const SHIMMED_OFFSET_HEIGHT = 800;
const SHIMMED_OFFSET_WIDTH = 1200;
const SHIMMED_OFFSET_TOP = 24;
const SHIMMED_CLIENT_HEIGHT = 800;
const SHIMMED_SCROLL_HEIGHT = 10000;

const DEFAULT_MEASURED_ROW_HEIGHT_PX = 19.2;

interface ShimmedProperty {
  name: string;
  value: number;
}

const SHIMMED_PROPERTIES: ShimmedProperty[] = [
  { name: "offsetHeight", value: SHIMMED_OFFSET_HEIGHT },
  { name: "offsetWidth", value: SHIMMED_OFFSET_WIDTH },
  { name: "offsetTop", value: SHIMMED_OFFSET_TOP },
  { name: "clientHeight", value: SHIMMED_CLIENT_HEIGHT },
  { name: "scrollHeight", value: SHIMMED_SCROLL_HEIGHT },
];

interface RowHeightSpec {
  old?: number | readonly number[];
  new?: number | readonly number[];
  vertical?: number | readonly number[];
}

type RowHeightsTable =
  Map<number, RowHeightSpec> | Record<number, RowHeightSpec>;

export interface DiffViewerShimHandle {
  /** Tear down every override and restore the global ResizeObserver. */
  restore: () => void;
  /**
   * Register per-(row index, pane) heights for the next `getBoundingClientRect`
   * call on a row wrapper. Any row whose `data-index`/`data-pane` is not in the
   * table falls back to `DEFAULT_MEASURED_ROW_HEIGHT_PX`.
   */
  setRowHeights: (heights: RowHeightsTable) => void;
  /**
   * Re-fire each currently-observed element's ResizeObserver callback. The
   * virtualizer treats this as a layout change and calls `measureElement`
   * again, so tests can simulate a width-driven re-wrap by mutating
   * `setRowHeights` and then calling this helper.
   */
  triggerResizeAll: () => void;
}

const toRowHeightMap = (
  heights: RowHeightsTable,
): Map<number, RowHeightSpec> => {
  if (heights instanceof Map) return new Map(heights);
  const next = new Map<number, RowHeightSpec>();
  for (const [key, value] of Object.entries(heights)) {
    next.set(Number(key), value);
  }
  return next;
};

interface ObservedEntry {
  target: Element;
  callback: ResizeObserverCallback;
  observer: ResizeObserver;
}

export const installDiffViewerLayoutShims = (): DiffViewerShimHandle => {
  const propertyRestorers = SHIMMED_PROPERTIES.map(({ name, value }) => {
    const original = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      name,
    );
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get: () => value,
    });
    return (): void => {
      if (original) {
        Object.defineProperty(HTMLElement.prototype, name, original);
      } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)[
          name
        ];
      }
    };
  });

  let rowHeights = new Map<number, RowHeightSpec>();
  const rowMeasurementCounts = new Map<string, number>();

  const resolveRowHeight = (
    index: number,
    pane: "old" | "new" | "vertical",
  ): number => {
    const value = rowHeights.get(index)?.[pane];
    if (value === undefined) return DEFAULT_MEASURED_ROW_HEIGHT_PX;
    if (typeof value === "number") return value;

    const key = `${String(index)}:${pane}`;
    const measurementCount = rowMeasurementCounts.get(key) ?? 0;
    rowMeasurementCounts.set(key, measurementCount + 1);
    return value[Math.min(measurementCount, value.length - 1)];
  };

  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect =
    function patchedGetBoundingClientRect(this: Element): DOMRect {
      const el = this as HTMLElement;
      const indexAttr = el.dataset?.index;
      const paneAttr = el.dataset?.pane;
      if (
        indexAttr !== undefined &&
        (paneAttr === "old" || paneAttr === "new" || paneAttr === "vertical")
      ) {
        const height = resolveRowHeight(Number(indexAttr), paneAttr);
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: SHIMMED_OFFSET_WIDTH,
          bottom: height,
          width: SHIMMED_OFFSET_WIDTH,
          height,
          toJSON: () => ({}),
        };
      }
      return originalGetBoundingClientRect.call(this);
    };

  const observed: ObservedEntry[] = [];
  const originalResizeObserver = (
    globalThis as unknown as { ResizeObserver?: typeof ResizeObserver }
  ).ResizeObserver;

  class ControllableResizeObserver implements ResizeObserver {
    private callback: ResizeObserverCallback;
    private targets = new Set<Element>();

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element): void {
      if (this.targets.has(target)) return;
      this.targets.add(target);
      observed.push({ target, callback: this.callback, observer: this });
    }

    unobserve(target: Element): void {
      this.targets.delete(target);
      const idx = observed.findIndex(
        (entry) => entry.target === target && entry.observer === this,
      );
      if (idx !== -1) observed.splice(idx, 1);
    }

    disconnect(): void {
      this.targets.clear();
      for (let i = observed.length - 1; i >= 0; i -= 1) {
        if (observed[i].observer === this) observed.splice(i, 1);
      }
    }
  }

  (
    globalThis as unknown as { ResizeObserver: typeof ResizeObserver }
  ).ResizeObserver =
    ControllableResizeObserver as unknown as typeof ResizeObserver;

  const buildEntryForTarget = (target: Element): ResizeObserverEntry => {
    const rect = target.getBoundingClientRect();
    return {
      target,
      contentRect: rect,
      borderBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
      contentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
      devicePixelContentBoxSize: [
        { inlineSize: rect.width, blockSize: rect.height },
      ],
    } as ResizeObserverEntry;
  };

  const triggerResizeAll = (): void => {
    const snapshot = observed.slice();
    for (const entry of snapshot) {
      entry.callback([buildEntryForTarget(entry.target)], entry.observer);
    }
  };

  const setRowHeights = (heights: RowHeightsTable): void => {
    rowHeights = toRowHeightMap(heights);
    rowMeasurementCounts.clear();
  };

  const restore = (): void => {
    for (const restoreProp of propertyRestorers) restoreProp();
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    if (originalResizeObserver) {
      (
        globalThis as unknown as { ResizeObserver: typeof ResizeObserver }
      ).ResizeObserver = originalResizeObserver;
    } else {
      delete (
        globalThis as unknown as { ResizeObserver?: typeof ResizeObserver }
      ).ResizeObserver;
    }
    observed.length = 0;
    rowHeights.clear();
    rowMeasurementCounts.clear();
  };

  return { restore, setRowHeights, triggerResizeAll };
};
