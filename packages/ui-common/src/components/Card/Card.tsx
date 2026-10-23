import { Box, Divider, Link, Stack, Typography } from "@mui/material";
import React, { useId } from "react";

export interface CardProps {
  title: string;
  titleAccessory?: React.ReactNode;
  /** Leading icon drawn before the title, e.g. the entity icon. */
  icon?: React.ReactNode;
  /** Renders the title as a standard link that calls this handler when selected. */
  onTitleClick?: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
  dataTestId?: string;
  /** Keep the title and action on one row at every width instead of stacking on xs. */
  inlineActionOnMobile?: boolean;
}

export const Card: React.FC<CardProps> = ({
  title,
  titleAccessory,
  icon,
  onTitleClick,
  action,
  children,
  dataTestId = "card",
  inlineActionOnMobile = false,
}) => {
  const headingId = useId();

  return (
    <Box
      component="section"
      aria-labelledby={headingId}
      data-testid={dataTestId}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 2,
        width: "100%",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <Stack spacing={1.25} sx={{ minWidth: 0 }}>
        <Stack
          direction={inlineActionOnMobile ? "row" : { xs: "column", sm: "row" }}
          alignItems={
            inlineActionOnMobile ? "center" : { xs: "stretch", sm: "center" }
          }
          justifyContent="space-between"
          spacing={1}
        >
          <Stack
            direction="row"
            alignItems="center"
            sx={{ minWidth: 0, gap: 1 }}
          >
            {icon}
            <Typography
              component="h2"
              id={headingId}
              variant="h6"
              color="heyhey.main"
              sx={(theme) => ({
                fontSize: "1rem",
                textTransform: "uppercase",
                fontWeight: 600,
                letterSpacing: "0.05em",
                // Hosts that style bare headings (rendered Markdown) must not
                // recolor the title or add its heading rule. The icon gap uses
                // flex gap, not Stack spacing, because this reset zeroes the
                // margin spacing would put on the title.
                "&&": {
                  margin: 0,
                  paddingBottom: 0,
                  borderBottom: 0,
                  fontFamily: theme.typography.h6.fontFamily,
                  lineHeight: theme.typography.h6.lineHeight,
                  color: "heyhey.main",
                  ...(onTitleClick && {
                    textTransform: "none",
                    letterSpacing: "normal",
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }),
                },
              })}
            >
              {onTitleClick ? (
                <Link
                  component="button"
                  type="button"
                  variant="inherit"
                  underline="hover"
                  onClick={onTitleClick}
                  sx={{
                    color: "primary.main",
                    font: "inherit",
                    textAlign: "left",
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    verticalAlign: "baseline",
                  }}
                >
                  {title}
                </Link>
              ) : (
                title
              )}
            </Typography>
            {titleAccessory}
          </Stack>
          {action && <Box sx={{ flex: "0 0 auto" }}>{action}</Box>}
        </Stack>
        <Divider />
        <Box sx={{ minWidth: 0 }}>{children}</Box>
      </Stack>
    </Box>
  );
};

Card.displayName = "Card";
