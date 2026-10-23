import { SvgIcon } from "@mui/material";
import type { SvgIconProps } from "@mui/material";

/** Code review icon used by ActionsCapsule actions. */
export const CodeReviewIcon = (props: SvgIconProps) => (
  <SvgIcon {...props} viewBox="0 0 24 24" width="1em" height="1em">
    <g
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    >
      <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" />
      <path d="M14 3v5h5" />
      <circle cx="10.5" cy="14.5" r="2.75" />
      <path d="m12.5 16.5 2.75 2.75" />
    </g>
  </SvgIcon>
);
