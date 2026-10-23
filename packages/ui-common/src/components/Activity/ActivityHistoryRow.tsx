import { Avatar, Box, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import type { CorrelatedActivityDisplayRecord } from "../../data/hooks/useCorrelatedActivity";
import { usePathService } from "../../contexts";
import { EntityListItem } from "../Entity/EntityListItem";
import { EntityIcon } from "../Entity/EntityIcon";
import { activityAdapter } from "../Entity/activityAdapter";

export const ACTIVITY_HISTORY_COLUMNS =
  "minmax(0, 2.3fr) minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1fr)";

export interface ActivityExpandPayload {
  activity: CorrelatedActivityDisplayRecord;
  href: string | null;
}

export interface ActivityHistoryRowProps {
  activity: CorrelatedActivityDisplayRecord;
  projectId?: string;
  onExpandActivity?: (payload: ActivityExpandPayload) => void;
}

export function ActivityHistoryRow({
  activity,
  projectId,
  onExpandActivity,
}: ActivityHistoryRowProps) {
  const pathService = usePathService();
  const props = activityAdapter(activity, pathService, projectId);
  const status = props.metadata?.find(
    (item) => item.label === "Current status"
  )?.value;
  const created = props.metadata?.find(
    (item) => item.label === "Created"
  )?.value;
  const responsibleUser = activity.responsibleUser;
  return (
    <Box
      data-testid="activity-history-row"
      data-activity-id={activity.activityId}
      sx={{ borderBottom: 1, borderColor: "divider" }}
    >
      <EntityListItem
        {...props}
        metadata={undefined}
        contentSlot={
          <Box
            {...(props.href
              ? { component: RouterLink, to: props.href }
              : { component: "div" })}
            data-testid="activity-history-row-content"
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "repeat(2, minmax(0, 1fr))",
                sm: ACTIVITY_HISTORY_COLUMNS,
              },
              alignItems: "center",
              columnGap: 2,
              rowGap: 1,
              color: "inherit",
              textDecoration: "none",
              minWidth: 0,
            }}
          >
            <Box
              data-testid="activity-history-identity"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.25,
                minWidth: 0,
                gridColumn: { xs: "1 / -1", sm: "auto" },
              }}
            >
              <Box
                component="span"
                sx={{
                  color: "text.secondary",
                  flexShrink: 0,
                  display: "inline-flex",
                }}
              >
                <EntityIcon entityType={activity.entityType} size={20} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 500, overflowWrap: "anywhere" }}
                >
                  {activity.title}
                </Typography>
                {activity.projectName && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block" }}
                  >
                    {activity.projectName}
                  </Typography>
                )}
              </Box>
            </Box>
            <Box data-testid="activity-history-status" sx={{ minWidth: 0 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: { xs: "block", sm: "none" } }}
              >
                Current status
              </Typography>
              {status && (
                <Typography
                  variant="body2"
                  aria-label={`Current status: ${status}`}
                >
                  {status}
                </Typography>
              )}
            </Box>
            <Box
              data-testid="activity-history-responsible-user"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                minWidth: 0,
              }}
            >
              {responsibleUser && (
                <>
                  <Avatar sx={{ width: 24, height: 24, fontSize: "0.625rem" }}>
                    {responsibleUser.name
                      .split(/\s+/)
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join("")}
                  </Avatar>
                  <Typography
                    variant="body2"
                    sx={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {responsibleUser.name}
                  </Typography>
                </>
              )}
            </Box>
            <Box
              data-testid="activity-history-created"
              sx={{
                gridColumn: { xs: "1 / -1", sm: "auto" },
                pl: { xs: 3.75, sm: 0 },
              }}
            >
              {created && (
                <Typography
                  component="time"
                  dateTime={activity.entityCreatedAt ?? undefined}
                  variant="body2"
                  color="text.secondary"
                  aria-label={`Created: ${created}`}
                >
                  {created}
                </Typography>
              )}
            </Box>
          </Box>
        }
        onClick={
          onExpandActivity
            ? (event) => {
                event.preventDefault();
                onExpandActivity({ activity, href: props.href ?? null });
              }
            : undefined
        }
      />
    </Box>
  );
}
