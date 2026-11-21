import type { ApolloClient } from "@apollo/client";
import {
  GetOnboardingReplyVersionDocument,
  GetTriageConversationTitleDocument,
  VerifyRepositoryImportConversationDocument,
} from "../../graphql/generated/graphql";
import type { GraphQLProjectScope } from "./client";
import { queryProject } from "./queryProject";

export async function fetchTriageConversationTitle(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  id: string,
) {
  const data = await queryProject(
    client,
    scope,
    GetTriageConversationTitleDocument,
    { id },
  );
  return data?.conversation.title;
}

export async function fetchOnboardingReplyVersion(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  id: string,
) {
  const data = await queryProject(
    client,
    scope,
    GetOnboardingReplyVersionDocument,
    { id },
  );
  return data?.conversation.version;
}

export async function fetchRepositoryImportConversation(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  id: string,
) {
  const data = await queryProject(
    client,
    scope,
    VerifyRepositoryImportConversationDocument,
    { id },
  );
  return data?.conversation;
}
