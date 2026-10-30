import {
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  useState,
} from "react";
import { HostedModalContext } from "./HostedModalBoundary";
import { ModalMinimizeContext } from "./ModalMinimizeContext";
import { ModalVisibilityContext } from "./ModalVisibilityContext";
import { modalDomain } from "../../state/modalDomain";
import { useModalFocus } from "./useModalFocus";

const emptySubscribe = () => () => {};
export function useModalPresentation(
  open: boolean,
  title: string,
  root: HTMLElement | null,
  _ownerKey: string | undefined,
) {
  const instanceId = useContext(HostedModalContext);
  const parentMinimize = useContext(ModalMinimizeContext);
  const parentHidden = useContext(ModalVisibilityContext);
  const store = modalDomain.useOptionalApi();
  const snapshot = useCallback(
    () =>
      store?.getState().instances.find((item) => item.id === instanceId)
        ?.minimized ?? false,
    [store, instanceId],
  );
  const minimized = useSyncExternalStore(
    store?.subscribe ?? emptySubscribe,
    snapshot,
    snapshot,
  );
  const hidden = minimized || parentHidden;
  const visible = open && !hidden;
  const { saveFocus, rememberFocus } = useModalFocus(visible, root);
  const [childrenReady, setChildrenReady] = useState(false);
  useEffect(() => {
    setChildrenReady(visible);
  }, [visible]);
  const minimizeSelf =
    instanceId && store
      ? () => {
          saveFocus();
          store.getState().minimize(instanceId, title);
        }
      : null;
  return {
    hidden,
    visible,
    minimize: parentMinimize ?? minimizeSelf,
    rememberFocus,
    childrenHidden: hidden || !open || !childrenReady,
  };
}
