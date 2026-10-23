import { Alert } from "@mui/material";
import type { DataStateBoundaryProps } from "./DataStateBoundary";

export type DataStateBoundaryFixture = DataStateBoundaryProps;

const readyContent = (
  <Alert severity="success" data-testid="data-state-boundary-ready-content">
    Required reads are ready.
  </Alert>
);

export const dataStateBoundaryFixtures = {
  refreshing: {
    loading: true,
    fetched: true,
    presentation: {
      queryIdentity: "same-selection",
      hasUsableContent: true,
      transition: "opacity-height",
    },
    children: readyContent,
  },
  unstarted: {
    loading: false,
    fetched: false,
    children: readyContent,
  },
  loading: {
    loading: true,
    fetched: false,
    children: readyContent,
  },
  ready: {
    loading: false,
    fetched: true,
    children: readyContent,
  },
} satisfies Record<string, DataStateBoundaryFixture>;
