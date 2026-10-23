import { CorrelatedActivityFeed } from "@hey-hey/ui-common/components";
import React from "react";
import { TabContainer } from "../../components/Tabs";

interface UserActivityTabProps {
  organizationId: string;
  projectId: string;
  userId: string;
}

export const UserActivityTab: React.FC<UserActivityTabProps> = ({
  organizationId,
  projectId,
  userId,
}) => {
  return (
    <TabContainer>
      <CorrelatedActivityFeed
        organizationId={organizationId}
        projectId={projectId}
        userId={userId}
        enabled
        showHeader={false}
        emptyMessage="No recent activity found for this user."
      />
    </TabContainer>
  );
};
