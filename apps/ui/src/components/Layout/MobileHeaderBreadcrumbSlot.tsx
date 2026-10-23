import React, { createContext, useContext, useState } from "react";
import { Box } from "@mui/material";

/**
 * Bridges page-specific breadcrumbs (rendered deep inside each page's tree) into
 * the centrally-rendered, persistent mobile header. The Layout renders a single
 * {@link MobileHeaderBreadcrumbSlot} inside its pinned header on ≤ md; descendants
 * read the registered slot element via {@link useMobileHeaderBreadcrumbSlot} and
 * portal their breadcrumb content into it — so the 42 page call sites stay untouched.
 */
const MobileHeaderBreadcrumbSlotContext = createContext<HTMLElement | null>(
  null,
);

const MobileHeaderBreadcrumbSetterContext = createContext<
  (element: HTMLElement | null) => void
>(() => {});

export interface MobileHeaderBreadcrumbProviderProps {
  children: React.ReactNode;
}

export const MobileHeaderBreadcrumbProvider: React.FC<
  MobileHeaderBreadcrumbProviderProps
> = ({ children }) => {
  const [slotElement, setSlotElement] = useState<HTMLElement | null>(null);

  return (
    <MobileHeaderBreadcrumbSetterContext.Provider value={setSlotElement}>
      <MobileHeaderBreadcrumbSlotContext.Provider value={slotElement}>
        {children}
      </MobileHeaderBreadcrumbSlotContext.Provider>
    </MobileHeaderBreadcrumbSetterContext.Provider>
  );
};

/**
 * Returns the live header slot element to portal into, or `null` when no slot is
 * mounted (e.g. on desktop or outside a {@link MobileHeaderBreadcrumbProvider}).
 */
export const useMobileHeaderBreadcrumbSlot = (): HTMLElement | null =>
  useContext(MobileHeaderBreadcrumbSlotContext);

/**
 * The portal target rendered in the shrinkable center column of the pinned mobile
 * header. Width bounding engages the current title's ellipsis instead of allowing
 * it to displace the symmetric Menu and Activity rails.
 */
export const MobileHeaderBreadcrumbSlot: React.FC = () => {
  const setSlotElement = useContext(MobileHeaderBreadcrumbSetterContext);

  return (
    <Box
      ref={setSlotElement}
      data-testid="mobile-header-breadcrumb-slot"
      sx={{
        width: "100%",
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "visible",
      }}
    />
  );
};
