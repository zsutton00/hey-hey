import { SvgIcon } from "@mui/material";
import type { SvgIconProps } from "@mui/material";

export interface ContextIconProps extends SvgIconProps {
  /** Gauge fill from 0 (empty) to 1 (full); clamped. */
  gaugeLevel?: number;
}

/** Context-window gauge: a dial arc that fills as the context grows. */
export const ContextIcon = ({ gaugeLevel = 0, ...props }: ContextIconProps) => {
  const level = Math.min(Math.max(gaugeLevel, 0), 1);
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path d="M0 0h24v24H0z" fill="none" />
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.5"
      >
        <path d="M1.5 16.5a10.5 10.5 0 0 1 21 0" opacity={0.3} />
        {level > 0 ? (
          <path
            d="M1.5 16.5a10.5 10.5 0 0 1 21 0"
            pathLength={100}
            strokeDasharray={`${String(level * 100)} 100`}
            data-testid="context-gauge-fill"
          />
        ) : null}
      </g>
      <circle cx="12" cy="16.5" r="2" fill="currentColor" />
    </SvgIcon>
  );
};
