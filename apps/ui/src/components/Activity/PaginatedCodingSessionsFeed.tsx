import React from "react";
import {
  PaginatedSessionFeed,
  type PaginatedSessionFeedProps,
} from "./PaginatedSessionFeed";

export type PaginatedCodingSessionsFeedProps = Omit<
  PaginatedSessionFeedProps,
  "variant"
>;

export const PaginatedCodingSessionsFeed: React.FC<
  PaginatedCodingSessionsFeedProps
> = (props) => <PaginatedSessionFeed {...props} variant="coding" />;
