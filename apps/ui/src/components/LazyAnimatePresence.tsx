import { Suspense, lazy, type ComponentProps } from "react";

const AnimatePresence = lazy(() =>
  import("motion/react").then((m) => ({ default: m.AnimatePresence })),
);

type AnimatePresenceProps = ComponentProps<typeof AnimatePresence>;

export const LazyAnimatePresence = (props: AnimatePresenceProps): React.ReactElement => (
  <Suspense fallback={<>{props.children}</>}>
    <AnimatePresence {...props} />
  </Suspense>
);
