import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { Box, Collapse, Stack, useMediaQuery } from "@mui/material";
import { BreadcrumbLink } from "../BreadcrumbLink";
import type { BreadcrumbItem } from "../../utils/breadcrumbs";

export const CompactBreadcrumbs: React.FC<{
  ariaLabel: string;
  items: BreadcrumbItem[];
  testIdPrefix: string;
}> = ({ ariaLabel, items, testIdPrefix }) => {
  const [open, setOpen] = useState(false);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const regionId = useId();
  const triggerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number>();

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!open || !content) return;
    const measure = () =>
      setContentHeight(content.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [open]);

  const currentItem = items[items.length - 1];
  const disclosedItems = items.slice(0, -1).reverse();

  const openTrail = () => {
    window.getSelection()?.removeAllRanges();
    setOpen((value) => !value);
  };

  return (
    <Box
      aria-label={ariaLabel}
      data-testid={testIdPrefix}
      sx={{ minWidth: 0, width: "100%", textAlign: "center" }}
    >
      <Box
        ref={triggerRef}
        aria-expanded={items.length > 1 ? open : undefined}
        aria-controls={open ? regionId : undefined}
        onClickCapture={
          items.length > 1
            ? (event) => {
                event.preventDefault();
                event.stopPropagation();
                openTrail();
              }
            : undefined
        }
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (
            items.length > 1 &&
            (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            openTrail();
          }
        }}
        role={items.length > 1 ? "button" : undefined}
        tabIndex={items.length > 1 ? 0 : undefined}
        sx={{ minWidth: 0, width: "100%" }}
      >
        <BreadcrumbLink
          data-testid={`${testIdPrefix}-current`}
          entityId={currentItem.entityId}
          hideTypeLabel
          isCurrentPage={currentItem.isCurrent}
          to={currentItem.to}
          type={currentItem.type}
          typeLabel={currentItem.typeLabel}
        >
          {currentItem.label}
        </BreadcrumbLink>
      </Box>
      <Collapse
        in={open}
        timeout={reducedMotion ? 0 : 220}
        mountOnEnter
        unmountOnExit
        sx={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          borderRadius: "0 0 40px 40px",
          overflow: "hidden",
          bgcolor: "background.default",
          boxShadow: 2,
        }}
      >
        <Box
          id={regionId}
          component="nav"
          inert={!open}
          aria-hidden={!open}
          aria-label={`${ariaLabel} trail`}
          data-testid={`${testIdPrefix}-trail-region`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setOpen(false);
              triggerRef.current?.focus();
            }
          }}
          sx={{
            height: contentHeight,
            maxHeight: "calc(100dvh - 48px)",
            overflowY: "auto",
            overflowX: "hidden",
            overscrollBehavior: "contain",
            bgcolor: "background.default",
            textAlign: "center",
          }}
        >
          <Stack
            ref={contentRef}
            spacing={1.5}
            sx={{
              p: 1.5,
              bgcolor: "background.default",
              minWidth: 0,
              overflowX: "hidden",
            }}
          >
            {disclosedItems.map((item, index) => (
              <Box
                key={`${item.entityId ?? item.label}-${index}`}
                onClick={() => setOpen(false)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 0,
                  minHeight: 44,
                }}
              >
                <BreadcrumbLink
                  data-testid={`${testIdPrefix}-trail-item-${index}`}
                  entityId={item.entityId}
                  hideTypeLabel
                  wrapLabel
                  isCurrentPage={item.isCurrent}
                  to={item.to}
                  type={item.type}
                  typeLabel={item.typeLabel}
                >
                  {item.label}
                </BreadcrumbLink>
              </Box>
            ))}
          </Stack>
        </Box>
      </Collapse>
    </Box>
  );
};
