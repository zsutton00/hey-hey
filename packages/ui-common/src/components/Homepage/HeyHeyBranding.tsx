import React from "react";
import { Typography, useTheme } from "@mui/material";

interface HeyHeyBrandingProps {
  variant: "header" | "hero" | "inline";
  fontSize?: string;
  className?: string;
  onClick?: () => void;
}

const HeyHeyBranding: React.FC<HeyHeyBrandingProps> = ({
  variant,
  fontSize,
  className,
  onClick,
}) => {
  const theme = useTheme();
  const variantStyles = {
    header: { fontSize: "2rem", fontWeight: 400 },
    hero: { fontSize: "3rem", fontWeight: 400 },
    inline: { fontSize: "1rem", fontWeight: 400 },
  };

  // Fallback color if custom heyhey palette is not defined
  const accentColor = theme.palette.heyhey?.main ?? "rgb(8, 126, 139)";

  return (
    <Typography
      component="span"
      className={className}
      onClick={onClick}
      sx={{
        fontFamily: '"Monoton", sans-serif',
        letterSpacing: variant === "hero" ? "0.05em" : "0.10em",
        color: "#fff",
        cursor: onClick ? "pointer" : "default",
        ...variantStyles[variant],
        ...(fontSize && { fontSize }),
      }}
    >
      <span style={{ color: accentColor }}>H</span>ey{" "}
      <span style={{ color: accentColor }}>H</span>ey
    </Typography>
  );
};

export default HeyHeyBranding;
