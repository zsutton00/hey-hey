import { Link } from "@mui/material";
import React from "react";
import { Link as RouterLink } from "react-router-dom";
import { usePathService } from "../../contexts";

export interface UserLinkProps {
  userId: string;
  projectId: string;
  children: React.ReactNode;
}

export const UserLink: React.FC<UserLinkProps> = ({
  userId,
  projectId,
  children,
}) => {
  const pathService = usePathService();
  const href = pathService.user({ projectId, userId });

  return (
    <Link
      component={RouterLink}
      to={href}
      color="primary"
      underline="hover"
      sx={{ cursor: "pointer" }}
    >
      {children}
    </Link>
  );
};
