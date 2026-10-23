export type SeverityLevel = "low" | "medium" | "high";

export type SeverityChipColor =
  | "default"
  | "primary"
  | "secondary"
  | "success"
  | "warning";

export interface SeverityDisplayConfig {
  label: string;
  color: SeverityChipColor;
}

export const SEVERITY_CONFIG: Record<SeverityLevel, SeverityDisplayConfig> = {
  low: { label: "Low", color: "default" },
  medium: { label: "Medium", color: "warning" },
  high: { label: "High", color: "secondary" },
};
