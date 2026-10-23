import { Box, LinearProgress, Typography } from "@mui/material";

import { useEffect, useRef, useState } from "react";

// A stateless component to display the loading UI
export const OnboardingLoadingScreen = ({
  isNew,
  loadingTextConfig,
}: {
  isNew: boolean;
  loadingTextConfig: Array<{ text: string; delay: number }>;
}) => {
  const loadingTextConfigWithStepsLoad = [
    ...loadingTextConfig,
    { text: "Loading onboarding steps...", delay: 1000 },
  ];
  const [loadingTextIdx, setLoadingTextIdx] = useState(0);
  const [loadingText, setLoadingText] = useState(
    loadingTextConfigWithStepsLoad[loadingTextIdx].text
  );
  const isNewRef = useRef(isNew);

  useEffect(() => {
    if (loadingTextConfigWithStepsLoad[loadingTextIdx + 1]) {
      const timer = setTimeout(() => {
        setLoadingTextIdx(loadingTextIdx + 1);
        setLoadingText(loadingTextConfigWithStepsLoad[loadingTextIdx + 1].text);
      }, loadingTextConfigWithStepsLoad[loadingTextIdx].delay);

      return () => clearTimeout(timer);
    }

    // intentionally not using loadingTextConfigWithStepsLoad here
  }, [loadingTextIdx]);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "400px",
      }}
    >
      {isNewRef.current ? (
        <Box sx={{ width: "50%", textAlign: "center" }}>
          <LinearProgress variant="indeterminate" sx={{ mb: 2 }} />
          <Typography variant="body1" color="text.secondary">
            {loadingText}
          </Typography>
        </Box>
      ) : (
        <>
          <LinearProgress variant="indeterminate" sx={{ mb: 2 }} />
          <Typography variant="body1" color="text.secondary">
            Loading project...
          </Typography>
        </>
      )}
    </Box>
  );
};
