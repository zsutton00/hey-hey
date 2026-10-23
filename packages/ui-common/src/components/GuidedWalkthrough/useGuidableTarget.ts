import { useEffect, useRef } from "react";
import { useGuidedWalkthroughRuntime } from "./guidedWalkthroughRuntime";
import { serializeTargetAddress, type GuidableTargetAddress } from "./types";
import type { TargetElementGetter } from "./GuidableTargetRegistry";

/**
 * Registers the owner's element under `address` while mounted. A null address
 * registers nothing. Re-registers whenever the address identity changes, so a
 * remounted owner reclaims an address a newer owner has since released.
 */
export function useGuidableTarget(
  address: GuidableTargetAddress | null,
  getElement: TargetElementGetter
): void {
  const runtime = useGuidedWalkthroughRuntime();
  const getElementRef = useRef(getElement);
  getElementRef.current = getElement;
  const addressRef = useRef(address);
  addressRef.current = address;
  const key = address === null ? null : serializeTargetAddress(address);
  const targets = runtime?.targets ?? null;

  useEffect(() => {
    const current = addressRef.current;
    if (targets === null || key === null || current === null) return;
    return targets.register(current, () => getElementRef.current());
  }, [targets, key]);
}
