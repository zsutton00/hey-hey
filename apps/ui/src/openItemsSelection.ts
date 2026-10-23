import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  openItemSelectionKey,
  resolveVisibleOpenItemSelection,
} from "@hey-hey/ui-common/utils";
import type { OpenItem, OpenItemIdentity } from "./contexts/openItemsModel";

const EMPTY_SELECTION: readonly OpenItem[] = [];

export function useOpenItemsSelection(
  scope: string,
  visible: readonly OpenItem[]
) {
  const [state, setState] = useState<{
    scope: string;
    identities: readonly OpenItemIdentity[];
    mode: boolean;
    anchor: string | null;
  }>({
    scope,
    identities: [],
    mode: false,
    anchor: null,
  });
  const selected = useMemo(
    () =>
      resolveVisibleOpenItemSelection(
        visible,
        state.scope === scope ? state.identities : []
      ),
    [scope, state, visible]
  );
  useEffect(() => {
    setState((previous) => {
      if (
        previous.scope === scope &&
        previous.identities.length === selected.length &&
        previous.identities.every(
          (item, index) =>
            openItemSelectionKey(item) === openItemSelectionKey(selected[index])
        )
      )
        return previous;
      return { scope, identities: selected, mode: previous.scope === scope && selected.length > 0 && previous.mode, anchor: previous.scope === scope ? previous.anchor : null };
    });
  }, [scope, selected]);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const toggle = useCallback(
    (item: OpenItemIdentity, range = false) => {
      setState((previous) => {
        const current = resolveVisibleOpenItemSelection(
          visibleRef.current,
          previous.scope === scope ? previous.identities : []
        );
        const key = openItemSelectionKey(item);
        const targetIndex = visibleRef.current.findIndex((entry) => openItemSelectionKey(entry) === key);
        const anchorIndex = visibleRef.current.findIndex((entry) => openItemSelectionKey(entry) === previous.anchor);
        if (range && targetIndex >= 0 && anchorIndex >= 0) {
          const rangeItems = visibleRef.current.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1);
          const keys = new Set([...current, ...rangeItems].map(openItemSelectionKey));
          return { scope, identities: visibleRef.current.filter((entry) => keys.has(openItemSelectionKey(entry))), mode: true, anchor: previous.anchor };
        }
        return {
          scope,
          mode: true,
          anchor: key,
          identities: current.some(
            (entry) => openItemSelectionKey(entry) === key
          )
            ? current.filter((entry) => openItemSelectionKey(entry) !== key)
            : [...current, item],
        };
      });
    },
    [scope]
  );
  const enter = useCallback((item: OpenItemIdentity) => {
    setState({ scope, identities: [item], mode: true, anchor: openItemSelectionKey(item) });
  }, [scope]);
  const clear = useCallback(() => {
    setState({ scope, identities: [], mode: false, anchor: null });
  }, [scope]);
  return { selected: selected.length ? selected : EMPTY_SELECTION, mode: state.scope === scope && state.mode, toggle, enter, clear };
}
