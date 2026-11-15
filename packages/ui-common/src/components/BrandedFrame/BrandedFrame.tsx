import type { ComponentProps, ReactNode } from "react";
import { Box, ButtonBase, styled } from "@mui/material";

const PAGE_BACKGROUND = "#333";
const WORDMARK_COLOR = "#3fa7b5";
const RULE_COLOR = "rgb(255 255 255 / 22%)";

/** The standalone frame screen: dark page, centred content. Fonts come from apps/ui/index.html. */
export const BrandedPage = styled("main")({
  boxSizing: "border-box",
  minHeight: "100vh",
  padding: "clamp(2rem, 6vw, 5rem) 1.5rem",
  background: PAGE_BACKGROUND,
  color: "#fff",
  fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
  lineHeight: 1.5,
  textAlign: "center",
});

export const BrandedWordmark = styled("p")({
  margin: "0 0 1.5rem",
  color: WORDMARK_COLOR,
  fontFamily: 'Monoton, "Arial Black", Arial, sans-serif',
  fontSize: "2.2rem",
  fontWeight: 400,
  letterSpacing: "0.05em",
});

const HeadlineText = styled("h1")({
  margin: "0 auto",
  fontFamily: '"Work Sans", "Arial Black", Arial, sans-serif',
  fontSize: "clamp(1.8rem, 4.6vw, 2.9rem)",
  fontWeight: 900,
  lineHeight: 1.05,
  textTransform: "uppercase",
});

const HeadlineLine = styled("p")({
  maxWidth: "32rem",
  margin: "0.75rem auto 0",
  color: "rgb(255 255 255 / 72%)",
});

export interface BrandedHeadlineProps {
  children: ReactNode;
  /** Optional line beneath the headline, outside any card. */
  line?: ReactNode;
}

export function BrandedHeadline({
  children,
  line,
}: BrandedHeadlineProps): React.JSX.Element {
  return (
    <Box sx={{ mb: "2rem" }}>
      <HeadlineText>{children}</HeadlineText>
      {line ? <HeadlineLine>{line}</HeadlineLine> : null}
    </Box>
  );
}

/** Translucent card; `padding` and `maxWidth` override the defaults through `sx`. */
export const BrandedCard = styled("section")({
  boxSizing: "border-box",
  maxWidth: "440px",
  margin: "0 auto",
  padding: "1.5rem",
  border: `1px solid ${RULE_COLOR}`,
  borderRadius: "10px",
  background: "rgb(255 255 255 / 8%)",
  textAlign: "left",
});

export type BrandedButtonVariant = "primary" | "secondary";

interface BrandedButtonOwnProps {
  variant?: BrandedButtonVariant;
}

const StyledBrandedButton = styled(ButtonBase, {
  shouldForwardProp: (prop) => prop !== "brandedVariant",
})<{ brandedVariant: BrandedButtonVariant }>(({ brandedVariant }) => ({
  // One size definition for both variants keeps them identical in height and width.
  boxSizing: "border-box",
  display: "flex",
  width: "100%",
  minHeight: "2.8rem",
  padding: "0.65rem 1.4rem",
  borderRadius: "4px",
  font: "inherit",
  fontWeight: 600,
  textDecoration: "none",
  border:
    brandedVariant === "secondary"
      ? "1px solid rgb(255 255 255 / 70%)"
      : "1px solid transparent",
  background: brandedVariant === "primary" ? "#fff" : "transparent",
  color: brandedVariant === "primary" ? PAGE_BACKGROUND : "#fff",
  "&.Mui-disabled": { opacity: 0.6, cursor: "not-allowed" },
}));

export function BrandedButton({
  variant = "primary",
  ...props
}: BrandedButtonOwnProps &
  Omit<ComponentProps<typeof ButtonBase>, "variant">): React.JSX.Element {
  return <StyledBrandedButton brandedVariant={variant} {...props} />;
}

const DividerRoot = styled("div")({
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  margin: "1rem 0",
  color: "rgb(255 255 255 / 72%)",
  fontSize: "0.85rem",
  "&::before, &::after": {
    content: '""',
    flex: 1,
    borderTop: `1px solid ${RULE_COLOR}`,
  },
});

export function BrandedDivider({
  label,
}: {
  label: string;
}): React.JSX.Element {
  return (
    <DividerRoot role="separator" aria-label={label.toLowerCase()}>
      {label}
    </DividerRoot>
  );
}
