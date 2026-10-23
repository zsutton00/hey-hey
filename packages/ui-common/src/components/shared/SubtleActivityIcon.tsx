import { createSvgIcon } from "@mui/material/utils";
import { alpha, keyframes, type Theme } from "@mui/material/styles";

const subtleActivityPulse = keyframes`
  0%, 100% { opacity: 0.65; }
  50% { opacity: 1; }
`;

const activitySpinnerRotation = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

export const getSubtleActivityIconSx = (theme: Theme) => ({
  animation: `${subtleActivityPulse} 1.8s ease-in-out infinite`,
  filter: `drop-shadow(0 0 6px ${alpha(theme.palette.info.main, 0.55)})`,
});

export const getActivitySpinnerSx = () => ({
  animation: `${activitySpinnerRotation} 1s linear infinite`,
});

export const ThoughtBubbleIcon = createSvgIcon(
  <path
    fill="currentColor"
    fillRule="evenodd"
    d="M15.995 2a4.63 4.63 0 0 0-3.607 1.725a5.5 5.5 0 0 0-2.59-.649c-3.273 0-5.707 2.774-5.652 5.845C2.286 9.858 1 11.769 1 14.005c0 2.227.96 3.609 1.974 4.416c.416.331.828.557 1.161.709c-.028 3.053 2.4 5.794 5.653 5.794c.946 0 1.824-.238 2.595-.647a4.63 4.63 0 0 0 7.208-.002a5.5 5.5 0 0 0 2.59.649c3.272 0 5.706-2.77 5.653-5.84c1.87-.93 3.166-2.84 3.166-5.079c0-2.227-.96-3.609-1.974-4.416a5.6 5.6 0 0 0-1.161-.709c.028-3.053-2.4-5.794-5.653-5.794a5.5 5.5 0 0 0-2.596.648A4.64 4.64 0 0 0 15.995 2m-2.397 3.534A2.65 2.65 0 0 1 15.995 4c1.062 0 1.976.62 2.421 1.554a1 1 0 0 0 1.53.348a3.58 3.58 0 0 1 2.266-.816c2.245 0 3.95 2.084 3.61 4.304a1 1 0 0 0 .392.955c.083.062.158.098.178.107c.053.025.1.042.116.048l.094.032l.024.008q.116.037.294.11c.24.1.552.258.86.503c.582.464 1.22 1.29 1.22 2.852c0 1.62-1.056 2.993-2.54 3.487a1 1 0 0 0-.671 1.107c.354 2.225-1.354 4.325-3.607 4.325c-.849 0-1.626-.309-2.273-.82a1 1 0 0 0-1.527.361A2.65 2.65 0 0 1 15.985 24c-1.052 0-1.964-.621-2.4-1.54a1 1 0 0 0-1.53-.352a3.58 3.58 0 0 1-2.267.816c-2.245 0-3.95-2.084-3.61-4.304a1 1 0 0 0-.392-.955a1 1 0 0 0-.178-.107a1 1 0 0 0-.116-.048l-.094-.032l-.024-.008a4 4 0 0 1-.294-.11a3.6 3.6 0 0 1-.86-.503C3.639 16.392 3 15.567 3 14.005c0-1.624 1.05-2.997 2.526-3.5a1 1 0 0 0 .665-1.103c-.354-2.226 1.353-4.326 3.607-4.326c.849 0 1.626.309 2.273.82a1 1 0 0 0 1.527-.362M4.5 24a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7M3 27.5a1.5 1.5 0 1 1 3 0a1.5 1.5 0 0 1-3 0"
    clipRule="evenodd"
  />,
  "ThoughtBubble",
);

export const WritingIcon = createSvgIcon(
  <>
    <path d="M0 0h21v21H0z" fill="none" />
    <path
      d="M17 4a2.12 2.12 0 0 1 0 3l-9.5 9.5l-4 1l1-3.944l9.504-9.552a2.116 2.116 0 0 1 2.864-.125zM9.5 17.5h8m-2-11l1 1"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </>,
  "Writing",
);

export const LoadingSpinnerIcon = createSvgIcon(
  <>
    <path d="M0 0h32v32H0z" fill="none" />
    <path
      d="M22.5 4.742A13 13 0 1 0 29 16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    />
  </>,
  "LoadingSpinner",
);

export const PlanReadyIcon = createSvgIcon(
  <>
    <path d="M0 0h32v32H0z" fill="none" />
    <path
      d="m5.97 3l-.314.344S4.9 4 4.406 4v2c.68 0 1.15-.276 1.594-.53V10h2V3zM11 6v2h17V6zm-4.5 6A2.497 2.497 0 0 0 4 14.5v.5h2v-.5c0-.217.283-.5.5-.5s.5.283.5.5l-.03.03l-.064.064l-2.593 2.5l-.313.28V19h5v-2H7.28l.876-.875l.125-.094l-.03-.03c.502-.41.75-1.02.75-1.5A2.5 2.5 0 0 0 6.5 12m4.5 3v2h17v-2zm-7 6v2h1.375l-.25.406l-.125.22V25h1.5c.217 0 .5.283.5.5s-.283.5-.5.5H4v2h2.5C7.883 28 9 26.883 9 25.5c0-1.005-.678-1.696-1.53-2.094l.405-.687l.125-.25V21zm7 3v2h17v-2z"
      fill="currentColor"
    />
  </>,
  "PlanReady",
);
