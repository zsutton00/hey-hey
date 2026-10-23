import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { useMediaQuery } from "@mui/material";
import { transitions } from "../../animations/variants";
import { SharedLoading } from "./SharedLoading";
import { useDataStateLoading } from "./dataStateLoadingContext";

export interface DataStateBoundaryProps {
  loading: boolean;
  fetched: boolean;
  children: ReactNode;
  initialContent?: ReactNode;
  presentation?: {
    queryIdentity: string;
    hasUsableContent: boolean;
    transition: "opacity" | "opacity-height";
  };
}

export const DataStateBoundary = ({
  loading,
  fetched,
  children,
  initialContent = <SharedLoading />,
  presentation,
}: DataStateBoundaryProps) => {
  const pending = (loading || !fetched) && !presentation?.hasUsableContent;
  const coordinated = useDataStateLoading(pending);
  if (presentation) {
    return (
      <PresentedContent
        key={presentation.queryIdentity}
        pending={pending}
        initialContent={coordinated ? null : initialContent}
        heightMotion={presentation.transition === "opacity-height"}
      >
        {children}
      </PresentedContent>
    );
  }
  if (pending) {
    return coordinated ? null : initialContent;
  }

  return children;
};

const PresentedContent = ({
  pending,
  initialContent,
  heightMotion,
  children,
}: {
  pending: boolean;
  initialContent: ReactNode;
  heightMotion: boolean;
  children: ReactNode;
}) => {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const content = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const element = content.current;
    if (!element || !heightMotion || reducedMotion) return;
    const measure = () => setHeight(element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [heightMotion, reducedMotion, pending]);
  return (
    <motion.div
      data-testid="data-state-presentation"
      aria-busy={pending}
      initial={false}
      animate={{ height: heightMotion && !reducedMotion ? height : "auto" }}
      transition={reducedMotion ? { duration: 0 } : transitions.fast}
      style={{ overflow: "hidden", position: "relative" }}
    >
      <div ref={content}>
        {pending && initialContent}
        <motion.div
          inert={pending}
          aria-hidden={pending}
          initial={{ opacity: pending ? 0 : 1 }}
          animate={{ opacity: pending ? 0 : 1 }}
          transition={reducedMotion ? { duration: 0 } : transitions.fast}
          style={
            pending
              ? {
                  position: "absolute",
                  visibility: "hidden",
                  pointerEvents: "none",
                }
              : undefined
          }
        >
          {children}
        </motion.div>
      </div>
    </motion.div>
  );
};
