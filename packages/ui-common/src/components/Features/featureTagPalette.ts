import { FeatureTag } from "../../api";

export interface FeatureTagPaletteEntry {
  label: string;
  shortLabel: string;
  color: string;
  contrastText: string;
}

export const FEATURE_TAG_PALETTE: Record<FeatureTag, FeatureTagPaletteEntry> = {
  [FeatureTag.Product]: {
    label: "Product",
    shortLabel: "PROD",
    color: "#1565c0",
    contrastText: "#ffffff",
  },
  [FeatureTag.Frontend]: {
    label: "Frontend",
    shortLabel: "FE",
    color: "#6a1b9a",
    contrastText: "#ffffff",
  },
  [FeatureTag.Backend]: {
    label: "Backend",
    shortLabel: "BE",
    color: "#00796b",
    contrastText: "#ffffff",
  },
  [FeatureTag.Infra]: {
    label: "Infra",
    shortLabel: "INFRA",
    color: "#ef6c00",
    contrastText: "#ffffff",
  },
  [FeatureTag.Design]: {
    label: "Design",
    shortLabel: "DSGN",
    color: "#c2185b",
    contrastText: "#ffffff",
  },
  [FeatureTag.Ai]: {
    label: "AI",
    shortLabel: "AI",
    color: "#4527a0",
    contrastText: "#ffffff",
  },
};

export const FEATURE_TAG_VALUES: readonly FeatureTag[] = [
  FeatureTag.Product,
  FeatureTag.Frontend,
  FeatureTag.Backend,
  FeatureTag.Infra,
  FeatureTag.Design,
  FeatureTag.Ai,
];

export const UNSET_FEATURE_TAG_LABEL = "Untagged";
