import { useTranslation } from "react-i18next";

import type { AveragedMeasure, RepeatSummary } from "./evalResultsView";

export type Format = (value: number) => string;

export const formatCount: Format = (value) => String(Math.round(value));

/** Formats a measure; anything nobody reported reads "not reported". */
export const useMeasureFormatter = (): ((
  measure: AveragedMeasure,
  format: Format,
) => string) => {
  const { t } = useTranslation();
  return (measure, format) => {
    if (measure.value === null) return t("eval.results.notReported");
    const value = format(measure.value);
    return measure.reported < measure.total
      ? t("eval.results.partial", {
          value,
          reported: measure.reported,
          total: measure.total,
        })
      : value;
  };
};

/** "3.6", or "3.6 ± 0.6" once two or more attempts were scored. */
export const useQualityFormatter = (): ((
  quality: RepeatSummary["quality"],
) => string) => {
  const { t } = useTranslation();
  return ({ mean, spread }) => {
    if (mean === null) return t("eval.results.notReported");
    return spread === null
      ? mean.toFixed(1)
      : t("eval.results.qualitySpread", {
          mean: mean.toFixed(1),
          spread: spread.toFixed(1),
        });
  };
};
