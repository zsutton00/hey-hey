import { Box, useTheme } from "@mui/material";
import { BarChart } from "@mui/x-charts/BarChart";
import React from "react";

interface CategoricalBarChartDatum {
  [key: string]: string | number;
  accessibleLabel: string;
  label: string;
  metric: string;
  value: number;
}

export interface CategoricalBarChartProps {
  data: readonly CategoricalBarChartDatum[];
  accessibleLabel: string;
  onItemActivate: (dataIndex: number) => void;
}

const CHART_HEIGHT = 168;

const visuallyHidden = {
  border: 0,
  clip: "rect(0 0 0 0)",
  height: "1px",
  margin: "-1px",
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: "1px",
} as const;

export const CategoricalBarChart: React.FC<CategoricalBarChartProps> = ({
  data,
  accessibleLabel,
  onItemActivate,
}) => {
  const theme = useTheme();

  return (
    <Box
      role="group"
      aria-label={accessibleLabel}
      data-testid="organization-home-categorical-chart"
      sx={{ position: "relative", width: "100%", minWidth: 0 }}
    >
      <BarChart
        height={CHART_HEIGHT}
        dataset={data}
        xAxis={[
          {
            dataKey: "label",
            scaleType: "band",
            tickLabelStyle: { fontSize: 11 },
          },
        ]}
        yAxis={[{ min: 0, tickMinStep: 1, width: 32 }]}
        series={[
          {
            dataKey: "value",
            label: "Count",
            color: theme.palette.primary.main,
            barLabel: "value",
            barLabelPlacement: "outside",
          },
        ]}
        slotProps={{
          bar: ({ dataIndex }) => {
            const datum = data[dataIndex];
            if (!datum) {
              return {};
            }

            return {
              "aria-label": datum.accessibleLabel,
              "data-metric": datum.metric,
              "data-testid": "organization-home-metric-bar",
              onKeyDown: (event: React.KeyboardEvent<SVGRectElement>) => {
                if (event.key !== "Enter" && event.key !== " ") {
                  return;
                }

                event.preventDefault();
                onItemActivate(dataIndex);
              },
              role: "button" as const,
              tabIndex: 0,
            };
          },
        }}
        margin={{ top: 28, right: 8, bottom: 0, left: 0 }}
        hideLegend
        grid={{ horizontal: true }}
        skipAnimation
        onItemClick={(_event, item) => onItemActivate(item.dataIndex)}
        sx={{
          "& .MuiBarElement-root": { cursor: "pointer" },
          "& .MuiBarLabel-root": { fontWeight: 700 },
        }}
      />
      <Box component="span" sx={visuallyHidden}>
        {data
          .map(({ label, value }) => `${label}: ${String(value)}`)
          .join(", ")}
      </Box>
    </Box>
  );
};
