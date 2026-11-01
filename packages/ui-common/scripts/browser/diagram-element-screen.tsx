import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type {
  ProjectedWorkItem,
  WorkItemChangeSetIdentity,
  WorkItemTypeSummaryDto,
} from "../../src/api";
import { workItemKeys } from "../../src/data/collections/workItemLists";
import { workItemTypeKeys } from "../../src/data/collections/workItemTypes";
import {
  WorkflowGraphSurface,
  type WorkItemGraphProjectionData,
} from "../../src/components/shared/WorkflowMentionInlineRenderer";

const ORG = "browser-org";
const PROJECT = "browser-project";
const MOCKUP_ID = "11111111-1111-4111-8111-111111111111";
const forbidden = `${location.origin}/forbidden`;

const mockupType = {
  definition: {
    key: "mockup",
    name: "Mockup",
    role: "project-info",
    allowedStatuses: [],
    sections: [
      {
        key: "mockup",
        label: "Mockup",
        kind: "html/css",
        defaultSizeKey: "desktop",
        sizeProfiles: [
          {
            key: "desktop",
            label: "Desktop",
            breakpoints: [
              {
                minContainerWidth: 0,
                inline: { width: 1280, height: 800 },
                page: { width: 1280, height: 800 },
              },
            ],
          },
        ],
      },
    ],
  },
} as unknown as WorkItemTypeSummaryDto;

const queryClient = new QueryClient();
queryClient.setQueryData(
  workItemTypeKeys.byKey(ORG, PROJECT, "mockup"),
  mockupType,
);

// The Mockup is read through the real work-item detail cache entry.
queryClient.setQueryData(workItemKeys.detail(ORG, PROJECT, MOCKUP_ID), {
  id: MOCKUP_ID,
  name: "Cart screen",
  type: "mockup",
  organizationId: ORG,
  projectId: PROJECT,
  sections: [
    {
      id: "mockup-section",
      key: "mockup",
      order: 0,
      materializedMarkdown: JSON.stringify(mockupContent()),
    },
  ],
});

const rootIdentity: WorkItemChangeSetIdentity = {
  refType: "existing",
  id: "diagram-root",
};
const identity = (id: string): WorkItemChangeSetIdentity => ({
  refType: "existing",
  id,
});

// Authored content that tries every escape the isolated renderer must stop.
function mockupContent() {
  return {
    html: `<main><header>Cart</header><section><h1>Your cart</h1><button>Checkout</button></section>
    <img src="${forbidden}/image" alt="">
    <script>parent.postMessage('authored-script-ran','*');fetch('${forbidden}/fetch');</script></main>`,
    css: `@import url('${forbidden}/style');
    body{margin:0}main{height:100vh;background:#fff;color:#20242b;font:32px sans-serif}
    header{background:#2f6fed;color:#fff;padding:24px}section{padding:48px}
    button{font-size:32px;padding:16px 32px}
    .escape{position:fixed;inset:-9999px}`,
  };
}

const element = (
  id: string,
  name: string,
  canonicalEntityId?: string,
): ProjectedWorkItem => ({
  identity: identity(id),
  label: name,
  name,
  type: "DIAGRAM_ELEMENT",
  parent: rootIdentity,
  sections: [
    {
      key: "diagramElementMetadata",
      content: {
        role: "GENERIC",
        ...(canonicalEntityId
          ? {
              canonicalReference: {
                entityType: "TASK",
                entityId: canonicalEntityId,
              },
            }
          : {}),
      },
    },
  ],
  deleted: false,
});

const projection: WorkItemGraphProjectionData = {
  layoutSource: "authored",
  projectedRoot: {
    identity: rootIdentity,
    label: "Checkout",
    name: "Checkout",
    type: "DIAGRAM",
    sections: [],
    deleted: false,
  },
  children: [element("cart", "Cart", MOCKUP_ID), element("plain", "Shopper")],
  incidentRelationships: [],
  effectiveLayout: {
    nodes: [
      { node: identity("cart"), position: { x: 40, y: 40 } },
      { node: identity("plain"), position: { x: 300, y: 40 } },
    ],
  },
};

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <MemoryRouter>
      <ThemeProvider theme={createTheme()}>
        <div style={{ width: 760 }}>
          <WorkflowGraphSurface
            mode="view"
            projection={projection}
            organizationId={ORG}
            projectId={PROJECT}
            directEntityLinks={[
              {
                sourceNodeId: "cart",
                targetEntityId: "22222222-2222-4222-8222-222222222222",
                targetEntityType: "SERVICE",
                targetTitle: "Checkout API",
                relationshipType: "RELATED_TO",
              },
            ]}
          />
        </div>
      </ThemeProvider>
    </MemoryRouter>
  </QueryClientProvider>,
);
