import { Link, type LinkProps } from "@mui/material";
import React from "react";
import { useNavigate } from "react-router-dom";

export interface SpaLinkProps {
  href: string;
  testId: string;
  variant?: LinkProps["variant"];
  sx?: LinkProps["sx"];
  children: React.ReactNode;
}

/** A real link, so copy-link and open-in-new-tab work, routed in-app on click. */
export const SpaLink: React.FC<SpaLinkProps> = ({
  href,
  testId,
  variant = "body2",
  sx,
  children,
}) => {
  const navigate = useNavigate();
  return (
    <Link
      href={href}
      variant={variant}
      sx={sx}
      data-testid={testId}
      onClick={(event: React.MouseEvent) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey) return;
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </Link>
  );
};
